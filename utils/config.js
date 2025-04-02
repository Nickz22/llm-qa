const dotenv = require("dotenv");
const path = require("path");

class ConfigLoader {
  constructor() {
    // Load environment variables from .env file
    dotenv.config({ path: path.join(__dirname, "../../.env") });

    // Required environment variables
    const requiredVars = [
      "CLAUDE_API_KEY",
      "JIRA_DOMAIN",
      "JIRA_EMAIL",
      "JIRA_API_TOKEN",
      "SF_INSTANCE_URL",
      "SF_USERNAME",
      "SF_PASSWORD",
      "SF_SECURITY_TOKEN",
      "MCP_SERVER_URL"
    ];

    // Check for missing required variables
    const missingVars = requiredVars.filter((varName) => !process.env[varName]);

    if (missingVars.length > 0) {
      throw new Error(`Aw geez Rick, we're missing some crucial environment variables: ${missingVars.join(", ")}`);
    }
  }

  get config() {
    return {
      claude: {
        apiKey: process.env.CLAUDE_API_KEY
      },
      jira: {
        domain: process.env.JIRA_DOMAIN,
        email: process.env.JIRA_EMAIL,
        apiToken: process.env.JIRA_API_TOKEN
      },
      salesforce: {
        instanceUrl: process.env.SF_INSTANCE_URL,
        username: process.env.SF_USERNAME,
        password: process.env.SF_PASSWORD,
        securityToken: process.env.SF_SECURITY_TOKEN
      },
      mcp: {
        serverUrl: process.env.MCP_SERVER_URL
      },
      test: {
        defaultLocale: process.env.DEFAULT_LOCALE || "en_US",
        targetNamespace: process.env.TARGET_NAMESPACE || "strk",
        logLevel: process.env.LOG_LEVEL || "info"
      }
    };
  }
}

module.exports = new ConfigLoader().config;
