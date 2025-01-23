require("dotenv").config(); // Load environment variables
const mysql = require("mysql2/promise");
const fs = require("fs").promises;
const path = require("path");

class DatabaseMigrator {
  constructor() {
    this.sourceConfig = this.getDbConfig("SOURCE");
    this.targetConfig = this.getDbConfig("TARGET");
    this.logger = this.createLogger();
  }

  getDbConfig(prefix) {
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

    return config;
  }

  createLogger() {
    const logDir = path.join(__dirname, "logs");
    // Ensure logs directory exists
    fs.mkdir(logDir, { recursive: true }).catch(console.error);

    const logFile = path.join(
      logDir,
      `migration_log_${new Date().toISOString().replace(/[:.]/g, "_")}.log`
    );

    return {
      log: async (message) => {
        const logMessage = `[${new Date().toISOString()}] ${message}\n`;
        console.log(logMessage.trim());
        await fs.appendFile(logFile, logMessage);
      },
      error: async (message) => {
        const errorMessage = `[${new Date().toISOString()}] ERROR: ${message}\n`;
        console.error(errorMessage.trim());
        await fs.appendFile(logFile, errorMessage);
      },
    };
  }

  async getTableSchema(connection, tableName) {
    try {
      const [rows] = await connection.execute(`DESCRIBE ${tableName}`);
      return rows.reduce((acc, row) => {
        acc[row.Field] = {
          type: row.Type,
          nullable: row.Null === "YES",
          default: row.Default,
          key: row.Key,
        };
        return acc;
      }, {});
    } catch (error) {
      await this.logger.error(
        `Error getting schema for table ${tableName}: ${error.message}`
      );
      throw error;
    }
  }

  async backupTable(connection, tableName) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .split(".")[0];
    const backupTableName = `${tableName}_backup_${timestamp}`;

    try {
      await connection.execute(
        `CREATE TABLE ${backupTableName} LIKE ${tableName}`
      );
      await connection.execute(
        `INSERT INTO ${backupTableName} SELECT * FROM ${tableName}`
      );

      await this.logger.log(`Created backup table: ${backupTableName}`);
      return backupTableName;
    } catch (error) {
      await this.logger.error(
        `Error creating backup for table ${tableName}: ${error.message}`
      );
      throw error;
    }
  }

  async migrateTable(tableName, options = {}) {
    const {
      truncateTarget = true,
      chunkSize = 1000,
      ignoreColumns = [],
    } = options;

    const result = {
      table: tableName,
      success: false,
      rowsMigrated: 0,
      errors: [],
    };

    let sourceConn, targetConn;

    try {
      // Establish connections
      sourceConn = await mysql.createConnection(this.sourceConfig);
      targetConn = await mysql.createConnection(this.targetConfig);
      console.log(sourceConn);

      const sourceSchema = await this.getTableSchema(sourceConn, tableName);
      const targetSchema = await this.getTableSchema(targetConn, tableName);

      const commonColumns = Object.keys(sourceSchema).filter(
        (col) => targetSchema[col] && !ignoreColumns.includes(col)
      );

      if (commonColumns.length === 0) {
        throw new Error(`No common columns found for table ${tableName}`);
      }

      const backupTableName = await this.backupTable(targetConn, tableName);

      if (truncateTarget) {
        await targetConn.execute(`TRUNCATE TABLE ${tableName}`);
      }

      const insertColumns = commonColumns;
      const insertPlaceholders = insertColumns.map(() => "?").join(", ");
      const insertQuery = `
                INSERT INTO ${tableName} 
                (${insertColumns.join(", ")}) 
                VALUES (${insertPlaceholders})
            `;

      // Fetch and migrate data in chunks
      let offset = 0;
      while (true) {
        const [rows] = await sourceConn.execute(
          `SELECT ${insertColumns.join(", ")} 
                     FROM ${tableName} 
                     LIMIT ?, ?`,
          [offset, chunkSize]
        );

        if (rows.length === 0) break;

        const insertPromises = rows.map((row) =>
          targetConn.execute(
            insertQuery,
            insertColumns.map((col) => row[col])
          )
        );

        await Promise.all(insertPromises);

        result.rowsMigrated += rows.length;
        offset += chunkSize;

        await this.logger.log(
          `Migrated ${result.rowsMigrated} rows for table ${tableName}`
        );
      }

      result.success = true;
      await this.logger.log(
        `Successfully migrated ${result.rowsMigrated} rows for table ${tableName}`
      );
    } catch (error) {
      result.success = false;
      result.errors.push(error.message);
      await this.logger.error(
        `Migration failed for table ${tableName}: ${error.message}`
      );
    } finally {
      // Close connections
      if (sourceConn) await sourceConn.end();
      if (targetConn) await targetConn.end();
    }

    return result;
  }

  async migrateTables(tables, options = {}) {
    const results = {};

    for (const table of tables) {
      try {
        results[table] = await this.migrateTable(table, options);
      } catch (error) {
        results[table] = {
          table,
          success: false,
          errors: [error.message],
        };
      }
    }

    return results;
  }
}

async function runMigration() {
  try {
    const migrator = new DatabaseMigrator();

    const tablesToMigrate = process.env.MIGRATION_TABLES
      ? process.env.MIGRATION_TABLES.split(",").map((t) => t.trim())
      : ["users", "products"];

    const results = await migrator.migrateTables(tablesToMigrate, {
      truncateTarget: process.env.TRUNCATE_TARGET === "true",
      chunkSize: parseInt(process.env.CHUNK_SIZE || "1000", 10),
      ignoreColumns: process.env.IGNORE_COLUMNS
        ? process.env.IGNORE_COLUMNS.split(",").map((c) => c.trim())
        : [],
    });

    console.log("Migration Results:", JSON.stringify(results, null, 2));
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();

module.exports = DatabaseMigrator;
