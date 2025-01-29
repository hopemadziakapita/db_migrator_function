const DatabaseMigrator = require("./helper/migrator");

async function runMigration() {
  try {
    const migrator = new DatabaseMigrator();

    const tablesToMigrate = process.env.MIGRATION_TABLES
      ? process.env.MIGRATION_TABLES.split(",").map((t) => t.trim())
      : [];

    const results = await migrator.migrateTables(tablesToMigrate, {
      truncateTarget: process.env.TRUNCATE_TARGET === "true",
      chunkSize: parseInt(process.env.CHUNK_SIZE || "1000", 10),
      ignoreColumns: process.env.IGNORE_COLUMNS
        ? process.env.IGNORE_COLUMNS.split(",").map((c) => c.trim())
        : [],
      foreignKeyStrategy: process.env.FOREIGN_KEY_STRATEGY || "disable",
      dryRun: process.env.DRY_RUN, // Enable dry run mode
    });

    console.log("Migration Results:", JSON.stringify(results, null, 2));

    process.exit(Object.values(results).every((r) => r.success) ? 0 : 1);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
