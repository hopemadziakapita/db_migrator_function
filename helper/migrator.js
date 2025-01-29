const { getDbConfig } = require("../config/dbConfig");
const {
  getTableSchema,
  disableForeignKeyChecks,
  enableForeignKeyChecks,
  backupTable,
} = require("../dbUtils/dbUtils");
const mysql = require("mysql2/promise");
const logger = require("./logger");

class DatabaseMigrator {
  constructor() {
    this.sourceConfig = getDbConfig("SOURCE");
    this.targetConfig = getDbConfig("TARGET");
    this.logger = logger;
    this.sourcePool = null;
    this.targetPool = null;
  }

  async migrateTable(tableName, options = {}) {
    const {
      truncateTarget = true,
      chunkSize = 1000,
      ignoreColumns = [],
      foreignKeyStrategy = "disable",
      dryRun = false,
    } = options;

    const result = {
      table: tableName,
      success: false,
      rowsMigrated: 0,
      errors: [],
    };

    try {
      if (foreignKeyStrategy === "disable" && !dryRun) {
        await disableForeignKeyChecks(this.targetPool);
      }

      const sourceSchema = await getTableSchema(this.sourcePool, tableName);
      const targetSchema = await getTableSchema(this.targetPool, tableName);

      const commonColumns = Object.keys(sourceSchema).filter(
        (col) => targetSchema[col] && !ignoreColumns.includes(col)
      );

      if (commonColumns.length === 0) {
        throw new Error(`No common columns found for table ${tableName}`);
      }

      if (!dryRun) {
        await backupTable(this.targetPool, tableName, this.logger);
      }

      if (truncateTarget && !dryRun) {
        await this.targetPool.execute(`TRUNCATE TABLE ${tableName}`);
        await this.logger.log(`Truncated target table: ${tableName}`);
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
        const [rows] = await this.sourcePool.execute(
          `SELECT ${insertColumns.join(", ")} 
           FROM ${tableName} 
           LIMIT ?, ?`,
          [offset, chunkSize]
        );

        if (rows.length === 0) break;

        if (dryRun) {
          await this.logger.log(
            `[Dry Run] Would migrate ${rows.length} rows for table ${tableName}`
          );
        } else {
          const insertPromises = rows.map((row) =>
            this.targetPool.execute(
              insertQuery,
              insertColumns.map((col) => row[col])
            )
          );

          await Promise.all(insertPromises); // Parallel chunk migration
        }

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
      if (foreignKeyStrategy === "disable" && !dryRun) {
        try {
          await enableForeignKeyChecks(this.targetPool);
        } catch (err) {
          await this.logger.error(
            `Error re-enabling foreign key checks: ${err.message}`
          );
        }
      }
    }

    return result;
  }

  async migrateTables(tables, options = {}) {
    this.sourcePool = mysql.createPool(this.sourceConfig);
    this.targetPool = mysql.createPool(this.targetConfig);

    try {
      const results = {};
      for (const table of tables) {
        results[table] = await this.migrateTable(table, options);
      }
      return results;
    } finally {
      if (this.sourcePool) await this.sourcePool.end();
      if (this.targetPool) await this.targetPool.end();
    }
  }
}

module.exports = DatabaseMigrator;
