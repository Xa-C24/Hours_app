const sqliteAdapter = require("./db-sqlite");

const hasDatabaseUrl =
  typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim() !== "";

const adapter = hasDatabaseUrl ? require("./db-postgres") : sqliteAdapter;

module.exports = adapter;
