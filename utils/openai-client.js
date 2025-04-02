const { OpenAI } = require("openai");
const fs = require("fs");
const path = require("path");
const { countExpectedActions } = require("./gherkin-parser");
const basePrompt = `You have been provided with three files:

1. XML Test Case File (*.xml)
   - Contains the Gherkin-style test steps in XML format
   - Each step has a "type" attribute ("given", "when", or "then")
   - The steps following "when" are the ones you need to implement
   - Example: <step type="when">I click the Save button</step>

2. Elements JSON File (*-elements.json)
   - Contains all available interactive elements on the page
   - Each element has:
     - test_id: The unique identifier used to find the element (may have "e2e-" prefix)
     - tag: The HTML tag type (e.g., "button", "input", "lightning-button")
     - text: The visible text of the element
   - Example: {"test_id": "e2e-save-button", "tag": "lightning-button", "text": "Save"}

3. Page Screenshot (*.png)
   - Shows the current visual state of the page
   - Use this to understand the context and layout
   - Helps identify which elements correspond to the test steps

Your procedure is: 
1. Read the XML file to understand the test case.
2. For each step in the XML file, find the corresponding test-id of an element in the JSON file.
3. For each identified element, generate a test step using the appropriate action type based on the element's details.
4. Return the list of test steps as a JSON array.

IMPORTANT: Your steps must always use the test-id of some element in the JSON file. If you cannot find an exact match, REVIEW THE ELEMENTS AGAIN and find the one that makes the most sense given the test case.`;

class OpenAiClient {
  constructor(apiKey) {
    if (!apiKey) throw new Error("OpenAI API key is required!");

    this.client = new OpenAI({
      apiKey: apiKey
    });
    this.currentThread = null;
    this.currentAssistant = null;
  }

  async createFile(filePath) {
    const maxRetries = 3;
    let attempt = 0;
    let error;

    while (attempt < maxRetries) {
      try {
        return await this.client.files.create({
          file: fs.createReadStream(filePath),
          purpose: "assistants"
        });
      } catch (err) {
        error = err;
        if (!/connection error/i.test(err.message)) {
          throw new Error(`Failed to upload file: ${err.message}`);
        }
        attempt++;
      }
    }
    throw new Error(`Failed to upload file after ${maxRetries} attempts: ${error.message}`);
  }

  async initializeThread() {
    const systemPrompt = `
You are an expert JSON test case generator which generates precise test steps based on XML test cases and available testable elements.

## Core Analysis Principles
1. XML TEST CASE PARSING
- One generated test step should correspond to a single line in the gherkin use case following "when"
- "given" and "then" steps should be ignored, each line following "when" and preceding "then" should have a corresponding test action
- THE STABILITY OF OUR PRODUCT DEPENDS ON YOU, think deeply about the test steps you generate
- Maintain the exact order of steps as specified

2. ELEMENT SELECTION
- Use ONLY the test elements provided in the .json file
- Match elements based on their test_id only
- Consider the element's tag and type for appropriate actions

3. STEP GENERATION RULES
For initial step generation:
- The number of steps generated should match the number of lines following and including "when"
- Generate enough steps to cover all test case requirements

For subsequent step updates:
- Generate EXACTLY the same number of steps as specified
- Keep all previously executed steps unchanged
- Use newly available test elements only for remaining steps
- Maintain logical flow while preserving step count

## Available Actions
1. ELEMENT INTERACTION
- type: "findAndClick"
- keywords: "click", "select"
- params: { text: string } // matches test_id without 'e2e-' prefix
- description: Click an element by its test_id

- type: "findAndType"
- keywords: "type", "types", "input"
- params: { field: string, text: string } // field matches test_id without 'e2e-' prefix
- description: Type text into an input field by its test_id

2. PAGE INTERACTION
- type: "reload"
- keywords: "reload", "refresh"
- params: {}
- description: Reload the current page

3. WAITING
- type: "waitForText"
- keywords: "wait", "wait", "visible"
- params: { text: string }
- description: Wait for specific text to appear on the page

## Output Format
You must return ONLY a raw JSON array containing the test steps, with no additional text, comments or explanation.
Each step should be an object matching one of the action types above. Do not use backticks or any other formatting.

Example:
[{"type":"findAndClick","text":"edit"},{"type":"reload"},{"type":"findAndType","field":"name","text":"Test Profile"}]`;

    try {
      if (!this.currentAssistant) {
        this.currentAssistant = await this.client.beta.assistants.create({
          name: "E2E Test Assistant",
          model: "gpt-4o",
          instructions: systemPrompt,
          tools: [{ type: "code_interpreter" }, { type: "file_search" }],
          tool_resources: {
            code_interpreter: {
              file_ids: []
            },
            file_search: {
              vector_store_ids: []
            }
          }
        });
      }

      this.currentThread = await this.client.beta.threads.create();
      return this.currentThread;
    } catch (error) {
      throw new Error(`Failed to initialize thread: ${error.message}`);
    }
  }

