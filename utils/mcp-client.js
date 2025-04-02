/**
 * Client for interacting with the Model Context Protocol Puppeteer server.
 */
const axios = require("axios");

class McpClient {
  constructor(serverUrl = "http://localhost:3000") {
    this.serverUrl = serverUrl;
    this.client = axios.create({
      baseURL: serverUrl
    });
  }

  async navigate(url) {
    return this.callTool("puppeteer_navigate", { url });
  }

  async click(selector) {
    return this.callTool("puppeteer_click", { selector });
  }

  async screenshot(params) {
    return this.callTool("puppeteer_screenshot", params);
  }

  async fullPageScreenshot(path) {
    return this.callTool("puppeteer_full_page_screenshot", { path });
  }

  async type(selector, text) {
    return this.callTool("puppeteer_type", { selector, text });
  }

  async findAndClick(text) {
    return this.callTool("puppeteer_find_and_click", { text });
  }

  async findAndType(field, text) {
    return this.callTool("puppeteer_find_and_type", { field, text });
  }

  async scroll(params) {
    return this.callTool("puppeteer_scroll", params);
  }

  async getDomContent() {
    const result = await this.callTool("puppeteer_get_dom", {});
    return result.content;
  }

  async callTool(tool, args) {
    try {
      const response = await this.client.post("/mcp/call", { tool, args });
      if (response.data.isError) {
        throw new Error(response.data.content[0].text);
      }
      return response.data;
    } catch (error) {
      // If it's an error from our server, it will have more details
      if (error.response?.data?.content?.[0]?.text) {
        throw new Error(`MCP ${tool} failed: ${error.response.data.content[0].text}`);
      }
      // If it's a network error or other axios error
      if (error.response?.status === 500) {
        throw new Error(`MCP ${tool} failed with server error (500). Args: ${JSON.stringify(args)}`);
      }
      throw new Error(`MCP ${tool} failed: ${error.message}. Args: ${JSON.stringify(args)}`);
    }
  }

  async getTools() {
    const response = await this.client.get("/mcp/tools");
    return response.data;
  }
}

module.exports = McpClient;
