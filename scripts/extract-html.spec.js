/**
 * This script automates the extraction of HTML content from a specified Salesforce page, including handling
 * shadow DOM elements and iframes. The extracted content is formatted and saved for use by an LLM to assist in test writing.
 *
 * Inputs:
 * - TARGET_PATH: The URL path of the Salesforce page to extract content from. This should be set as an environment variable.
 * - TARGET_TAG: The HTML tag to search for within the page. This should be set as an environment variable.
 * - DEBUG: Optional environment variable to enable logging for debugging purposes.
 *
 * Example Invocation:
 * TARGET_PATH="https://your-org.lightning.force.com/lightning/n/strk__Dispatch_Central" TARGET_TAG="strk-st-dispatch-central" DEBUG=true npx playwright test e2e-test/scripts/extract-html.spec.js
 */
const { test, expect } = require("@playwright/test");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const prettier = require("prettier");

const logger = {
  log: (...args) => process.env.DEBUG && console.log(...args),
  error: (...args) => process.env.DEBUG && console.error(...args)
};

const CONTEXT_DIR = path.join(process.cwd(), "context");
const OUTPUT_FILE = path.join(CONTEXT_DIR, "page-content.html");

function cleanupContextDir() {
  if (fs.existsSync(CONTEXT_DIR)) {
    logger.log("Cleaning up context directory...");
    const files = fs.readdirSync(CONTEXT_DIR);
    files.forEach((file) => {
      const filePath = path.join(CONTEXT_DIR, file);
      fs.unlinkSync(filePath);
      logger.log(`Deleted ${filePath}`);
    });
  }
}

async function formatHtml(content) {
  try {
    return prettier.format(content, {
      parser: "html",
      printWidth: 120,
      tabWidth: 2,
      useTabs: false,
      htmlWhitespaceSensitivity: "ignore"
    });
  } catch (error) {
    logger.error("Error formatting HTML:", error);
    return content; // Return unformatted content if formatting fails
  }
}

async function getSalesforceOrgUrl() {
  try {
    logger.log("Getting Salesforce org URL...");
    const rawOutput = execSync("sf org open --url-only", {
      encoding: "utf-8"
    }).trim();
    logger.log("Raw sf output:", rawOutput);

    const cleanOutput = rawOutput.replace(/\\x1b\[\d+m/g, "").replace(/\[\d+m/g, "");
    const orgUrl = cleanOutput.match(/https:\/\/[^\s\]]+/)?.[0];

    if (!orgUrl) {
      throw new Error("Failed to extract Salesforce URL from command output");
    }

    logger.log("Found Salesforce org URL:", orgUrl);
    return orgUrl;
  } catch (error) {
    logger.error("Error getting Salesforce org URL:", error);
    throw error;
  }
}

async function authenticateAndNavigate(page, targetPath) {
  try {
    // First authenticate by opening the Salesforce org
    const orgUrl = await getSalesforceOrgUrl();
    logger.log("Authenticating via Salesforce org...");
    await page.goto(orgUrl, { waitUntil: "networkidle" });
    await waitForPageToLoad(page);

    // Then navigate to the target URL if provided
    if (targetPath) {
      const targetUrl = `${targetPath}`;
      logger.log("Navigating to target URL:", targetUrl);
      await page.goto(targetUrl, { waitUntil: "networkidle" });
      await waitForPageToLoad(page);
    }
  } catch (error) {
    logger.error("Error in authenticateAndNavigate:", error);
    throw error;
  }
}

async function waitForPageToLoad(page) {
  try {
    logger.log("Waiting for page to load...");
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 });

    // Wait for any Salesforce loading indicators to disappear
    await page.waitForSelector("div.loading", { state: "hidden", timeout: 30000 }).catch(() => {
      // Ignore if not found
    });

    // Give extra time for any dynamic content to load
    await page.waitForTimeout(5000);

    logger.log("Page loaded successfully");
  } catch (error) {
    logger.error("Error while waiting for page to load:", error);
    throw error;
  }
}

