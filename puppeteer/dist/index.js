#!/usr/bin/env node
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import puppeteer from "puppeteer";
// Define the tools once to avoid repetition
const TOOLS = [
    {
        name: "puppeteer_navigate",
        description: "Navigate to a URL",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string" },
            },
            required: ["url"],
        },
    },
    {
        name: "puppeteer_screenshot",
        description: "Take a screenshot of the current page or a specific element",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Name for the screenshot" },
                selector: { type: "string", description: "CSS selector for element to screenshot" },
                width: { type: "number", description: "Width in pixels (default: 800)" },
                height: { type: "number", description: "Height in pixels (default: 600)" },
            },
            required: ["name"],
        },
    },
    {
        name: "puppeteer_click",
        description: "Click an element on the page",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for element to click" },
            },
            required: ["selector"],
        },
    },
    {
        name: "puppeteer_fill",
        description: "Fill out an input field",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for input field" },
                value: { type: "string", description: "Value to fill" },
            },
            required: ["selector", "value"],
        },
    },
    {
        name: "puppeteer_select",
        description: "Select an element on the page with Select tag",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for element to select" },
                value: { type: "string", description: "Value to select" },
            },
            required: ["selector", "value"],
        },
    },
    {
        name: "puppeteer_hover",
        description: "Hover an element on the page",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector for element to hover" },
            },
            required: ["selector"],
        },
    },
    {
        name: "puppeteer_evaluate",
        description: "Execute JavaScript in the browser console",
        inputSchema: {
            type: "object",
            properties: {
                script: { type: "string", description: "JavaScript code to execute" },
            },
            required: ["script"],
        },
    },
];
// Global state
let browser;
let page;
const consoleLogs = [];
const screenshots = new Map();
function ensureBrowser() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!browser) {
            const npx_args = { headless: false };
            const docker_args = { headless: true, args: ["--no-sandbox", "--single-process", "--no-zygote"] };
            browser = yield puppeteer.launch(process.env.DOCKER_CONTAINER ? docker_args : npx_args);
            const pages = yield browser.pages();
            page = pages[0];
            page.on("console", (msg) => {
                const logEntry = `[${msg.type()}] ${msg.text()}`;
                consoleLogs.push(logEntry);
                server.notification({
                    method: "notifications/resources/updated",
                    params: { uri: "console://logs" },
                });
            });
        }
        return page;
    });
}
function handleToolCall(name, args) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const page = yield ensureBrowser();
        switch (name) {
            case "puppeteer_navigate":
                yield page.goto(args.url);
                return {
                    content: [{
                            type: "text",
                            text: `Navigated to ${args.url}`,
                        }],
                    isError: false,
                };
            case "puppeteer_screenshot": {
                const width = (_a = args.width) !== null && _a !== void 0 ? _a : 800;
                const height = (_b = args.height) !== null && _b !== void 0 ? _b : 600;
                yield page.setViewport({ width, height });
                const screenshot = yield (args.selector ?
                    (_c = (yield page.$(args.selector))) === null || _c === void 0 ? void 0 : _c.screenshot({ encoding: "base64" }) :
                    page.screenshot({ encoding: "base64", fullPage: false }));
                if (!screenshot) {
                    return {
                        content: [{
                                type: "text",
                                text: args.selector ? `Element not found: ${args.selector}` : "Screenshot failed",
                            }],
                        isError: true,
                    };
                }
                screenshots.set(args.name, screenshot);
                server.notification({
                    method: "notifications/resources/list_changed",
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: `Screenshot '${args.name}' taken at ${width}x${height}`,
                        },
                        {
                            type: "image",
                            data: screenshot,
                            mimeType: "image/png",
                        },
                    ],
                    isError: false,
                };
            }
            case "puppeteer_click":
                try {
                    yield page.click(args.selector);
                    return {
                        content: [{
                                type: "text",
                                text: `Clicked: ${args.selector}`,
                            }],
                        isError: false,
                    };
                }
                catch (error) {
                    return {
                        content: [{
                                type: "text",
                                text: `Failed to click ${args.selector}: ${error.message}`,
                            }],
                        isError: true,
                    };
                }
            case "puppeteer_fill":
                try {
                    yield page.waitForSelector(args.selector);
                    yield page.type(args.selector, args.value);
                    return {
                        content: [{
                                type: "text",
                                text: `Filled ${args.selector} with: ${args.value}`,
                            }],
                        isError: false,
                    };
                }
                catch (error) {
                    return {
                        content: [{
                                type: "text",
                                text: `Failed to fill ${args.selector}: ${error.message}`,
                            }],
                        isError: true,
                    };
                }
            case "puppeteer_select":
                try {
                    yield page.waitForSelector(args.selector);
                    yield page.select(args.selector, args.value);
                    return {
                        content: [{
                                type: "text",
                                text: `Selected ${args.selector} with: ${args.value}`,
                            }],
                        isError: false,
                    };
                }
                catch (error) {
                    return {
                        content: [{
                                type: "text",
                                text: `Failed to select ${args.selector}: ${error.message}`,
                            }],
                        isError: true,
                    };
                }
            case "puppeteer_hover":
                try {
                    yield page.waitForSelector(args.selector);
                    yield page.hover(args.selector);
                    return {
                        content: [{
                                type: "text",
                                text: `Hovered ${args.selector}`,
                            }],
                        isError: false,
                    };
                }
                catch (error) {
                    return {
                        content: [{
                                type: "text",
                                text: `Failed to hover ${args.selector}: ${error.message}`,
                            }],
                        isError: true,
                    };
                }
            case "puppeteer_evaluate":
                try {
                    yield page.evaluate(() => {
                        window.mcpHelper = {
                            logs: [],
                            originalConsole: Object.assign({}, console),
                        };
                        ['log', 'info', 'warn', 'error'].forEach(method => {
                            console[method] = (...args) => {
                                window.mcpHelper.logs.push(`[${method}] ${args.join(' ')}`);
                                window.mcpHelper.originalConsole[method](...args);
                            };
                        });
                    });
                    const result = yield page.evaluate(args.script);
                    const logs = yield page.evaluate(() => {
                        Object.assign(console, window.mcpHelper.originalConsole);
                        const logs = window.mcpHelper.logs;
                        delete window.mcpHelper;
                        return logs;
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Execution result:\n${JSON.stringify(result, null, 2)}\n\nConsole output:\n${logs.join('\n')}`,
                            },
                        ],
                        isError: false,
                    };
                }
                catch (error) {
                    return {
                        content: [{
                                type: "text",
                                text: `Script execution failed: ${error.message}`,
                            }],
                        isError: true,
                    };
                }
            default:
                return {
                    content: [{
                            type: "text",
                            text: `Unknown tool: ${name}`,
                        }],
                    isError: true,
                };
        }
    });
}
const server = new Server({
    name: "example-servers/puppeteer",
    version: "0.1.0",
}, {
    capabilities: {
        resources: {},
        tools: {},
    },
});
// Setup request handlers
server.setRequestHandler(ListResourcesRequestSchema, () => __awaiter(void 0, void 0, void 0, function* () {
    return ({
        resources: [
            {
                uri: "console://logs",
                mimeType: "text/plain",
                name: "Browser console logs",
            },
            ...Array.from(screenshots.keys()).map(name => ({
                uri: `screenshot://${name}`,
                mimeType: "image/png",
                name: `Screenshot: ${name}`,
            })),
        ],
    });
}));
server.setRequestHandler(ReadResourceRequestSchema, (request) => __awaiter(void 0, void 0, void 0, function* () {
    const uri = request.params.uri.toString();
    if (uri === "console://logs") {
        return {
            contents: [{
                    uri,
                    mimeType: "text/plain",
                    text: consoleLogs.join("\n"),
                }],
        };
    }
    if (uri.startsWith("screenshot://")) {
        const name = uri.split("://")[1];
        const screenshot = screenshots.get(name);
        if (screenshot) {
            return {
                contents: [{
                        uri,
                        mimeType: "image/png",
                        blob: screenshot,
                    }],
            };
        }
    }
    throw new Error(`Resource not found: ${uri}`);
}));
server.setRequestHandler(ListToolsRequestSchema, () => __awaiter(void 0, void 0, void 0, function* () {
    return ({
        tools: TOOLS,
    });
}));
server.setRequestHandler(CallToolRequestSchema, (request) => __awaiter(void 0, void 0, void 0, function* () { var _a; return handleToolCall(request.params.name, (_a = request.params.arguments) !== null && _a !== void 0 ? _a : {}); }));
function runServer() {
    return __awaiter(this, void 0, void 0, function* () {
        const transport = new StdioServerTransport();
        yield server.connect(transport);
    });
}
runServer().catch(console.error);
process.stdin.on("close", () => {
    console.error("Puppeteer MCP Server closed");
    server.close();
});