  getOutputInstructions() {
    return `
IMPORTANT: You must return ONLY a raw JSON array containing the test steps.
Each step should be an object matching one of the action types above.

VERY IMPORTANT: DO NOT RETURN ANYTHING OTHER THAN THE JSON ARRAY.
EXTREMELY IMPORTANT: DO NOT RETURN ANYTHING OTHER THAN THE JSON ARRAY.`;
  }

  buildPrompt(context, instructions) {
    const prompt = `You are an automated test executor. ${context}

          ${basePrompt}

          ${this.getOutputInstructions()}`;

    return !instructions
      ? prompt
      : prompt +
          `\n\n Supplemental Instructions:
              ${instructions}`;
  }

  getInitialPrompt(instructions) {
    const context =
      "Your task is to convert Gherkin test cases into a sequence of actions that can be executed by a test framework.";
    return this.buildPrompt(context, instructions);
  }

  getUpdatePrompt(totalSteps, currentIndex, executedSteps, instructions) {
    const context = `Your task is to update the sequence of actions based on the current page state.

Please generate the complete sequence of ${totalSteps} steps, maintaining the same steps up to index ${currentIndex}.
Previous steps executed: ${JSON.stringify(executedSteps)}`;

    return this.buildPrompt(context, instructions);
  }

  async uploadFiles(files) {
    if (!files?.length) return { fileIds: [] };

    const uploadResults = [];
    const fileIds = [];

    // Upload all files and collect results
    for (const file of files) {
      try {
        const uploadedFile = await this.createFile(file.path);
        if (!uploadedFile?.id) {
          throw new Error(`File upload failed - no ID returned for ${file.path}`);
        }
        fileIds.push(uploadedFile.id);
        uploadResults.push({
          path: file.path,
          id: uploadedFile.id,
          success: true
        });
      } catch (uploadError) {
        uploadResults.push({
          path: file.path,
          error: uploadError.message,
          success: false
        });
      }
    }

    // Check for failed uploads
    const failedUploads = uploadResults.filter((r) => !r.success);
    if (failedUploads.length > 0) {
      const failureDetails = failedUploads.map((f) => `${path.basename(f.path)}: ${f.error}`).join(", ");
      throw new Error(`Failed to upload files: ${failureDetails}`);
    }

    // Update assistant with new file IDs
    try {
      const updatedAssistant = await this.client.beta.assistants.update(this.currentAssistant.id, {
        tool_resources: {
          code_interpreter: {
            file_ids: fileIds
          }
        }
      });

      // Verify file IDs were attached
      const attachedFileIds = updatedAssistant?.tool_resources?.code_interpreter?.file_ids || [];
      const missingFiles = fileIds.filter((id) => !attachedFileIds.includes(id));

      if (missingFiles.length > 0) {
        throw new Error("Not all files were successfully attached to the assistant");
      }

      return { fileIds, uploadResults };
    } catch (updateError) {
      throw new Error(`Failed to update assistant with files: ${updateError.message}`);
    }
  }

