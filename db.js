const hasDatabaseUrl =
  typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim() !== "";

const adapter = hasDatabaseUrl ? require("./db-postgres") : require("./db-sqlite");

module.exports = adapter;
