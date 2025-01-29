// logger.js
class Logger {
  async log(message) {
    console.log(message);
  }

  async error(message) {
    console.error(message);
  }
}

module.exports = new Logger();
