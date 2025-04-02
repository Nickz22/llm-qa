const { execSync } = require("child_process");

async function getSalesforceOrgUrl() {
  const rawOutput = execSync("sf org open --url-only", {
    encoding: "utf-8"
  }).trim();

  const cleanOutput = rawOutput.replace(/\\x1b\[\d+m/g, "").replace(/\[\d+m/g, "");
  const orgUrl = cleanOutput.match(/https:\/\/[^\s\]]+/)?.[0];

  if (!orgUrl) {
    throw new Error("Failed to extract Salesforce URL from command output");
  }

  return orgUrl;
}

module.exports = { getSalesforceOrgUrl };
