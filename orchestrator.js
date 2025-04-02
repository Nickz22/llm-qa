/**
 * Orchestrates E2E test execution with dynamic step re-evaluation based on UI state changes.
 *
 * We can probably benefit from parsing each specific Gherkin use case into its own xml file.
 *
 * For modules like the job scheduler we are bringing back lots of test elements...
 * there is almost certainly a better way to weave them into the chat then simply adding them to the text content.
 *
 * Once all of the individual tests are run the entire gherkin file is being run as its own separate test, needs to be fixed.
 *
 * Also definitely need to introduce a screenshot into the thread so ChatGPT can use images to understand.
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { JiraClient } = require("./utils/jira-client");
const OpenAiClient = require("./utils/openai-client");
const { getCurrentBranch } = require("./utils/git");
const McpClient = require("./utils/mcp-client");
const { parseGherkinToXml } = require("./utils/gherkin-parser");
const { extractContentByTag } = require("./utils/dom-parser");
const chalk = require("chalk");

const TEMP_DIR = path.join(__dirname, "temp");

const log = {
  info: (msg, ...args) => console.log(chalk.blue(`[INFO] ${new Date().toISOString()} - ${msg}`), ...args),
  warn: (msg, ...args) => console.log(chalk.yellow(`[WARN] ${new Date().toISOString()} - ${msg}`), ...args),
  error: (msg, ...args) => console.log(chalk.red(`[ERROR] ${new Date().toISOString()} - ${msg}`), ...args),
  success: (msg, ...args) => console.log(chalk.green(`[SUCCESS] ${new Date().toISOString()} - ${msg}`), ...args)
};

function cleanTempDirectory() {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      fs.readdirSync(TEMP_DIR).forEach((file) => {
        fs.unlinkSync(path.join(TEMP_DIR, file));
      });
    } else {
      fs.mkdirSync(TEMP_DIR);
    }
  } catch (error) {
    throw new Error(`Failed to clean temp directory: ${error.message}`);
  }
}

async function getSalesforceOrgUrl() {
  const rawOutput = execSync("sf org open --url-only 2>/dev/null", { encoding: "utf-8" }).trim();
  const cleanOutput = rawOutput.replace(/\\x1b\[\d+m/g, "").replace(/\[\d+m/g, "");
  const orgUrl = cleanOutput.match(/https:\/\/[^\s\]]+/)?.[0];
  if (!orgUrl) throw new Error("Failed to extract Salesforce URL from command output");
  return orgUrl;
}

async function takeSnapshot(mcp, branchName, useCaseIndex, stepIndex) {
  const snapshotFileName = `${branchName}-usecase${useCaseIndex + 1}-step${stepIndex + 1}.png`;
  const snapshotPath = path.join(TEMP_DIR, snapshotFileName);
  try {
    const result = await mcp.fullPageScreenshot(snapshotPath);
    if (!result.success) {
      throw new Error("Failed to take snapshot");
    }
    log.info(`Screenshot taken: ${snapshotPath}`);
    return snapshotPath;
  } catch (error) {
    throw new Error(`Failed to take snapshot: ${error.message}`);
  }
}

function saveUseCaseXmlFiles(useCases, branchName) {
  try {
    const xmlFiles = [];
    for (let i = 0; i < useCases.length; i++) {
      const xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n' + useCases[i];
      const xmlFile = path.join(TEMP_DIR, `${branchName}-usecase${i + 1}.xml`);
      fs.writeFileSync(xmlFile, xmlContent);
      xmlFiles.push(xmlFile);
    }
    return xmlFiles;
  } catch (error) {
    throw new Error(`Failed to save use case XML files: ${error.message}`);
  }
}

async function getUpdatedTestElements(mcp, branchName, useCaseIndex, stepIndex) {
  const domContent = await mcp.callTool("puppeteer_get_dom");
  const domFile = path.join(TEMP_DIR, `${branchName}-usecase${useCaseIndex + 1}-step${stepIndex + 1}-dom.html`);
  fs.writeFileSync(domFile, domContent.content);

  const pythonScript = path.join(__dirname, "scripts", "python", "extract_test_elements.py");
  const testElements = JSON.parse(
    execSync(`python3 ${pythonScript} "${domFile}"`, {
      encoding: "utf-8"
    })
  );

  if (!testElements?.length) {
    throw new Error("No test elements found after state change");
  }

  fs.unlinkSync(domFile);
  log.info(`Found ${testElements.length} test elements`);

  const elementsFile = path.join(TEMP_DIR, `${branchName}-usecase${useCaseIndex + 1}-step${stepIndex + 1}-elements.json`);
  fs.writeFileSync(elementsFile, JSON.stringify(testElements, null, 2));
  log.info(`Test elements saved to: ${elementsFile}`);

  const snapshotFile = await takeSnapshot(mcp, branchName, useCaseIndex, stepIndex);
  return { testElements, snapshotFile, elementsFile };
}

function mergeTestElements(existingElements, newElements) {
  try {
    const merged = [...existingElements];
    const existingIds = new Set(existingElements.map((e) => e.test_id));

    for (const element of newElements) {
      if (existingIds.has(element.test_id)) {
        continue;
      }
      merged.push(element);
      existingIds.add(element.test_id);
    }

    log.info(`Merged ${newElements.length} new elements with ${existingElements.length} existing elements`);
    return merged;
  } catch (error) {
    throw new Error(`Failed to merge test elements: ${error.message}`);
  }
}

async function findAndClick(mcp, params) {
  log.info(`Attempting to find and click element: ${params.text}`);
  const result = await mcp.callTool("puppeteer_find_and_click", { text: params.text });
  if (result.error) {
    throw new Error(result.message || `Failed to find and click element: ${params.text}`);
  }
  log.success(`Successfully clicked element: ${params.text}`);
}

function formatUseCaseSteps(useCaseXml) {
  try {
    const steps = useCaseXml.match(/<step type="[^"]+">([^<]+)<\/step>/g) || [];
    return steps.map((step) => {
      const type = step.match(/type="([^"]+)"/)?.[1] || "";
      const content = step.match(/>([^<]+)</)?.[1] || "";
      return `${type.padEnd(6)}: ${content}`;
    });
  } catch (error) {
    throw new Error(`Failed to format use case steps: ${error.message}`);
  }
}

async function executeAction(mcp, currentStep, branchName, testState, currentStepIndex, allTestElements) {
  switch (currentStep.type) {
    case "findAndClick":
      await findAndClick(mcp, currentStep);
      await mcp.callTool("puppeteer_wait", { timeout: 4000 });

      const {
        testElements: newClickElements,
        snapshotFile: newClickSnapshot,
        elementsFile: newClickElementsFile
      } = await getUpdatedTestElements(mcp, branchName, testState.useCaseIndex, currentStepIndex);
      allTestElements = mergeTestElements(allTestElements, newClickElements);

      return {
        testElements: allTestElements,
        snapshotFile: newClickSnapshot,
        elementsFile: newClickElementsFile
      };

    case "findAndType":
      log.info(`Typing "${currentStep.text}" into field: ${currentStep.field}`);
      await mcp.findAndType(currentStep.field, currentStep.text);
      await mcp.callTool("puppeteer_wait", { timeout: 4000 });

      const {
        testElements: newTypeElements,
        snapshotFile: newTypeSnapshot,
        elementsFile: newTypeElementsFile
      } = await getUpdatedTestElements(mcp, branchName, testState.useCaseIndex, currentStepIndex);
      allTestElements = mergeTestElements(allTestElements, newTypeElements);

      return {
        testElements: allTestElements,
        snapshotFile: newTypeSnapshot,
        elementsFile: newTypeElementsFile
      };

    case "reload":
      log.info("Reloading page");
      await mcp.callTool("puppeteer_reload");
      await mcp.callTool("puppeteer_wait", { timeout: 4000 });
      return {
        testElements: allTestElements,
        snapshotFile: currentSnapshot,
        elementsFile: currentElementsFile
      };

    case "waitForText":
      log.info(`Waiting for text: ${currentStep.text}`);
      await mcp.callTool("puppeteer_wait_for_text", { text: currentStep.text });
      return {
        testElements: allTestElements,
        snapshotFile: currentSnapshot,
        elementsFile: currentElementsFile
      };

    default:
      throw new Error(`Unknown action type: ${JSON.stringify(currentStep)}`);
  }
}

async function runE2eTest({ url, tag, instructions }) {
  const jira = new JiraClient();
  const openai = new OpenAiClient(process.env.OPENAI_API_KEY);
  const mcp = new McpClient("http://localhost:3000");
  let xmlFiles = [];
  const testState = {
    useCaseIndex: 0,
    stepIndex: 0,
    totalUseCases: 0,
    totalSteps: 0,
    startTime: Date.now()
  };

  try {
    cleanTempDirectory();

    const branchName = getCurrentBranch();

    const ticket = await jira.getTicket(branchName);
    if (!ticket?.fields?.description) {
      throw new Error(`No description found for ticket ${branchName}`);
    }

    const gherkinXml = parseGherkinToXml(ticket.fields.description);
    const useCases = gherkinXml.match(/<testcase>[\s\S]*?<\/testcase>/g) || [];
    xmlFiles = saveUseCaseXmlFiles(useCases, branchName);

    testState.totalUseCases = useCases.length;

    const orgUrl = await getSalesforceOrgUrl();
    await mcp.navigate(orgUrl);
    await mcp.callTool("puppeteer_wait", { timeout: 1000 });

    await mcp.navigate(url);
    await mcp.callTool("puppeteer_wait", { timeout: 5000 });

    const {
      testElements: initialElements,
      snapshotFile: initialSnapshot,
      elementsFile: initialElementsFile
    } = await getUpdatedTestElements(mcp, branchName, 0, 0);
    let allTestElements = initialElements;

    await openai.initializeThread();

    for (testState.useCaseIndex = 0; testState.useCaseIndex < useCases.length; testState.useCaseIndex++) {
      const steps = formatUseCaseSteps(useCases[testState.useCaseIndex]);
      steps.forEach((step) => log.info(`  ${step}`));

      try {
        const gherkinXmlFile = xmlFiles[testState.useCaseIndex];
        const initialPrompt = openai.getInitialPrompt(instructions);
        let currentElementsFile = initialElementsFile;

        const actions = JSON.parse(
          await openai.getResponse(initialPrompt, [
            { path: gherkinXmlFile, description: "Current use case XML containing the test steps to execute" },
            { path: currentElementsFile, description: "Available test elements in the current page state" },
            { path: initialSnapshot, description: "Current visual state of the page" }
          ])
        );

        testState.totalSteps = actions.length;

        let currentStepIndex = 0;
        const executedSteps = [];
        let currentSnapshot = initialSnapshot;

        while (currentStepIndex < testState.totalSteps) {
          const currentStep = actions[currentStepIndex];

          try {
            const result = await executeAction(mcp, currentStep, branchName, testState, currentStepIndex, allTestElements);
            allTestElements = result.testElements;
            currentSnapshot = result.snapshotFile;
            currentElementsFile = result.elementsFile;

            // Only re-evaluate remaining steps if we're not on the last action
            if (currentStepIndex < testState.totalSteps - 1) {
              // Re-evaluate remaining steps after any action since DOM state may have changed
              const updatePrompt = openai.getUpdatePrompt(
                useCases[testState.useCaseIndex],
                testState.totalSteps,
                currentStepIndex + 1,
                executedSteps,
                instructions
              );

              const updatedActions = JSON.parse(
                await openai.getResponse(updatePrompt, [
                  { path: gherkinXmlFile, description: "Current use case XML containing the test steps to execute" },
                  { path: currentElementsFile, description: "Available test elements in the current page state" },
                  { path: currentSnapshot, description: "Current visual state of the page" }
                ])
              );

              if (updatedActions.length === testState.totalSteps) {
                actions.splice(
                  currentStepIndex + 1,
                  actions.length - (currentStepIndex + 1),
                  ...updatedActions.slice(currentStepIndex + 1)
                );
              } else {
                throw new Error("GPT gave us a different number of steps than we expected, backing out of test");
              }
            }

            executedSteps.push(currentStep);
            currentStepIndex++;
          } catch (error) {
            log.error(`Failed to execute step ${currentStepIndex + 1}: ${error.message}`);
            throw error;
          }
        }

        // After executing all WHEN steps, validate THEN conditions
        const domContent = await mcp.callTool("puppeteer_get_dom");
        const finalScreenshotPath = path.join(
          TEMP_DIR,
          `${branchName}-usecase${testState.useCaseIndex + 1}-step${testState.totalSteps}.png`
        );
        const finalScreenshot = await mcp.fullPageScreenshot(finalScreenshotPath);
        if (!finalScreenshot.success) {
          throw new Error("Failed to take final screenshot");
        }

        // Filter DOM content to only include the specified tag's content
        const filteredDomContent = tag ? extractContentByTag(domContent.content, tag) : domContent.content;
        if (tag && !filteredDomContent) {
          throw new Error(`Could not find content within tag: ${tag}`);
        }

        // Save the filtered DOM content for validation
        const validationDomFile = path.join(TEMP_DIR, `${branchName}-usecase${testState.useCaseIndex + 1}-validation-dom.html`);
        fs.writeFileSync(validationDomFile, filteredDomContent);

        // Create a new OpenAI thread specifically for validation
        const validationOpenai = new OpenAiClient(process.env.OPENAI_API_KEY);
        await validationOpenai.initializeThread();
        console.log("validating then conditions");
        const validationResult = await validationOpenai.validateThenConditions(fs.readFileSync(gherkinXmlFile, "utf8"), {
          domFile: validationDomFile,
          screenshot: finalScreenshotPath,
          initialScreenshot: initialSnapshot
        }, instructions);

        try {
          await validationOpenai.endThread();
        } catch (error) {
          log.warn("Error closing validation thread:", error.message);
        }

        if (!validationResult.success) {
          log.error("THEN conditions validation failed:");
          log.error(validationResult.validationMessage);
          throw new Error("Test case failed: THEN conditions were not satisfied");
        }

        log.success("THEN conditions validated successfully");
        log.success(`Use Case #${testState.useCaseIndex + 1} completed successfully`);
      } catch (error) {
        log.error(`Use Case #${testState.useCaseIndex + 1} failed: ${error.message}`);
        throw error;
      }
    }

    const duration = (Date.now() - testState.startTime) / 1000;
    log.success(`All ${testState.totalUseCases} use cases completed successfully in ${duration.toFixed(2)} seconds`);
  } catch (error) {
    const duration = (Date.now() - testState.startTime) / 1000;
    log.error(`Test execution failed after ${duration.toFixed(2)} seconds`);
    log.error(`Failed at Use Case ${testState.useCaseIndex + 1}, Step ${testState.stepIndex + 1}`);
    log.error(error.stack);
    throw error;
  } finally {
    try {
      await openai.endThread();
      log.info("OpenAI thread closed");
    } catch (finalError) {
      log.error(`Error while closing OpenAI thread: ${finalError.message}`);
    }
  }
}

module.exports = { runE2eTest };
