const { execSync } = require("child_process");

function getCurrentBranch() {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    return branch;
  } catch (error) {
    throw new Error(`Failed to get current git branch: ${error.message}`);
  }
}

module.exports = { getCurrentBranch };
