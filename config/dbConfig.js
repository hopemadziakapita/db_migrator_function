// dbConfig.js
require("dotenv").config();

function getDbConfig(prefix) {
  const requiredVars = ["HOST", "USER", "PASSWORD", "DATABASE", "PORT"];
  const config = {};

  requiredVars.forEach((varName) => {
    const envVar = `${prefix}_DB_${varName}`;
    const value = process.env[envVar];

    if (!value) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }

    config[varName.toLowerCase()] =
      varName === "PORT" ? parseInt(value, 10) : value;
  });

  return {
    ...config,
    connectionLimit: 10,
    connectTimeout: 10000,
    waitForConnections: true,
    queueLimit: 0,
  };
}

module.exports = { getDbConfig };
