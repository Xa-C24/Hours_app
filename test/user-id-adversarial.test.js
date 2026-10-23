const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "hours-m02-audit-"));
test.after(() => fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const fixed = "f8ef48ef-177f-4f99-ae76-2e825c519b11";
let sequence = 0;
function fixture(ids) {
  const file = path.join(temporary, "fixture-" + ++sequence + ".sqlite");
  const db = new Database(file);
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, user_id TEXT, username TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, recovery_code_salt TEXT, recovery_code_hash TEXT, recovery_code_expires_at_ms INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  ids.forEach((id, i) => db.prepare("INSERT INTO users VALUES (?, ?, ?, 'synthetic-salt', 'synthetic-hash', NULL, NULL, NULL, 'created', 'updated')").run(i + 1, id, "synthetic-" + i));
  db.close(); return file;
}
function initialize(file) {
  return spawnSync(process.execPath, ["-e", "const db=require('./db-sqlite');db.close();"], {
    cwd: root, env: { ...process.env, DB_PATH: file, DATABASE_URL: "" }, encoding: "utf8", timeout: 15000,
  });
}
function inspect(file, callback) { const db = new Database(file); try { return callback(db); } finally { db.close(); } }
function ids(file) { return inspect(file, db => db.prepare("SELECT id,user_id FROM users ORDER BY id").all()); }
function insert(db, id, username) {
  return db.prepare("INSERT INTO users (user_id,username,password_salt,password_hash,created_at,updated_at) VALUES (?,?,'synthetic','synthetic','created','updated')").run(id, username);
}

test("M02 SQLite audit: invalid historical values stop backfill without changing existing IDs", () => {
  const file = fixture([null, "not-a-uuid"]);
  const before = ids(file);
  assert.notEqual(initialize(file).status, 0);
  assert.deepEqual(ids(file), before);
});
test("M02 SQLite audit: duplicate historical UUIDs abort and roll back generated IDs", () => {
  const file = fixture([fixed, fixed, null]), before = ids(file);
  assert.notEqual(initialize(file).status, 0);
  assert.deepEqual(ids(file), before);
});
test("M02 SQLite audit: interrupted backfill rolls back, resumes and preserves committed UUIDs", () => {
  const file = fixture([null, null]);
  inspect(file, db => db.exec("CREATE TRIGGER synthetic_interrupt BEFORE UPDATE OF user_id ON users WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END"));
  assert.notEqual(initialize(file).status, 0);
  assert.deepEqual(ids(file).map(row => row.user_id), [null, null]);
  inspect(file, db => db.exec("DROP TRIGGER synthetic_interrupt"));
  assert.equal(initialize(file).status, 0);
  const assigned = ids(file); assert.notEqual(assigned[0].user_id, assigned[1].user_id);
  assert.equal(initialize(file).status, 0); assert.deepEqual(ids(file), assigned);
});
test("M02 SQLite audit: SQL insert must reject a UUID with an additional hyphen", () => {
  const file = fixture([fixed]); assert.equal(initialize(file).status, 0);
  const malformed = "00000000-0000-0000-0000-00000000000-";
  assert.equal(malformed.length, 36);
  inspect(file, db => assert.throws(() => insert(db, malformed, "synthetic-malformed"), /UUID/));
});
test("M02 SQLite audit: UUID uniqueness must match PostgreSQL across letter case", () => {
  const file = fixture([fixed]); assert.equal(initialize(file).status, 0);
  inspect(file, db => assert.throws(() => insert(db, fixed.toUpperCase(), "synthetic-case-duplicate"), /UNIQUE|UUID/));
});
test("M02 SQLite audit: a same-name partial unique index cannot bypass UUID uniqueness", () => {
  const file = fixture([fixed, null]);
  inspect(file, db => db.exec("CREATE UNIQUE INDEX users_user_id_unique_idx ON users(user_id) WHERE id > 100"));
  const result = initialize(file);
  if (result.status !== 0) { assert.equal(ids(file)[0].user_id, fixed); return; }
  inspect(file, db => assert.throws(() => insert(db, fixed, "synthetic-partial-duplicate"), /UNIQUE|UUID/));
});
test("M02 SQLite audit: a same-name no-op trigger must not bypass immutability", () => {
  const file = fixture([fixed, null]);
  inspect(file, db => db.exec("CREATE TRIGGER users_user_id_immutable BEFORE UPDATE OF user_id ON users BEGIN SELECT 1; END"));
  const result = initialize(file);
  if (result.status !== 0) { assert.equal(ids(file)[0].user_id, fixed); return; }
  inspect(file, db => assert.throws(() => db.prepare("UPDATE users SET user_id=? WHERE id=1").run(crypto.randomUUID()), /immutable/));
});
test("M02 SQLite audit: documented old-version rollback must allow NULL accounts to be backfilled again", () => {
  const file = fixture([fixed]); assert.equal(initialize(file).status, 0);
  inspect(file, db => { db.exec("DROP TRIGGER users_user_id_insert_guard"); insert(db, null, "synthetic-created-by-old-version"); });
  const result = initialize(file);
  assert.equal(result.status, 0, "Restart after the documented rollback must succeed without replacing assigned UUIDs");
  assert.equal(ids(file)[0].user_id, fixed);
  assert.match(ids(file)[1].user_id, /^[0-9a-f-]{36}$/i);
});
