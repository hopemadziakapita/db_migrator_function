const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

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

    return {
      ...config,
      connectionLimit: 10,
      connectTimeout: 10000,
      waitForConnections: true,
      queueLimit: 0,
    };
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

  async createPoolConnection(config) {
    const mysql = require("mysql2/promise");
    return mysql.createPool(config);
  }

  async getForeignKeyDependencies(connection, tableName) {
    const database = this.sourceConfig.database;
    const [foreignKeys] = await connection.execute(
      `
        SELECT 
            TABLE_NAME, 
            COLUMN_NAME, 
            REFERENCED_TABLE_NAME, 
            REFERENCED_COLUMN_NAME
        FROM 
            INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE 
            TABLE_SCHEMA = ? 
            AND REFERENCED_TABLE_NAME = ?
      `,
      [database, tableName]
    );

    return foreignKeys;
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

  async disableForeignKeyChecks(connection) {
    await connection.execute("SET FOREIGN_KEY_CHECKS = 0");
  }

  async enableForeignKeyChecks(connection) {
    await connection.execute("SET FOREIGN_KEY_CHECKS = 1");
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

  async getMigrationOrder(connection, tables) {
    const dependencyGraph = new Map();
    const visited = new Set();
    const order = [];

    for (const table of tables) {
      dependencyGraph.set(table, new Set());
    }

    for (const table of tables) {
      const foreignKeys = await this.getForeignKeyDependencies(
        connection,
        table
      );

      for (const fk of foreignKeys) {
        if (tables.includes(fk.TABLE_NAME)) {
          dependencyGraph.get(fk.TABLE_NAME).add(table);
        }
      }
    }

    function visit(table) {
      if (visited.has(table)) return;
      visited.add(table);

      for (const dep of dependencyGraph.get(table)) {
        visit(dep);
      }

      order.unshift(table);
    }

    for (const table of tables) {
      visit(table);
    }

    return order;
  }

  async migrateTable(tableName, options = {}) {
    const {
      truncateTarget = true,
      chunkSize = 1000,
      ignoreColumns = [],
      foreignKeyStrategy = "disable",
    } = options;

    const result = {
      table: tableName,
      success: false,
      rowsMigrated: 0,
      errors: [],
    };

    let sourceConn, targetConn;

    try {
      sourceConn = await this.createPoolConnection(this.sourceConfig);
      targetConn = await this.createPoolConnection(this.targetConfig);

      console.log(sourceConn);

      if (foreignKeyStrategy === "disable") {
        await this.disableForeignKeyChecks(targetConn);
      }

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
      if (targetConn && foreignKeyStrategy === "disable") {
        try {
          await this.enableForeignKeyChecks(targetConn);
        } catch (err) {
          await this.logger.error(
            `Error re-enabling foreign key checks: ${err.message}`
          );
        }
      }
      if (sourceConn) await sourceConn.end();
      if (targetConn) await targetConn.end();
    }

    return result;
  }

  async migrateTables(tables, options = {}) {
    const sourceConn = await this.createPoolConnection(this.sourceConfig);

    try {
      const migrationOrder = await this.getMigrationOrder(sourceConn, tables);

      const results = {};

      for (const table of migrationOrder) {
        results[table] = await this.migrateTable(table, options);
      }

      return results;
    } finally {
      await sourceConn.end();
    }
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
      foreignKeyStrategy: process.env.FOREIGN_KEY_STRATEGY || "disable",
    });

    console.log("Migration Results:", JSON.stringify(results, null, 2));

    process.exit(Object.values(results).every((r) => r.success) ? 0 : 1);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();

module.exports = DatabaseMigrator;
