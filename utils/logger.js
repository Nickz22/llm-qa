const fs = require("fs");
const path = require("path");

class Logger {
  constructor(logFilePath) {
    this.logFilePath = logFilePath;
    this.ensureLogFileExists();
  }

  ensureLogFileExists() {
    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    if (!fs.existsSync(this.logFilePath)) {
      fs.writeFileSync(this.logFilePath, "");
    }
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(this.logFilePath, logMessage);
    console.log(logMessage);
  }
}

module.exports = Logger;
