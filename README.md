# Database Migrator

## Overview
The **Database Migrator** is a Node.js script designed to facilitate the migration of tables and their data between two MySQL databases. It ensures a structured and efficient process by:

- Handling foreign key dependencies to determine migration order.
- Backing up target tables before inserting data.
- Supporting chunked data migration to manage large datasets.
- Providing a robust logging mechanism to track progress and errors.

## Features
- Automatically determines migration order based on foreign key dependencies.
- Handles schema differences and ignores specified columns during migration.
- Allows disabling and re-enabling foreign key checks for smooth data insertion.
- Configurable chunk size for data transfer.
- Logs all operations and errors into timestamped log files.

## Requirements
- Node.js (v14 or higher)
- MySQL Server
- `.env` file containing database credentials and configurations.

## Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/hopemadziakapita/db_migrator_function
cd db_migrator_function
```

### 2. Install Dependencies
Install the required Node.js dependencies:
```bash
npm install
```

### 3. Create a `.env` File
Create a `.env` file in the root directory and define the necessary environment variables for both source and target databases:

```env
# Source Database
SOURCE_DB_HOST=your-source-db-host
SOURCE_DB_USER=your-source-db-user
SOURCE_DB_PASSWORD=your-source-db-password
SOURCE_DB_DATABASE=your-source-db-name
SOURCE_DB_PORT=your-source-db-port

# Target Database
TARGET_DB_HOST=your-target-db-host
TARGET_DB_USER=your-target-db-user
TARGET_DB_PASSWORD=your-target-db-password
TARGET_DB_DATABASE=your-target-db-name
TARGET_DB_PORT=your-target-db-port

# Additional Configuration
MIGRATION_TABLES=table1,table2,table3   # Comma-separated list of tables to migrate
TRUNCATE_TARGET=true                   # Whether to truncate target tables before migration
CHUNK_SIZE=1000                        # Number of rows to migrate per batch
IGNORE_COLUMNS=column1,column2         # Columns to ignore during migration
FOREIGN_KEY_STRATEGY=disable           # Strategy for handling foreign keys ("disable" or "preserve")
```

### 4. Run the Migration Script
Execute the migration script with:
```bash
node index.js
```

### 5. View Logs
Logs are stored in the `logs` directory, with separate files created for each execution.

### 6. Check Migration Results
The script outputs a summary of the migration results in the console. Verify the logs and database to ensure the migration succeeded.

## How It Works
1. **Database Configuration:** The script retrieves database credentials and settings from the `.env` file.
2. **Migration Order:** It calculates the migration order by analyzing foreign key dependencies.
3. **Table Backup:** Backs up each target table before migration to ensure data safety.
4. **Data Transfer:** Transfers data in chunks, managing memory usage efficiently.
5. **Error Handling:** Logs errors and skips tables if issues arise.
6. **Finalization:** Re-enables foreign key checks if disabled.

## Customization
You can modify the migration behavior by tweaking the options passed to `migrateTables`:

- `truncateTarget`: Set to `false` to retain existing data in target tables.
- `chunkSize`: Adjust batch size for larger or smaller datasets.
- `ignoreColumns`: List of columns to exclude during migration.
- `foreignKeyStrategy`: Set to `preserve` to retain foreign key constraints during migration.

## Contribution
Feel free to fork the repository and submit pull requests for improvements or additional features. Issues and feedback are also welcome!

## License
This project is licensed under the ISC License. 

---

Happy migrating! If you encounter any issues, don't hesitate to open an issue in the repository.

