require("dotenv").config();
const OpenAiClient = require("./utils/openai-client");
const fs = require("fs");

jest.mock("fs", () => ({
  readFileSync: (filePath) => {
    console.log("Reading file:", filePath);
    if (filePath === "temp/test.xml") {
      const content = `<?xml version="1.0" encoding="UTF-8"?>
          <testcase>
            <step type="when">I click the Auto Schedule button</step>
          </testcase>`;
      console.log("\nXML content:", content);
      return content;
    }
    if (filePath === "temp/test-elements.json") {
      const content = JSON.stringify([
        {
          test_id: "e2e-auto-schedule-button",
          tag: "lightning-button",
          text: "Auto-Schedule Jobs"
        }
      ]);
      console.log("\nElements content:", content);
      return content;
    }
    throw new Error(`Unexpected file path: ${filePath}`);
  },
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  createReadStream: jest.fn().mockReturnValue({
    on: jest.fn(),
    pipe: jest.fn()
  })
}));

describe("OpenAiClient", () => {
  let client;
  let mockOpenAI;
  let mockThread;
  let mockMessages;
  let originalFindRelatedTestElements;

  beforeEach(() => {
    mockMessages = {
      create: jest.fn().mockImplementation((threadId, message) => {
        console.log("Creating message with content:", message.content);
        return Promise.resolve({ id: "msg_123" });
      }),
      list: jest.fn().mockImplementation(() => {
        console.log("Listing messages");
        return Promise.resolve({
          data: [
            {
              content: [
                {
                  text: {
                    value: '[{"type":"findAndClick","text":"e2e-auto-schedule-button"}]'
                  }
                }
              ]
            }
          ]
        });
      })
    };

    mockThread = {
      runs: {
        create: jest.fn((threadId, run) => {
          console.log("Creating run for thread:", threadId);
          return Promise.resolve({ id: "run_123" });
        }),
        retrieve: jest.fn((threadId, runId) => {
          console.log("Retrieving run:", runId, "for thread:", threadId);
          return Promise.resolve({ status: "completed" });
        })
      }
    };

    mockAssistants = {
      update: jest.fn().mockResolvedValue({
        tool_resources: {
          code_interpreter: {
            file_ids: ["file_123"]
          }
        }
      })
    };

    mockFiles = {
      create: jest.fn().mockResolvedValue({ id: "file_123" })
    };

    mockOpenAI = {
      beta: {
        threads: {
          create: jest.fn().mockResolvedValue({ id: "thread_123" }),
          messages: mockMessages,
          runs: mockThread.runs
        },
        assistants: mockAssistants
      },
      files: mockFiles
    };

    client = new OpenAiClient("fake-key");
    client.client = mockOpenAI;
    client.currentThread = { id: "thread_123" };
    client.currentAssistant = { id: "asst_123" };

    // Store original method and mock findRelatedTestElements
    originalFindRelatedTestElements = client.findRelatedTestElements;
    client.findRelatedTestElements = jest.fn().mockImplementation((step, gherkinStep, elementsFile) => {
      console.log("\nFinding related elements for step:", step);
      console.log("Gherkin step:", gherkinStep);
      console.log("Elements file:", elementsFile);
      return Promise.resolve({
        originalStep: step,
        gherkinStep,
        suggestedElements: [
          {
            test_id: "e2e-auto-schedule-button",
            tag: "lightning-button",
            text: "Auto-Schedule Jobs"
          }
        ],
        searchTerms: ["auto", "schedule", "button"]
      });
    });
  });

  afterEach(() => {
    // Restore original method
    if (client && originalFindRelatedTestElements) {
      client.findRelatedTestElements = originalFindRelatedTestElements;
    }
    jest.clearAllMocks();
  });

  test("retries with related elements when test ID doesn't match", async () => {
    const files = [{ path: "temp/test.xml" }, { path: "temp/test-elements.json" }];
    console.log(
      "\nStarting test with files:",
      files.map((f) => f.path)
    );

    try {
      const parsedActions = JSON.parse('[{"type":"findAndClick","text":"schedule-component"}]');
      console.log("\nParsed actions:", parsedActions);

      const xmlContent = fs.readFileSync("temp/test.xml", "utf8");
      console.log("\nXML content:", xmlContent);

      const elementsContent = fs.readFileSync("temp/test-elements.json", "utf8");
      console.log("\nElements content:", elementsContent);

      await client.processResponse(JSON.stringify(parsedActions), files);

      console.log("\nMessage create calls:", mockMessages.create.mock.calls.length);
      if (mockMessages.create.mock.calls.length > 0) {
        console.log("Message create call content:", mockMessages.create.mock.calls[0]?.[1]?.content);
      }
    } catch (error) {
      console.error("\nTest failed with error:", error);
      throw error;
    }

    expect(mockMessages.create).toHaveBeenCalled();
    const createCall = mockMessages.create.mock.calls[0];
    expect(createCall[1].content).toContain("e2e-auto-schedule-button");
    expect(createCall[1].content).toContain("Auto-Schedule Jobs");
  });
});
