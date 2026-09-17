// Logger module for structured logging
const fs = require('fs');
const path = require('path');

class Logger {
  constructor(logFile = null) {
    this.logs = [];
    this.logFile = logFile || path.join(__dirname, 'logs', `scraper-${Date.now()}.log`);
    this.ensureLogDir();
  }

  ensureLogDir() {
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, level, message, data };
    this.logs.push(entry);

    // Console output
    const colorCode = this._getColorCode(level);
    const formatted = `${colorCode}[${level}]${'\x1b[0m'} ${message}`;
    console.log(formatted);

    // Write to file
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
      } catch (e) {
        // Ignore file write errors
      }
    }
  }

  _getColorCode(level) {
    const colors = {
      'INFO': '\x1b[32m',
      'WARN': '\x1b[33m',
      'ERROR': '\x1b[31m',
      'DEBUG': '\x1b[36m'
    };
    return colors[level] || '';
  }

  info(message, data = null) {
    this._log('INFO', message, data);
  }

  warn(message, data = null) {
    this._log('WARN', message, data);
  }

  error(message, data = null) {
    this._log('ERROR', message, data);
  }

  debug(message, data = null) {
    this._log('DEBUG', message, data);
  }

  getLogs() {
    return this.logs;
  }

  saveLogs() {
    if (!this.logFile) return null;
    try {
      fs.writeFileSync(this.logFile, JSON.stringify(this.logs, null, 2));
      return this.logFile;
    } catch (e) {
      return null;
    }
  }
}

module.exports = new Logger();
