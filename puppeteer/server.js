import puppeteer from "puppeteer";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("Starting server setup...");

try {
  dotenv.config();
  console.log("Loaded environment variables");

  const app = express();
  console.log("Created Express app");

  app.use(cors());
  app.use(bodyParser.json());
  console.log("Added middleware");

  let browser;
  let page;

  const tools = [
    {
      name: "puppeteer_navigate",
      description: "Navigate to a URL",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to navigate to" }
        },
        required: ["url"]
      }
    },
    {
      name: "puppeteer_full_page_screenshot",
      description: "Take a full page screenshot of the current page",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to save the screenshot" }
        },
        required: ["path"]
      }
    },
    {
      name: "puppeteer_reload",
      description: "Reload the current page",
      parameters: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "puppeteer_get_dom",
      description: "Get the current page's DOM content",
      parameters: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "puppeteer_click",
      description: "Click an element matching the selector",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector to click" }
        },
        required: ["selector"]
      }
    },
    {
      name: "puppeteer_screenshot",
      description: "Take a screenshot of the current page",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to save the screenshot" },
          fullPage: { type: "boolean", description: "Whether to take a full page screenshot" }
        },
        required: ["path"]
      }
    },
    {
      name: "puppeteer_type",
      description: "Type text into an input field",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector for the input field" },
          text: { type: "string", description: "Text to type" }
        },
        required: ["selector", "text"]
      }
    },
    {
      name: "puppeteer_scroll",
      description: "Scroll the page vertically",
      parameters: {
        type: "object",
        properties: {
          y: { type: "number", description: "Amount to scroll vertically in pixels" }
        },
        required: ["y"]
      }
    },
    {
      name: "puppeteer_find_and_click",
      description: "Find and click an element based on its text",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text content of the element to find and click" }
        },
        required: ["text"]
      }
    },
    {
      name: "puppeteer_find_and_type",
      description: "Find an input field and type text into it",
      parameters: {
        type: "object",
        properties: {
          field: { type: "string", description: "Label or placeholder text of the input field" },
          text: { type: "string", description: "Text to type" }
        },
        required: ["field", "text"]
      }
    },
    {
      name: "puppeteer_wait_for_network_idle",
      description: "Wait for network to be idle (no requests for 500ms)",
      parameters: {
        type: "object",
        properties: {
          timeout: { type: "number", description: "Maximum time to wait in milliseconds", default: 30000 }
        }
      }
    },
    {
      name: "puppeteer_wait_for_text",
      description: "Wait for specific text to appear on the page",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to wait for" },
          timeout: { type: "number", description: "Maximum time to wait in milliseconds", default: 30000 }
        },
        required: ["text"]
      }
    },
    {
      name: "puppeteer_wait",
      description: "Wait for a specified amount of time",
      parameters: {
        type: "object",
        properties: {
          timeout: { type: "number", description: "Time to wait in milliseconds", default: 1000 }
        }
      }
    },
    {
      name: "puppeteer_confirm_element_is_in_dom",
      description: "Verify the presence of an element based on its text content without interacting with it",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text content of the element to verify" },
          timeout: { type: "number", description: "Maximum time to wait in milliseconds", default: 5000 }
        },
        required: ["text"]
      }
    }
  ];

  /* eslint-disable no-inner-declarations */
  async function ensureBrowser() {
    if (!browser) {
      console.log("Launching browser...");
      browser = await puppeteer.launch({ headless: false });
      page = await browser.newPage();
      console.log("Browser launched");
    }

    // Check if page is detached/closed and create a new one if needed
    try {
      await page.evaluate(() => true);
    } catch (err) {
      console.log("Page was detached, creating new page...");
      page = await browser.newPage();
    }

    return { browser, page };
  }

  async function handleToolCall(tool, args) {
    const { page } = await ensureBrowser();

    switch (tool) {
      case "puppeteer_get_dom":
        const content = await page.content();
        return { content };

      case "puppeteer_navigate":
        await page.goto(args.url);
        return { success: true };

      case "puppeteer_reload":
        await page.reload();
        return { success: true };

      case "puppeteer_click":
        await page.click(args.selector);
        return { success: true };

      case "puppeteer_screenshot": {
        try {
          const screenshotPath = path.resolve(__dirname, "..", args.path);
          console.log("Taking screenshot at:", screenshotPath);
          await page.screenshot({
            path: screenshotPath,
            fullPage: args.fullPage || false
          });
          return { success: true };
        } catch (error) {
          console.error("Screenshot error:", error);
          throw error;
        }
      }

      case "puppeteer_full_page_screenshot": {
        try {
          const screenshotPath = path.resolve(__dirname, "..", args.path);
          console.log("Taking full page screenshot at:", screenshotPath);
          await page.screenshot({
            path: screenshotPath,
            fullPage: true
          });
          return { success: true };
        } catch (error) {
          console.error("Full page screenshot error:", error);
          throw error;
        }
      }

      case "puppeteer_type":
        await page.type(args.selector, args.text);
        return { success: true };

      case "puppeteer_scroll":
        await page.evaluate((y) => {
          window.scrollBy(0, y);
        }, args.y);
        return { success: true };

      case "puppeteer_find_and_click":
        try {
          if (!args.text) {
            throw new Error("Required parameter 'text' was not provided for finding clickable element");
          }

          // Strip any existing e2e- prefix and create normalized test ID
          const normalizedText = args.text.replace(/^e2e-/, "");
          const testId = `e2e-${normalizedText.toLowerCase().replace(/\s+/g, "-")}`;
          const exactMatches = await page.$$(
            `[data-test-id="${testId}"] button, [data-test-id="${testId}"] a, [data-test-id="${testId}"] input[type="button"], [data-test-id="${testId}"] input[type="submit"], [data-test-id="${testId}"]`
          );

          if (exactMatches.length > 0) {
            await exactMatches[0].click();
            return { success: true };
          }

          // Try finding by text content if no test ID match
          const element = await page.$(`::-p-text("${args.text}")`);
          if (!element) {
            throw new Error(`No clickable element found with text "${args.text}" or test ID "${testId}"`);
          }

          await element.click();
          return { success: true };
        } catch (error) {
          console.error(`Error in puppeteer_find_and_click:`, error);
          return {
            error: true,
            message: `Failed to find and click element: ${error.message}`,
            details: {
              providedArgs: args,
              errorStack: error.stack
            }
          };
        }

      case "puppeteer_find_and_type": {
        const { field, text } = args;
        if (!field) {
          throw new Error("No field name provided to find input field");
        }

        try {
          // Strip any existing e2e- prefix and create normalized test ID
          const normalizedField = field.replace(/^e2e-/, "");
          const testId = `e2e-${normalizedField.toLowerCase().replace(/\s+/g, "-")}`;
          const exactMatches = await page.$$(
            `[data-test-id="${testId}"] input, [data-test-id="${testId}"] lightning-input, [data-test-id="${testId}"] textarea, [data-test-id="${testId}"] [contenteditable]`
          );
          console.log(`Found ${exactMatches.length} input fields with exact test ID: ${testId}`);

          if (exactMatches.length > 0) {
            try {
              await exactMatches[0].type(text);
              return { success: true };
            } catch (err) {
              console.log(`Failed to type into input with test-id "${testId}": ${err.message}`);
              // Fall through to regular matching
            }
          }

          // If no exact matches, get all input fields with e2e test IDs
          const inputs = await page.$$(
            '[data-test-id^="e2e-"] input, [data-test-id^="e2e-"] lightning-input, [data-test-id^="e2e-"] textarea, [data-test-id^="e2e-"] [contenteditable]'
          );
          console.log(`Found ${inputs.length} potential input fields with e2e test IDs`);

          // Get attributes for each input
          const inputInfo = await Promise.all(
            inputs.map(async (input) => {
              try {
                const attributes = await input.evaluate((el) => {
                  const parent = el.parentElement;
                  const label = parent?.querySelector("label");
                  const nearbyText = parent?.textContent?.trim();
                  const testId = el.closest("[data-test-id]")?.getAttribute("data-test-id");
                  return {
                    placeholder: el.placeholder,
                    ariaLabel: el.getAttribute("aria-label"),
                    label: label ? label.textContent : null,
                    nearbyText: nearbyText || null,
                    selector: el.id ? `#${el.id}` : null,
                    type: el.type || "text",
                    testId: testId
                  };
                });

                // Check all text sources for a match
                const textSources = [attributes.label, attributes.placeholder, attributes.ariaLabel, attributes.nearbyText]
                  .filter(Boolean)
                  .map((t) => t.toLowerCase());

                const fieldLower = field.toLowerCase();
                const isMatch = textSources.some((t) => t.includes(fieldLower));

                return isMatch ? { input, ...attributes } : null;
              } catch (err) {
                console.error("Error evaluating input:", err);
                return null;
              }
            })
          );

          // Filter out nulls and sort by label presence
          const matches = inputInfo.filter(Boolean).sort((a, b) => {
            if (a.label && !b.label) return -1;
            if (!a.label && b.label) return 1;
            return 0;
          });

          if (matches.length === 0) {
            const allFields = inputInfo
              .filter(Boolean)
              .map((info) =>
                [
                  `[${info.testId}] ${info.label || info.nearbyText}`,
                  info.placeholder && `placeholder: ${info.placeholder}`,
                  info.ariaLabel && `aria-label: ${info.ariaLabel}`
                ].filter(Boolean)
              )
              .flat()
              .join(", ");
            throw new Error(`Could not find input field matching "${field}". Available fields: ${allFields}`);
          }

          // Try typing into each match until one succeeds
          const errors = [];
          for (const match of matches) {
            try {
              await match.input.type(text);
              return { success: true };
            } catch (err) {
              errors.push(`Failed to type into field with test-id "${match.testId}": ${err.message}`);
              continue;
            }
          }

          throw new Error(
            `Found ${matches.length} input fields matching "${field}" but could not type into any. Errors: ${errors.join("; ")}`
          );
        } catch (error) {
          throw new Error(`Failed to type "${text}" into field "${field}": ${error.message}`);
        }
      }

      case "puppeteer_wait_for_network_idle": {
        const timeout = args.timeout || 30000;
        await page.waitForNetworkIdle({ timeout });
        return { success: true };
      }

      case "puppeteer_wait_for_text":
        try {
          if (!args.text) {
            throw new Error("Required parameter 'text' was not provided for waiting for text");
          }

          await page.waitForFunction(
            (text) => {
              return document.body.innerText.includes(text);
            },
            { timeout: 10000 },
            args.text
          );
          return { success: true };
        } catch (error) {
          console.error(`Error in puppeteer_wait_for_text:`, error);
          return {
            error: true,
            message: `Failed to find text: ${error.message}`,
            details: {
              providedArgs: args,
              errorStack: error.stack
            }
          };
        }

      case "puppeteer_wait": {
        const timeout = args.timeout || 1000;
        await new Promise((resolve) => setTimeout(resolve, timeout));
        return { success: true };
      }

      case "puppeteer_confirm_element_is_in_dom":
        try {
          if (!args.text) {
            throw new Error("Required parameter 'text' was not provided for verifying element");
          }

          const timeout = args.timeout || 5000;
          await page.waitForFunction(
            (text) => {
              const elements = document.evaluate(
                `//*[contains(text(), "${text}")]`,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
              );
              return elements.snapshotLength > 0;
            },
            { timeout },
            args.text
          );

          return {
            success: true,
            message: `Successfully verified presence of element with text "${args.text}"`
          };
        } catch (error) {
          return {
            error: true,
            message: `Failed to verify element presence: ${error.message}`,
            details: {
              providedArgs: args,
              errorStack: error.stack
            }
          };
        }

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  app.post("/mcp/call", async (req, res) => {
    try {
      const { tool, args } = req.body;
      console.log(`Handling tool call: ${tool}`, args);
      const result = await handleToolCall(tool, args);
      res.json(result);
    } catch (error) {
      console.error("Error handling tool call:", error);
      res.status(500).json({
        error: error.message,
        stack: error.stack,
        tool: req.body.tool,
        args: req.body.args,
        timestamp: new Date().toISOString()
      });
    }
  });

  app.get("/mcp/tools", (req, res) => {
    res.json(tools);
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`MCP Server running on port ${port}`);
  });
} catch (error) {
  console.error("Server setup failed:", error);
  process.exit(1);
}
