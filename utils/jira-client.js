const axios = require("axios");
const { execSync } = require("child_process");
const path = require("path");

class JiraClient {
  constructor() {
    const missingVars = [];
    if (!process.env.JIRA_API_KEY) missingVars.push("JIRA_API_KEY");
    if (!process.env.JIRA_EMAIL) missingVars.push("JIRA_EMAIL");
    if (!process.env.JIRA_HOST) missingVars.push("JIRA_HOST");

    if (missingVars.length > 0) {
      throw new Error(`Missing required Jira environment variables: ${missingVars.join(", ")}`);
    }
  }

  async getTicket(ticketKey) {
    try {
      const scriptPath = path.join(__dirname, "..", "..", "scripts", "python", "fetch_jira_description.py");
      const description = execSync(`python3 ${scriptPath}`, {
        env: { ...process.env, TICKET_NUMBER: ticketKey },
        encoding: "utf-8"
      }).trim();

      return { fields: { description } };
    } catch (error) {
      throw new Error(`Failed to fetch Jira ticket: ${error.message}`);
    }
  }
}

module.exports = { JiraClient };
