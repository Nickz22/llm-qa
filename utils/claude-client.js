const axios = require("axios");
const fs = require("fs");

class ClaudeClient {
  constructor(apiKey) {
    if (!apiKey) throw new Error("You gotta have an API key, Morty! What, you think AIs just talk to anyone?");

    this.client = axios.create({
      baseURL: "https://api.anthropic.com/v1",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    });
  }

  async getResponse(prompt, files = [], maxRetries = 3) {
    let retryCount = 0;
    let lastError;

    while (retryCount <= maxRetries) {
      try {
        const messages = [
          {
            role: "user",
            content: [{ type: "text", text: prompt }]
          }
        ];

        for (const filePath of files) {
          const fileContent = fs.readFileSync(filePath, "utf-8");
          messages[0].content.push({
            type: "text",
            text: `Content of file ${filePath}:\n\n${fileContent}`
          });
        }

        const response = await this.client.post("/messages", {
          model: "claude-3-sonnet-20240229",
          max_tokens: 4096,
          messages
        });

        const text = response.data.content[0].text;
        console.log("Claude's raw response:", text);

        // Try to find a JSON array in the response
        const match = text.match(/\[([\s\S]*?)\]/);
        if (!match) {
          throw new Error("No JSON array found in Claude's response. Raw response: " + text.substring(0, 200));
        }

        // Validate that it's valid JSON
        try {
          const jsonArray = JSON.parse(`[${match[1]}]`);
          if (!Array.isArray(jsonArray)) {
            throw new Error("Parsed result is not an array");
          }
          return `[${match[1]}]`;
        } catch (err) {
          throw new Error(`Found brackets but content is not valid JSON: ${err.message}. Content: ${match[1].substring(0, 200)}`);
        }
      } catch (error) {
        lastError = error;
        if (error.response?.status === 429 && retryCount < maxRetries) {
          const delayMs = Math.pow(2, retryCount) * 1000;
          console.log(`Rate limited! Retrying in ${delayMs / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          retryCount++;
          continue;
        }
        throw new Error(`Aw geez Rick, Claude couldn't process the request: ${error.message}`);
      }
    }
    throw new Error(`Aw geez Rick, Claude couldn't process the request after ${maxRetries} retries: ${lastError.message}`);
  }

  async analyzeImage(imagePath, instruction) {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");

      const prompt = `
        You're looking at a screenshot of a Salesforce page. Based on what you see in the image,
        ${instruction}
        
        Please be specific about UI elements, layouts, and any notable features you observe.
      `;

      const response = await this.client.post("/messages", {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: base64Image
                }
              }
            ]
          }
        ]
      });

      return {
        explanation: response.data.content[0].text
      };
    } catch (error) {
      throw new Error(`Aw geez Rick, Claude couldn't analyze the image: ${error.message}`);
    }
  }
}

module.exports = ClaudeClient;
