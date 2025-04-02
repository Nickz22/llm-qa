const path = require("path");
const dotenv = require("dotenv");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const { runE2eTest } = require("./orchestrator");

// Load environment variables from .env file
const envPath = path.join(__dirname, ".env");
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error("Error loading .env file:", result.error);
  process.exit(1);
}

const argv = yargs(hideBin(process.argv))
  .option("url", {
    alias: "u",
    type: "string",
    description: "The URL to test",
    demandOption: true
  })
  .option("tag", {
    alias: "t",
    type: "string",
    description: "The tag to use for extracting HTML",
    demandOption: true
  })
  .option("instructions", {
    alias: "i",
    type: "string",
    description: "Additional instructions for ChatGPT test generation",
    demandOption: false
  }).argv;

runE2eTest({
  url: argv.url,
  tag: argv.tag,
  instructions: argv.instructions
});
