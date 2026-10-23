const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const projectRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hours-m02-user-id-"));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createLegacyAuthDatabase(databasePath, { includeUserId = false, preservedUserId = null } = {}) {
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${includeUserId ? "user_id TEXT," : ""}
      username TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      recovery_code_salt TEXT,
      recovery_code_hash TEXT,
      recovery_code_expires_at_ms INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      expires_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE mobile_auth_tokens (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      expires_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE work_timers (
      username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      state_json TEXT NOT NULL
    );
  `);
  const insert = database.prepare(`
    INSERT INTO users (${includeUserId ? "user_id," : ""} username, password_salt, password_hash,
      recovery_code_salt, recovery_code_hash, recovery_code_expires_at_ms, created_at, updated_at)
    VALUES (${includeUserId ? "?," : ""} ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  if (includeUserId) {
    insert.run(preservedUserId, "m02-alice", "salt-a", "hash-a", "recovery-salt-a", "recovery-hash-a", 2000000000000, "created-a", "updated-a");
    insert.run(null, "m02-bob", "salt-b", "hash-b", null, null, null, "created-b", "updated-b");
  } else {
    insert.run("m02-alice", "salt-a", "hash-a", "recovery-salt-a", "recovery-hash-a", 2000000000000, "created-a", "updated-a");
    insert.run("m02-bob", "salt-b", "hash-b", null, null, null, "created-b", "updated-b");
  }
  database.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)").run("session-a", "m02-alice", 2000000000000, "created-a", "updated-a");
  database.prepare("INSERT INTO mobile_auth_tokens VALUES (?, ?, ?, ?, ?, ?)").run("token-hash-a", "m02-alice", 2000000000000, "created-a", null, null);
  database.prepare("INSERT INTO work_timers VALUES (?, ?, ?)").run("m02-alice", 7, JSON.stringify({ clientId: "41", start: 1234 }));
  database.close();
}

function withSqliteAdapter(databasePath, callback) {
  const previousDbPath = process.env.DB_PATH;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const modulePath = require.resolve("../db-sqlite");
  process.env.DB_PATH = databasePath;
  delete process.env.DATABASE_URL;
  delete require.cache[modulePath];
  let db;
  try {
    db = require("../db-sqlite");
    return callback(db);
  } finally {
    if (db) db.close();
    delete require.cache[modulePath];
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test("SQLite backfills legacy accounts once and enforces UUID uniqueness, non-nullity and immutability", () => {
  const databasePath = path.join(tempRoot, "legacy.sqlite");
  createLegacyAuthDatabase(databasePath);
  let initialIds;

  withSqliteAdapter(databasePath, (db) => {
    const alice = db.getUserByUsername("m02-alice");
    const bob = db.getUserByUsername("m02-bob");
    assert.match(alice.user_id, uuidPattern);
    assert.match(bob.user_id, uuidPattern);
    assert.notEqual(alice.user_id, bob.user_id);
    assert.equal(alice.id, 1);
    assert.equal(alice.password_hash, "hash-a");
    assert.equal(alice.recovery_code_hash, "recovery-hash-a");
    assert.deepEqual(db.getSessionByToken("session-a"), {
      token: "session-a",
      username: "m02-alice",
      expires_at_ms: 2000000000000,
    });
    assert.equal(db.getMobileAuthTokenByHash("token-hash-a").username, "m02-alice");
    assert.deepEqual(db.getWorkTimer("m02-alice"), {
      version: 7,
      state: { clientId: "41", start: 1234 },
    });

    db.createUser({ username: "m02-new", password_salt: "salt-new", password_hash: "hash-new" });
    const created = db.getUserByUsername("m02-new");
    assert.match(created.user_id, uuidPattern);
    initialIds = { alice: alice.user_id, bob: bob.user_id, created: created.user_id };
  });

  const direct = new Database(databasePath);
  try {
    assert.throws(
      () => direct.prepare("UPDATE users SET user_id = ? WHERE username = ?").run(crypto.randomUUID(), "m02-alice"),
      /immutable/
    );
    assert.throws(
      () => direct.prepare("INSERT INTO users (username, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("missing-id", "s", "h", "c", "u"),
      /UUID/
    );
    assert.throws(
      () => direct.prepare("INSERT INTO users (user_id, username, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(initialIds.alice, "duplicate-id", "s", "h", "c", "u"),
      /UNIQUE/
    );
  } finally {
    direct.close();
  }

  withSqliteAdapter(databasePath, (db) => {
    assert.equal(db.getUserByUsername("m02-alice").user_id, initialIds.alice);
    assert.equal(db.getUserByUsername("m02-bob").user_id, initialIds.bob);
    assert.equal(db.getUserByUsername("m02-new").user_id, initialIds.created);
  });
});

test("SQLite resumes a partial UUID backfill without replacing an assigned identity", () => {
  const databasePath = path.join(tempRoot, "partial.sqlite");
  const preserved = "f8ef48ef-177f-4f99-ae76-2e825c519b11";
  createLegacyAuthDatabase(databasePath, { includeUserId: true, preservedUserId: preserved });

  withSqliteAdapter(databasePath, (db) => {
    assert.equal(db.getUserByUsername("m02-alice").user_id, preserved);
    assert.match(db.getUserByUsername("m02-bob").user_id, uuidPattern);
  });
  withSqliteAdapter(databasePath, (db) => {
    assert.equal(db.getUserByUsername("m02-alice").user_id, preserved);
    assert.match(db.getUserByUsername("m02-bob").user_id, uuidPattern);
  });
});

test("PostgreSQL phase-one migration is additive, idempotent, constrained and leaves M01 ownership untouched", () => {
  const migration = fs.readFileSync(path.join(projectRoot, "migrations", "002_user_id.sql"), "utf8");
  const schema = fs.readFileSync(path.join(projectRoot, "schema.sql"), "utf8");
  const adapter = fs.readFileSync(path.join(projectRoot, "db-postgres.js"), "utf8");

  assert.match(migration, /ADD COLUMN IF NOT EXISTS user_id UUID/);
  assert.match(migration, /UPDATE users\s+SET user_id = gen_random_uuid\(\)\s+WHERE user_id IS NULL/);
  assert.match(migration, /ALTER COLUMN user_id SET NOT NULL/);
  assert.match(migration, /ADD CONSTRAINT users_user_id_unique UNIQUE \(user_id\)/);
  assert.match(migration, /BEFORE UPDATE OF user_id ON users/);
  assert.match(migration, /NEW\.user_id IS DISTINCT FROM OLD\.user_id/);
  assert.match(schema, /user_id UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
  assert.match(adapter, /user\.user_id \|\| crypto\.randomUUID\(\)/);
  assert.doesNotMatch(migration, /UPDATE\s+\w+\s+SET\s+username\s*=/i);
  assert.doesNotMatch(migration, /ALTER\s+TABLE\s+(sessions|clients|work_entries|pay_period_salaries|settings|work_timers)/i);
});
