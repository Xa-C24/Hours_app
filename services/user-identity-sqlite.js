const crypto = require("node:crypto");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const markerName = "hours_user_identity_schema";
const markerSql = "CREATE TABLE hours_user_identity_schema (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL CHECK (version = 2))";
const invalid = [
  "NEW.user_id IS NULL", "typeof(NEW.user_id) != 'text'", "length(NEW.user_id) != 36",
  "length(CAST(NEW.user_id AS BLOB)) != 36", "length(replace(NEW.user_id, '-', '')) != 32", "substr(NEW.user_id, 9, 1) != '-'",
  "substr(NEW.user_id, 14, 1) != '-'", "substr(NEW.user_id, 19, 1) != '-'",
  "substr(NEW.user_id, 24, 1) != '-'", "lower(replace(NEW.user_id, '-', '')) GLOB '*[^0-9a-f]*'",
].join(" OR ");
const triggers = {
  users_user_id_insert_guard: "CREATE TRIGGER users_user_id_insert_guard BEFORE INSERT ON users WHEN " + invalid + " BEGIN SELECT RAISE(ABORT, 'users.user_id must be a UUID'); END",
  users_user_id_update_guard: "CREATE TRIGGER users_user_id_update_guard BEFORE UPDATE OF user_id ON users WHEN " + invalid + " BEGIN SELECT RAISE(ABORT, 'users.user_id must be a UUID'); END",
  users_user_id_immutable: "CREATE TRIGGER users_user_id_immutable BEFORE UPDATE OF user_id ON users WHEN OLD.user_id IS NOT NULL AND OLD.user_id IS NOT NEW.user_id COLLATE BINARY BEGIN SELECT RAISE(ABORT, 'users.user_id is immutable'); END",
  users_user_id_replace_guard: "CREATE TRIGGER users_user_id_replace_guard BEFORE INSERT ON users WHEN EXISTS (SELECT 1 FROM users WHERE username = NEW.username OR id = NEW.id OR user_id = NEW.user_id COLLATE NOCASE) BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM users WHERE username = NEW.username) THEN RAISE(ABORT, 'UNIQUE constraint failed: users.username') END; SELECT RAISE(ABORT, 'UNIQUE constraint failed: users identity; replacement forbidden'); END",
};
const legacy = {
  users_user_id_insert_guard: "CREATE TRIGGER users_user_id_insert_guard BEFORE INSERT ON users WHEN NEW.user_id IS NULL OR length(NEW.user_id) != 36 OR substr(NEW.user_id, 9, 1) != '-' OR substr(NEW.user_id, 14, 1) != '-' OR substr(NEW.user_id, 19, 1) != '-' OR substr(NEW.user_id, 24, 1) != '-' OR lower(replace(NEW.user_id, '-', '')) GLOB '*[^0-9a-f]*' BEGIN SELECT RAISE(ABORT, 'users.user_id must be a UUID'); END",
  users_user_id_immutable: "CREATE TRIGGER users_user_id_immutable BEFORE UPDATE OF user_id ON users WHEN OLD.user_id IS NOT NEW.user_id BEGIN SELECT RAISE(ABORT, 'users.user_id is immutable'); END",
};
function normalized(sql) {
  return String(sql).replace(/\bIF NOT EXISTS\b/gi, "").split(/('(?:''|[^'])*')/).map((part, index) => index % 2 ? part : part.replace(/\s+/g, " ").toLowerCase()).join("").trim().replace(/;$/, "");
}
function object(db, name) { return db.prepare("SELECT type,tbl_name,sql FROM sqlite_schema WHERE name = ?").get(name); }
function fail(message) { throw new Error("SQLite user identity protection: " + message); }
function indexKind(db) {
  const entry = object(db, "users_user_id_unique_idx");
  if (!entry) return null;
  if (entry.type !== "index" || entry.tbl_name !== "users") fail("unexpected identity index.");
  const index = db.prepare("PRAGMA index_list(users)").all().find(row => row.name === "users_user_id_unique_idx");
  const keys = db.prepare("PRAGMA index_xinfo(users_user_id_unique_idx)").all().filter(row => row.key);
  if (!index?.unique || index.partial || keys.length !== 1 || keys[0].name !== "user_id" || keys[0].desc || !["BINARY", "NOCASE"].includes(keys[0].coll)) {
    fail("unexpected identity index definition (including partial index/collation).");
  }
  return keys[0].coll;
}
function markerVersion(db) {
  const entry = object(db, markerName);
  if (!entry) return null;
  if (entry.type !== "table" || normalized(entry.sql) !== normalized(markerSql)) fail("unexpected schema marker.");
  const rows = db.prepare("SELECT singleton,version FROM hours_user_identity_schema").all();
  if (rows.length !== 1 || rows[0].singleton !== 1 || rows[0].version !== 2) fail("unexpected schema version.");
  return 2;
}
function checkProtections(db, installed) {
  const kind = indexKind(db);
  if (installed && kind !== "NOCASE") fail("identity unique index is missing or downgraded.");
  for (const [name, sql] of Object.entries(triggers)) {
    const entry = object(db, name);
    // Only this missing guard is the documented, controlled old-version rollback.
    if (!entry) {
      if (installed && name !== "users_user_id_insert_guard") fail("required identity trigger is missing.");
      continue;
    }
    if (entry.type !== "trigger" || entry.tbl_name !== "users") fail("unexpected identity trigger object.");
    const definition = normalized(entry.sql);
    if (definition !== normalized(sql) && !(installed === null && legacy[name] && definition === normalized(legacy[name]))) {
      fail("unexpected identity trigger definition.");
    }
  }
  return kind;
}
function ensureUsersIdentitySchema(db) {
  db.transaction(() => {
    const installed = markerVersion(db);
    const columns = db.prepare("PRAGMA table_info(users)").all();
    const column = columns.find(c => c.name === "user_id");
    if (!column) {
      if (installed) fail("user_id column is missing from a migrated database.");
      db.exec("ALTER TABLE users ADD COLUMN user_id TEXT");
    } else if (column.type.toUpperCase() !== "TEXT") fail("user_id must be stored as TEXT.");
    const kind = checkProtections(db, installed);
    const users = db.prepare("SELECT id,user_id FROM users ORDER BY id").all();
    const seen = new Set();
    for (const user of users) {
      if (user.user_id === null) continue;
      if (typeof user.user_id !== "string" || user.user_id.length !== 36 || !UUID.test(user.user_id)) fail("malformed UUID; no assigned identity changed.");
      const key = user.user_id.toLowerCase();
      if (seen.has(key)) fail("duplicate UUID (case insensitive); no assigned identity changed.");
      seen.add(key);
    }
    // Only known legacy definitions can be upgraded. DDL/backfill commit atomically.
    for (const [name, sql] of Object.entries(triggers)) {
      const entry = object(db, name);
      if (!entry || normalized(entry.sql) !== normalized(sql)) {
        if (entry) db.exec("DROP TRIGGER " + name);
        db.exec(sql);
      }
    }
    if (kind !== "NOCASE") {
      if (kind) db.exec("DROP INDEX users_user_id_unique_idx");
      db.exec("CREATE UNIQUE INDEX users_user_id_unique_idx ON users (user_id COLLATE NOCASE)");
    }
    const update = db.prepare("UPDATE users SET user_id = ? WHERE id = ? AND user_id IS NULL");
    for (const user of users) {
      if (user.user_id === null) {
        const id = crypto.randomUUID();
        if (seen.has(id.toLowerCase())) fail("generated UUID collision; retry the migration.");
        seen.add(id.toLowerCase()); update.run(id, user.id);
      }
    }
    const after = db.prepare("SELECT id,user_id FROM users ORDER BY id").all();
    const originals = new Map(users.map(user => [user.id, user.user_id]));
    if (after.length !== users.length) fail("account rows changed during backfill.");
    const finalIds = new Set();
    for (const user of after) {
      if (!originals.has(user.id) || typeof user.user_id !== "string" || user.user_id.length !== 36 || !UUID.test(user.user_id)) fail("incomplete or invalid UUID backfill.");
      if (originals.get(user.id) !== null && originals.get(user.id) !== user.user_id) fail("assigned identity changed during backfill.");
      const key = user.user_id.toLowerCase();
      if (finalIds.has(key)) fail("duplicate UUID after backfill.");
      finalIds.add(key);
    }
    if (!installed) {
      db.exec(markerSql);
      db.prepare("INSERT INTO hours_user_identity_schema(singleton,version) VALUES (1,2)").run();
    }
    checkProtections(db, 2);
    for (const [name, sql] of Object.entries(triggers)) {
      const entry = object(db, name);
      if (!entry || normalized(entry.sql) !== normalized(sql)) fail("identity protection not installed.");
    }
  }).immediate();
}
module.exports = { ensureUsersIdentitySchema };