  async findRelatedTestElements(llmTestStep, gherkinStep, elementsFile) {
    try {
      // Read and parse the JSON file containing test elements
      const testElements = JSON.parse(fs.readFileSync(elementsFile, "utf8"));
      if (!Array.isArray(testElements)) {
        throw new Error("Test elements file does not contain an array");
      }

      // Check if the step's text matches any test_id exactly or with e2e- prefix
      // Also check if the element's text matches the step's text
      const exactMatches = testElements.filter(
        (element) =>
          // Test ID matches
          element.test_id?.toLowerCase() === llmTestStep.text?.toLowerCase() || // Direct match
          element.test_id?.toLowerCase() === `e2e-${llmTestStep.text?.toLowerCase()}` || // e2e- prefixed match
          // Or element text matches
          element.text?.toLowerCase() === llmTestStep.text?.toLowerCase() // Text content match
      );

      if (exactMatches.length > 0) {
        return {
          originalStep: llmTestStep,
          gherkinStep,
          suggestedElements: exactMatches,
          searchTerms: [],
          exactMatch: true
        };
      }

      // Split gherkin step into individual words and filter out common words
      const commonWords = new Set(["i", "the", "a", "an", "and", "or", "to", "in", "on", "at", "by"]);
      const searchTerms = gherkinStep
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => !commonWords.has(word));

      // Find elements whose test_id contains any of our search terms
      const relatedElements = testElements.filter((element) => {
        if (!element.test_id) return false;
        const testId = element.test_id.toLowerCase();
        return searchTerms.some((term) => testId.includes(term));
      });

      if (relatedElements.length === 0) {
        return {
          originalStep: llmTestStep,
          gherkinStep,
          suggestedElements: [],
          searchTerms
        };
      }

      return {
        originalStep: llmTestStep,
        gherkinStep,
        suggestedElements: relatedElements,
        searchTerms
      };
    } catch (error) {
      throw new Error(`Failed to find related test elements: ${error.message}`);
    }
  }

  buildRetryPrompt(relatedElements) {
    const searchTermsText = relatedElements.searchTerms?.length
      ? `\n\nI found these potentially related elements by searching for the terms [${relatedElements.searchTerms.join(", ")}]:`
      : "\n\nI found these potentially related elements:";

    return `The previous step you generated (${JSON.stringify(relatedElements.originalStep)}) did not match any available test elements.
    
This step was meant to implement the Gherkin step: "${relatedElements.gherkinStep}"${searchTermsText}
${JSON.stringify(relatedElements.suggestedElements, null, 2)}

Please generate a new step using one of these elements that would best implement the Gherkin step.
Remember to maintain the same number of total steps and only change this specific step.`;
  }

  parseResponseIntoActions(text) {
    if (!text) {
      return null;
    }

    // First try direct parse
    try {
      const directParsed = JSON.parse(text.trim());
      if (Array.isArray(directParsed)) {
        console.log("Successfully parsed direct JSON:", directParsed);
        return directParsed;
      }
    } catch (directErr) {
      console.log("Direct parse failed, attempting to clean text");
      // More robust parsing for responses with explanation text
      const cleanedText = text
        .replace(/```json\s*|\s*```/g, "") // Remove code blocks
        .replace(/\/\/.*$/gm, "") // Remove single line comments
        .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
        .replace(/,(\s*[}\]])/g, "$1") // Fix trailing commas
        .replace(/^\s*[\r\n]/gm, "") // Remove empty lines
        .trim();

      console.log("Cleaned text:", cleanedText);
      // Try to find JSON array in the cleaned text
      const matches = cleanedText.match(/\[[\s\S]*\]/);
      if (matches) {
        console.log("Found JSON array in cleaned text");
        return JSON.parse(matches[0]);
      }
    }
    return null;
  }

  async askAgainAfterWrongStepCount(parsedActions, expectedActionCount, files) {
    console.log("Sending correction message for wrong number of steps");
    const prompt = `Your response contained ${parsedActions.length} actions, but the test case requires exactly ${expectedActionCount} actions. One action should be generated for each line following and including "when" in the test case. Please provide the correct number of actions.`;
    console.log("Incorrect step count prompt:", prompt);
    await this.client.beta.threads.messages.create(this.currentThread.id, {
      role: "user",
      content: prompt
    });

    // Wait for assistant's response
    const run = await this.client.beta.threads.runs.create(this.currentThread.id, {
      assistant_id: this.currentAssistant.id
    });

    // Wait for completion
    let runStatus = await this.client.beta.threads.runs.retrieve(this.currentThread.id, run.id);

    while (runStatus.status !== "completed") {
      if (runStatus.status === "failed") {
        console.error("Run failed with status:", runStatus);
        throw new Error("Assistant failed to generate corrected response");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await this.client.beta.threads.runs.retrieve(this.currentThread.id, run.id);
    }

    // Get corrected response
    const messages = await this.client.beta.threads.messages.list(this.currentThread.id);
    const correctedMessage = messages.data[0];
    const correctedText = correctedMessage?.content?.[0]?.text?.value;
    console.log("GPT Response to request for correct step count:", correctedText);
    if (!correctedText) {
      throw new Error("No corrected response received");
    }

    // Process corrected response recursively with isRetry flag
    const correctedActions = this.parseResponseIntoActions(correctedText);
    if (!Array.isArray(correctedActions)) {
      return this.getResponse(prompt, files);
    }
    return await this.processResponse(correctedActions, files);
  }

  async processResponse(parsedActions, files) {
    try {
      // Find XML file and elements file in provided files
      const xmlFile = files.find((file) => file.path.endsWith(".xml"));
      const elementsFile = files.find((file) => file.path.endsWith("-elements.json"));

      if (!xmlFile) {
        return JSON.stringify(parsedActions);
      }

      const xmlContent = fs.readFileSync(xmlFile.path, "utf8");
      const expectedActionCount = countExpectedActions(xmlContent);
      console.log("Expected action count:", expectedActionCount);
      console.log("Actual action count:", parsedActions.length);

      // Extract all steps for later validation
      const gherkinSteps = xmlContent
        .match(/<step[^>]*type="([^"]+)"[^>]*>([^<]+)<\/step>/g)
        ?.map((step) => {
          const match = step.match(/<step[^>]*type="([^"]+)"[^>]*>([^<]+)<\/step>/);
          return match ? { type: match[1].toLowerCase(), text: match[2].trim() } : null;
        })
        ?.filter(Boolean);

      if (!gherkinSteps?.length) {
        throw new Error("No valid steps found in XML content");
      }

      const whenIndex = gherkinSteps.findIndex((step) => step.type === "when");
      const thenIndex = gherkinSteps.findIndex((step) => step.type === "then");

      if (whenIndex === -1) {
        throw new Error("No 'when' step found in test case");
      }
      if (thenIndex === -1) {
        throw new Error("No 'then' step found in test case");
      }

      // Count only the steps between WHEN and THEN
      const whenStepsCount = thenIndex - whenIndex;

      if (parsedActions.length !== whenStepsCount) {
        return await this.askAgainAfterWrongStepCount(parsedActions, whenStepsCount, files);
      }

      // If we have elements file, validate each step has matching elements
      if (!elementsFile) {
        throw new Error("No elements file found, cannot validate gherkin steps against elements");
      }

      console.log("Validating steps against elements file");
      // Extract gherkin steps for context
      const gherkinStepsForContext = gherkinSteps.filter((step) => step.type === "when");

      if (!gherkinStepsForContext?.length) {
        throw new Error("No valid steps found in XML content for context validation");
      }

      // Only validate steps after "when"
      for (let i = 0; i < parsedActions.length; i++) {
        const gherkinStep = gherkinStepsForContext[i]?.text;
        console.log("Checking gherkin step for test-id compatibility:", gherkinStep);
        if (!gherkinStep) {
          throw new Error(`No Gherkin step found for action index ${i}`);
        }

        const relatedElements = await this.findRelatedTestElements(parsedActions[i], gherkinStep, elementsFile.path);

        if (relatedElements?.exactMatch) {
          console.log(
            `Step ${i + 1}: Found exact test-id match for "${parsedActions[i].text}", there is no need to rework this test step, continuing...`
          );
          continue;
        }

        if (relatedElements?.suggestedElements?.length === 0) {
          console.log(`Step ${i + 1}: No related elements found for "${parsedActions[i].text}", continuing...`);
          continue;
        }

        // If we get here, we didn't find an exact match - we need to retry with suggested elements
        console.log(
          `Step ${i + 1}: No exact test-id match found for "${parsedActions[i].text}", asking GPT to retry with suggested elements`
        );
        const retryPrompt = this.buildRetryPrompt(relatedElements);
        console.log("asking gpt to retry with suggested elements because we couldn't find an exact match");
        console.log(retryPrompt);
        await this.client.beta.threads.messages.create(this.currentThread.id, {
          role: "user",
          content: retryPrompt
        });

        // Wait for assistant's response
        const run = await this.client.beta.threads.runs.create(this.currentThread.id, {
          assistant_id: this.currentAssistant.id
        });

        // Wait for completion
        let runStatus = await this.client.beta.threads.runs.retrieve(this.currentThread.id, run.id);
        while (runStatus.status !== "completed") {
          console.log("Waiting for ChatGPT to finish...");
          if (runStatus.status === "failed") {
            throw new Error("Assistant failed to generate corrected response");
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          runStatus = await this.client.beta.threads.runs.retrieve(this.currentThread.id, run.id);
        }

        // Get corrected response
        const messages = await this.client.beta.threads.messages.list(this.currentThread.id);
        const correctedMessage = messages.data[0];
        const correctedText = correctedMessage?.content?.[0]?.text?.value;
        console.log("GPT Response to request for more precise test steps:", correctedText);
        if (!correctedText) {
          throw new Error("No corrected response received");
        }

        // Process corrected response recursively
        const correctedActions = this.parseResponseIntoActions(correctedText);
        return await this.processResponse(correctedActions, files, true);
      }

      // If we get here, all validations have passed
      // Do one final check to remove any actions without exact test element matches
      if (elementsFile) {
        const testElements = JSON.parse(fs.readFileSync(elementsFile.path, "utf8"));
        parsedActions = parsedActions.filter((action) => {
          const hasExactMatch = testElements.some(
            (element) =>
              element.test_id?.toLowerCase() === action.text?.toLowerCase() || // Direct match
              element.test_id?.toLowerCase() === `e2e-${action.text?.toLowerCase()}` // e2e- prefixed match
          );
          if (!hasExactMatch) {
            console.log(`Removing action with non-matching test-id: ${action.text}`);
          }
          return hasExactMatch;
        });
      }
      return JSON.stringify(parsedActions);
    } catch (error) {
      console.error("Error in processResponse:", error);
      throw new Error(`Failed to process response: ${error.message}`);
    }
  }

  async getResponse(prompt, files = []) {
    try {
      if (!this.currentThread) {
        await this.initializeThread();
      }

      const message = {
        role: "user",
        content: prompt
      };

      // Handle file uploads if any
      if (files.length > 0) {
        await this.uploadFiles(files);
      }
      console.log("Asking GPT to generate test steps", message);
      await this.client.beta.threads.messages.create(this.currentThread.id, message);

      const run = await this.client.beta.threads.runs.create(this.currentThread.id, {
        assistant_id: this.currentAssistant.id
      });

      let runStatus = await this.client.beta.threads.runs.retrieve(this.currentThread.id, run.id);
      let retryCount = 0;
      const maxRetries = 10;
      const baseDelay = 1000;

      while (runStatus.status !== "completed" && retryCount < maxRetries) {
        console.log("Waiting for ChatGPT to finish...");
        const delay = baseDelay * Math.pow(1.5, retryCount);
        await new Promise((resolve) => setTimeout(resolve, delay));
        runStatus = await this.client.beta.threads.runs.retrieve(this.currentThread.id, run.id);

        if (runStatus.status === "failed") {
          throw new Error(`Assistant run failed: ${runStatus.last_error}`);
        } else if (runStatus.status === "requires_action") {
          throw new Error("Assistant requires action - function calls not supported in this implementation");
        }
        retryCount++;
      }

      if (retryCount >= maxRetries) {
        throw new Error("Assistant run timed out after maximum retries");
      }

      const messages = await this.client.beta.threads.messages.list(this.currentThread.id);
      const lastMessage = messages.data[0];

      // Combine all text values from content array
      const text = lastMessage.content
        .filter((item) => item.type === "text")
        .map((item) => item.text.value)
        .join("\n");
      console.log("GPT Response to request for test steps:", text);
      const parsedActions = this.parseResponseIntoActions(text);

      if (!Array.isArray(parsedActions) || parsedActions.length === 0) {
        console.log("Response did not contain an array of test steps, starting fresh with new thread...");
        await this.endThread();
        await this.initializeThread();
        return this.getResponse(prompt, files);
      }

      return await this.processResponse(parsedActions, files);
    } catch (error) {
      // Extract error details if they exist
      const errorDetails = error.last_error || error.message || error;
      const formattedError = typeof errorDetails === "object" ? JSON.stringify(errorDetails, null, 2) : errorDetails;
      throw new Error(`OpenAI request failed: ${formattedError}`);
    }
  }

  async endThread() {
    if (this.currentThread) {
      this.currentThread = null;
    }
  }

  async validateThenConditions(xmlContent, currentState, instructions) {
    const { domFile, screenshot, initialScreenshot } = currentState;

    // Extract THEN steps from XML
    const thenSteps = xmlContent
      .match(/<step[^>]*type="then"[^>]*>([^<]+)<\/step>/g)
      ?.map((step) => {
        const match = step.match(/<step[^>]*type="then"[^>]*>([^<]+)<\/step>/);
        return match ? match[1].trim() : null;
      })
      ?.filter(Boolean);

    if (!thenSteps?.length) {
      throw new Error("No THEN steps found in test case");
    }

    // Initialize a new thread with validation-specific instructions
    if (!this.currentThread) {
      const validationSystemPrompt = `You are a test validation assistant. Your task is to validate if the current page state satisfies the THEN conditions from a Gherkin test scenario by analyzing both the page state and visual changes.

Your response MUST:
1. Start with either "PASS" or "FAIL"
2. Follow with a detailed explanation for each condition that includes:
   - What was found or not found in the DOM
   - Visual changes observed between the initial and final screenshots
   - How these observations relate to the test conditions
3. Be precise and specific in your analysis
4. Reference specific elements, text, and visual changes that support your conclusion

Example response format:
PASS
1. Condition "the save button should be enabled" is satisfied
   - DOM: Found button with test-id="save-button" in enabled state
   - Visual: The button appears active in the final screenshot vs. being grayed out in the initial screenshot
2. Condition "the form should show success message" is satisfied
   - DOM: Found div with text "Successfully saved"
   - Visual: A new green success message banner is visible in the final screenshot that was not present in the initial screenshot

OR:

FAIL
1. Condition "the save button should be enabled" is not satisfied
   - DOM: Found button with test-id="save-button" but it has disabled="true"
   - Visual: Button remains grayed out in both screenshots, indicating no state change
2. Condition "the form should show success message" is not satisfied
   - DOM: No element containing text "Successfully saved" was found
   - Visual: No visible success message banner appears in the final screenshot
   
Supplemental Instructions: ${instructions}`;

      await this.initializeThread();
      this.currentAssistant = await this.client.beta.assistants.create({
        name: "E2E Test Validator",
        model: "gpt-4o",
        instructions: validationSystemPrompt,
        tools: [{ type: "code_interpreter" }, { type: "file_search" }]
      });
    }

    // Upload and attach the files
    const files = [
      { path: initialScreenshot, description: "Initial screenshot showing the page state before test execution" },
      { path: screenshot, description: "Final screenshot showing the page state after test execution" }
    ];

    await this.uploadFiles(files);

    console.log("Waiting 3 seconds for files to upload before sending validation prompt...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const prompt = `Please validate if the current page state satisfies these THEN conditions:

${thenSteps.map((step, i) => `${i + 1}. ${step}`).join("\n")}

I have provided two screenshots for comparison:
1. Initial Screenshot: Shows the page state BEFORE test execution
2. Final Screenshot: Shows the page state AFTER test execution

Please analyze the visual changes between the two screenshots to determine if the conditions are met.

Remember: Your response MUST start with either "PASS" or "FAIL" followed by a detailed explanation of each condition that includes both DOM and visual analysis.`;

    console.log("Sending validation prompt to GPT:", prompt);
    await this.client.beta.threads.messages.create(this.currentThread.id, {
      role: "user",
      content: prompt
    });

    const run = await this.client.beta.threads.runs.create(this.currentThread.id, {
      assistant_id: this.currentAssistant.id
    });

    let runStatus = await this.client.beta.threads.runs.retrieve(this.currentThread.id, run.id);
    while (runStatus.status !== "completed") {
      if (runStatus.status === "failed") {
        throw new Error("Assistant failed to validate THEN conditions");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await this.client.beta.threads.runs.retrieve(this.currentThread.id, run.id);
    }

    const messages = await this.client.beta.threads.messages.list(this.currentThread.id);
    const validationMessage = messages.data[0]?.content?.[0]?.text?.value;
    console.log("GPT Response to validation prompt:", validationMessage);
    if (!validationMessage) {
      throw new Error("No validation response received");
    }

    // Parse the response to determine pass/fail
    const isPassing = validationMessage.trim().toUpperCase().startsWith("PASS");

    return {
      validationMessage: validationMessage.replace(/^(PASS|FAIL)\s*/i, "").trim(),
      success: isPassing
    };
  }
}

module.exports = OpenAiClient;
