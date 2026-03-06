const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const defaultDbPath = path.join(__dirname, "data", "hours.db");
const dbPath = process.env.DB_PATH || defaultDbPath;
const schemaPath = path.join(__dirname, "schema.sql");
const userDbsDir = path.join(path.dirname(dbPath), "users");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(userDbsDir, { recursive: true });

const authDb = new Database(dbPath);
authDb.pragma("journal_mode = WAL");

const schemaSql = fs.readFileSync(schemaPath, "utf8");
authDb.exec(schemaSql);

function ensureWorkEntriesCommentColumn(database) {
  const columns = database.prepare("PRAGMA table_info(work_entries)").all();
  const hasCommentColumn = columns.some((column) => column.name === "comment_text");
  if (!hasCommentColumn) {
    database
      .prepare("ALTER TABLE work_entries ADD COLUMN comment_text TEXT NOT NULL DEFAULT ''")
      .run();
  }
}

ensureWorkEntriesCommentColumn(authDb);

const getUserByUsernameStmt = authDb.prepare(`
  SELECT
    id,
    username,
    password_salt,
    password_hash
  FROM users
  WHERE username = ?
`);

const createUserStmt = authDb.prepare(`
  INSERT INTO users (
    username,
    password_salt,
    password_hash,
    created_at,
    updated_at
  )
  VALUES (
    @username,
    @password_salt,
    @password_hash,
    datetime('now'),
    datetime('now')
  )
`);

const workEntriesSchemaSql = `
CREATE TABLE IF NOT EXISTS work_entries (
  work_date TEXT PRIMARY KEY
    CHECK (work_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  arrival_time TEXT NOT NULL
    CHECK (arrival_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  departure_time TEXT NOT NULL
    CHECK (departure_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  lunch_break_minutes INTEGER NOT NULL
    CHECK (lunch_break_minutes >= 0 AND lunch_break_minutes <= 480),
  worked_minutes INTEGER NOT NULL
    CHECK (worked_minutes >= 0),
  comment_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_entries_work_date
  ON work_entries (work_date);
`;

const userStores = new Map();

function migrateExistingUserDbs() {
  if (!fs.existsSync(userDbsDir)) {
    return;
  }
  const files = fs.readdirSync(userDbsDir).filter((file) => file.endsWith(".db"));
  for (const file of files) {
    const filePath = path.join(userDbsDir, file);
    const userDb = new Database(filePath);
    userDb.pragma("journal_mode = WAL");
    userDb.exec(workEntriesSchemaSql);
    ensureWorkEntriesCommentColumn(userDb);
    userDb.close();
  }
}

migrateExistingUserDbs();

function getUserDbPath(username) {
  const usernameHash = crypto.createHash("sha256").update(username).digest("hex");
  return path.join(userDbsDir, `${usernameHash}.db`);
}

function getUserStore(username) {
  const safeUsername = typeof username === "string" ? username.trim() : "";
  if (!safeUsername) {
    throw new Error("Username is required to access user database.");
  }

  if (userStores.has(safeUsername)) {
    return userStores.get(safeUsername);
  }

  const userDbPath = getUserDbPath(safeUsername);
  const userDb = new Database(userDbPath);
  userDb.pragma("journal_mode = WAL");
  userDb.exec(workEntriesSchemaSql);
  ensureWorkEntriesCommentColumn(userDb);

  const store = {
    upsertEntryStmt: userDb.prepare(`
      INSERT INTO work_entries (
        work_date,
        arrival_time,
        departure_time,
        lunch_break_minutes,
        worked_minutes,
        comment_text,
        created_at,
        updated_at
      )
      VALUES (
        @work_date,
        @arrival_time,
        @departure_time,
        @lunch_break_minutes,
        @worked_minutes,
        @comment_text,
        datetime('now'),
        datetime('now')
      )
      ON CONFLICT(work_date) DO UPDATE SET
        arrival_time = excluded.arrival_time,
        departure_time = excluded.departure_time,
        lunch_break_minutes = excluded.lunch_break_minutes,
        worked_minutes = excluded.worked_minutes,
        comment_text = excluded.comment_text,
        updated_at = datetime('now')
    `),
    deleteEntryStmt: userDb.prepare(`
      DELETE FROM work_entries
      WHERE work_date = ?
    `),
    getEntriesForMonthStmt: userDb.prepare(`
      SELECT
        work_date,
        arrival_time,
        departure_time,
        lunch_break_minutes,
        worked_minutes,
        comment_text
      FROM work_entries
      WHERE work_date >= ? AND work_date < ?
      ORDER BY work_date ASC
    `),
  };

  userStores.set(safeUsername, store);
  return store;
}

function ensureUserDatabase(username) {
  getUserStore(username);
}

function upsertEntry(username, entry) {
  const store = getUserStore(username);
  store.upsertEntryStmt.run(entry);
}

function deleteEntry(username, workDate) {
  const store = getUserStore(username);
  store.deleteEntryStmt.run(workDate);
}

function getEntriesForMonth(username, startDate, endDate) {
  const store = getUserStore(username);
  return store.getEntriesForMonthStmt.all(startDate, endDate);
}

function getUserByUsername(username) {
  return getUserByUsernameStmt.get(username) || null;
}

function createUser(user) {
  createUserStmt.run(user);
}

module.exports = {
  upsertEntry,
  deleteEntry,
  getEntriesForMonth,
  ensureUserDatabase,
  getUserByUsername,
  createUser,
};