async function findTargetTagInFrame(frame, targetTag) {
  try {
    logger.log("Searching for target tag in frame...");

    // Search for the target tag in the main content and shadow DOM
    const content = await frame.evaluate((tag) => {
      function getFullShadowContent(root) {
        let content = "";

        // Get content from shadow roots
        if (root.shadowRoot) {
          content += root.shadowRoot.innerHTML;
          const shadowChildren = Array.from(root.shadowRoot.children);
          shadowChildren.forEach((child) => {
            content += getFullShadowContent(child);
          });
        }

        // Get content from regular children
        const children = Array.from(root.children);
        children.forEach((child) => {
          content += getFullShadowContent(child);
        });

        return content;
      }

      function findInShadowDOM(root) {
        // Check if this element is our target
        if (root.tagName && root.tagName.toLowerCase() === tag.toLowerCase()) {
          // Get the full content including shadow DOM
          const fullContent = root.outerHTML;
          const shadowContent = getFullShadowContent(root);

          // Insert shadow content before the closing tag
          const closingTag = `</${tag}>`;
          const insertIndex = fullContent.lastIndexOf(closingTag);
          if (insertIndex !== -1) {
            return fullContent.slice(0, insertIndex) + shadowContent + closingTag;
          }
          return fullContent + shadowContent;
        }

        // Check shadow DOM
        if (root.shadowRoot) {
          const shadowElement = root.shadowRoot.querySelector(tag);
          if (shadowElement) {
            return findInShadowDOM(shadowElement);
          }

          // Search children of shadow root
          const shadowChildren = Array.from(root.shadowRoot.children);
          for (const child of shadowChildren) {
            const found = findInShadowDOM(child);
            if (found) return found;
          }
        }

        // Search regular DOM children
        const children = Array.from(root.children);
        for (const child of children) {
          const found = findInShadowDOM(child);
          if (found) return found;
        }

        return null;
      }

      return findInShadowDOM(document.documentElement);
    }, targetTag);

    if (content) {
      return content;
    }

    // If not found in this frame, check child frames
    const childFrames = frame.childFrames();
    for (const childFrame of childFrames) {
      const childContent = await findTargetTagInFrame(childFrame, targetTag);
      if (childContent) {
        return childContent;
      }
    }

    return null;
  } catch (error) {
    logger.error("Error in findTargetTagInFrame:", error);
    throw error;
  }
}

async function extractPageContent(page, targetTag) {
  try {
    logger.log("Extracting page content...");

    // Clean up any existing files
    cleanupContextDir();

    // Create context directory if it doesn't exist
    if (!fs.existsSync(CONTEXT_DIR)) {
      logger.log(`Creating directory: ${CONTEXT_DIR}`);
      fs.mkdirSync(CONTEXT_DIR, { recursive: true });
    }

    const content = await findTargetTagInFrame(page.mainFrame(), targetTag);

    if (!content) {
      throw new Error(`Could not find <${targetTag}> tag`);
    }

    // Format the HTML content
    const formattedContent = await formatHtml(content);

    logger.log(`Writing ${formattedContent.length} characters to ${OUTPUT_FILE}`);
    fs.writeFileSync(OUTPUT_FILE, formattedContent);
    return formattedContent;
  } catch (error) {
    logger.error("Error in extractPageContent:", error);
    throw error;
  }
}

test("extract html content including iframes", async ({ page }) => {
  try {
    const targetPath = process.env.TARGET_PATH;
    const targetTag = process.env.TARGET_TAG;

    if (!targetTag) {
      throw new Error("TARGET_TAG environment variable must be set");
    }

    logger.log("Starting extraction process...");
    logger.log(`Looking for <${targetTag}> tag`);

    await authenticateAndNavigate(page, targetPath);
    const content = await extractPageContent(page, targetTag);

    logger.log("Extraction completed successfully");
    logger.log(`Content length: ${content.length} characters`);
    logger.log(`Output saved to: ${OUTPUT_FILE}`);

    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain(`<${targetTag}`);
    expect(content).toContain(`</${targetTag}>`);
  } catch (error) {
    logger.error("Test failed:", error);
    throw error;
  }
});
