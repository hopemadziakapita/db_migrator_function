async function getTableSchema(connection, tableName) {
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
    throw new Error(
      `Error getting schema for table ${tableName}: ${error.message}`
    );
  }
}

async function disableForeignKeyChecks(connection) {
  await connection.execute("SET FOREIGN_KEY_CHECKS = 0");
}

async function enableForeignKeyChecks(connection) {
  await connection.execute("SET FOREIGN_KEY_CHECKS = 1");
}

async function backupTable(connection, tableName, logger) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
  const backupTableName = `${tableName}_backup_${timestamp}`;

  try {
    await connection.execute(
      `CREATE TABLE ${backupTableName} LIKE ${tableName}`
    );
    await connection.execute(
      `INSERT INTO ${backupTableName} SELECT * FROM ${tableName}`
    );

    await logger.log(`Created backup table: ${backupTableName}`);
    return backupTableName;
  } catch (error) {
    throw new Error(
      `Error creating backup for table ${tableName}: ${error.message}`
    );
  }
}

module.exports = {
  getTableSchema,
  disableForeignKeyChecks,
  enableForeignKeyChecks,
  backupTable,
};
