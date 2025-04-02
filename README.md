# LLM QA

This repository leverages Claude Sonnet 3.5 and the Model Context Protocol to turn a Jira description into a series of executable Puppeteer actions.

## Prerequisites

- Node.js (v14 or later)
- Python 3 (for test element extraction)
- Salesforce CLI
- Jira account with API access
- OpenAI API key
- Claude API key
- Salesforce credentials
- Web browser (Chrome/Chromium)

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your credentials

## Configuration

Create a `.env` file with the following variables:

```
# Claude API Configuration
CLAUDE_API_KEY=your_claude_api_key

# Jira Configuration
JIRA_DOMAIN=your_jira_domain
JIRA_EMAIL=your_jira_email
JIRA_API_TOKEN=your_jira_api_token

# Salesforce Configuration
SF_INSTANCE_URL=your_salesforce_instance_url
SF_USERNAME=your_sf_username
SF_PASSWORD=your_sf_password
SF_SECURITY_TOKEN=your_sf_security_token

# Test Configuration
DEFAULT_LOCALE=en_US
TARGET_NAMESPACE=strk
LOG_LEVEL=debug

# Model Context Protocol Puppeteer Server
MCP_SERVER_URL=http://localhost:3000
```

## Running Tests

1. Start the Puppeteer server in one terminal.

```
npm run puppeteer:start     # Start the MCP Puppeteer server
```

2. Name your branch after the Jira ticket number you'd like to test.

```
git branch SIT-XXXXX
```

3. Launch the test runner providing the url where the UI component is located and the bounding name of the tag, for example if your Lightning Web Component is named "c-floating-modal" that would be the name of your bounding tag.

```
npm run e2e:test --url "https://some.salesforce.url" --tag "c-floating-modal"
```

## How It Works

This framework automates end-to-end testing by:

1. Extracting Gherkin test cases from Jira tickets
2. Parsing these into executable test steps
3. Using an AI orchestrator to dynamically generate and adapt browser interactions
4. Validating test outcomes against expected results

The orchestrator:
- Takes screenshots at key steps
- Extracts DOM test elements
- Re-evaluates test steps based on UI state changes
- Validates "Then" conditions after executing "When" steps

## MCP Integration

The framework leverages Model Context Protocol (MCP), an open standard developed by Anthropic that enables AI models to seamlessly integrate with external services.

### How MCP Is Used

In this application:

1. **MCP Server**: A Puppeteer-based server runs locally (at http://localhost:3000) providing browser automation capabilities

2. **MCP Client**: The `McpClient` class connects to the MCP server to:
   - Navigate to URLs
   - Take screenshots
   - Extract DOM content
   - Find and click elements
   - Type text into fields
   - Wait for specific text or timeout periods

3. **Tool Orchestration**: The orchestrator calls specific MCP tools like:
   - `puppeteer_get_dom`
   - `puppeteer_find_and_click`
   - `puppeteer_wait`
   - `puppeteer_wait_for_text`
   - `puppeteer_reload`

This implementation follows the MCP architecture where the MCP Server exposes tools and APIs that can be used by AI models (Claude in this case) through the MCP Client middleware.