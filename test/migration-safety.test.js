const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hours-migration-test-"));
process.env.SQLITE_DB_PATH = path.join(testRoot, "auth.sqlite");
const { postgresConnectionOptions } = require("../services/postgres-connection-options");
const { getUserDbPath, runMigration } = require("../scripts/migrate-sqlite-to-postgres");

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  delete process.env.SQLITE_DB_PATH;
});

test("PostgreSQL migration TLS policy permits only explicit local plaintext and verifies remote TLS", () => {
  assert.equal(postgresConnectionOptions("postgres://u:p@localhost:5432/test").ssl, false);
  assert.deepEqual(
    postgresConnectionOptions("postgres://u:p@db.localhost.example:5432/test").ssl,
    { rejectUnauthorized: true }
  );
  assert.deepEqual(
    postgresConnectionOptions("postgres://u:p@db.example:5432/test?sslmode=require").ssl,
    { rejectUnauthorized: true }
  );
  assert.throws(
    () => postgresConnectionOptions("postgres://u:p@db.example:5432/test?sslmode=disable"),
    /Unsupported PostgreSQL TLS option/
  );
});

test("migration rolls back imported synthetic rows after interruption, resumes once, then detects completion", async () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, password_salt TEXT, password_hash TEXT,
      recovery_code_salt TEXT, recovery_code_hash TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE sessions (
      token TEXT, username TEXT, expires_at_ms INTEGER, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE mobile_auth_tokens (token_hash TEXT, username TEXT, expires_at_ms INTEGER, created_at TEXT, last_used_at TEXT, revoked_at TEXT);
    CREATE TABLE work_timers (username TEXT, version INTEGER, state_json TEXT);
  `);
  sqlite.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    1, "synthetic-user", "salt", "hash", null, null, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"
  );
  sqlite.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    2, "synthetic-user-b", "salt-b", "hash-b", null, null, "2026-01-02T00:00:00Z", "2026-01-02T00:00:00Z"
  );
  sqlite.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)").run(
    "synthetic-session-a", "synthetic-user", 2000000000000, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"
  );
  sqlite.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)").run(
    "synthetic-session-b", "synthetic-user-b", 2000000000000, "2026-01-02T00:00:00Z", "2026-01-02T00:00:00Z"
  );

  sqlite.prepare("INSERT INTO mobile_auth_tokens VALUES (?, ?, ?, ?, ?, ?)").run("synthetic-token-hash", "synthetic-user", 2000000000000, "2026-01-01T00:00:00Z", null, null);
  sqlite.prepare("INSERT INTO mobile_auth_tokens VALUES (?, ?, ?, ?, ?, ?)").run("synthetic-token-hash-b", "synthetic-user-b", 2000000000000, "2026-01-02T00:00:00Z", null, null);
  sqlite.prepare("INSERT INTO work_timers VALUES (?, ?, ?)").run("synthetic-user", 4, JSON.stringify({ clientId: "7", date: "2026-01-02", end: null }));
  sqlite.prepare("INSERT INTO work_timers VALUES (?, ?, ?)").run("synthetic-user-b", 5, JSON.stringify({ clientId: "7", date: "2026-01-03", end: null }));

  function createUserDatabase(username, companyName, day, salary) {
    const userPath = getUserDbPath(username);
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    const userDb = new Database(userPath);
    userDb.exec(`
      CREATE TABLE clients (id INTEGER PRIMARY KEY, company_name TEXT, contact_name TEXT, email TEXT, phone TEXT, address TEXT, notes TEXT, company_logo TEXT, archived_at TEXT, created_at TEXT);
      CREATE TABLE work_entries (id INTEGER PRIMARY KEY, client_id INTEGER, work_date TEXT, day_type TEXT, arrival_time TEXT, departure_time TEXT, lunch_break_minutes INTEGER, worked_minutes INTEGER, comment_text TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE pay_period_salaries (id INTEGER PRIMARY KEY, client_id INTEGER, pay_period_month TEXT, salary_amount_cents INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    `);
    userDb.prepare("INSERT INTO clients VALUES (?, ?, '', '', '', '', '', '', NULL, ?)").run(7, companyName, `2026-01-${day}T00:00:00Z`);
    userDb.prepare("INSERT INTO work_entries VALUES (1, 7, ?, 'office', '09:00', '17:00', 60, 420, ?, ?, ?)").run(
      `2026-01-${day}`, `note-${username}`, `2026-01-${day}T00:00:00Z`, `2026-01-${day}T00:00:00Z`
    );
    userDb.prepare("INSERT INTO pay_period_salaries VALUES (1, 7, '2026-01', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run(salary);
    userDb.prepare("INSERT INTO settings VALUES ('theme', ?, '2026-01-01T00:00:00Z')").run(username === "synthetic-user" ? '"premium"' : '"robot"');
    userDb.close();
  }
  createUserDatabase("synthetic-user", "Synthetic Client A", "02", 12345);
  createUserDatabase("synthetic-user-b", "Synthetic Client B", "03", 67890);

  const emptyState = () => ({ users: [], clients: [], mappings: [], entries: [], salaries: [], settings: [], sessions: [], tokens: [], timers: [], migrations: [] });
  let committed = emptyState();
  let pending = null;
  const connection = {
    async query(sql, params = []) {
      if (sql === "BEGIN") { pending = structuredClone(committed); return { rowCount: null, rows: [] }; }
      if (sql === "COMMIT") { committed = pending; pending = null; return { rowCount: null, rows: [] }; }
      if (sql === "ROLLBACK") { pending = null; return { rowCount: null, rows: [] }; }
      if (sql.startsWith("SELECT source_key FROM hours_sqlite_migration_runs")) {
        const found = pending.migrations.some((row) => row.source_key === params[0]);
        return { rowCount: found ? 1 : 0, rows: found ? [{ source_key: params[0] }] : [] };
      }
      if (sql.startsWith("SELECT count(*)::int AS count FROM users")) {
        const count = pending.users.filter((row) => params[0].includes(row.username)).length;
        return { rowCount: 1, rows: [{ count }] };
      }
      if (sql.includes("INSERT INTO users")) { pending.users.push({ username: params[0] }); return { rowCount: 1, rows: [] }; }
      if (sql.includes("INSERT INTO sessions")) {
        if (!pending.users.some((row) => row.username === params[1])) throw new Error("session user foreign key violation");
        pending.sessions.push({ token: params[0], username: params[1] });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO mobile_auth_tokens")) { pending.tokens.push({ token_hash: params[0] }); return { rowCount: 1, rows: [] }; }
      if (sql.includes("INSERT INTO work_timers")) {
        if (!pending.users.some((row) => row.username === params[0])) throw new Error("timer user foreign key violation");
        pending.timers.push({ username: params[0], state_json: params[2] });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO clients")) {
        const id = 401 + pending.clients.length;
        pending.clients.push({ id, username: params[0] });
        return { rowCount: 1, rows: [{ id }] };
      }
      if (sql.includes("INSERT INTO hours_sqlite_client_id_map")) {
        pending.mappings.push({ source_client_id: params[2], target_client_id: params[3] });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO work_entries")) {
        if (!pending.clients.some((row) => row.id === params[1] && row.username === params[0])) throw new Error("entry client ownership violation");
        pending.entries.push({ username: params[0], client_id: params[1] });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO pay_period_salaries")) {
        if (!pending.clients.some((row) => row.id === params[1] && row.username === params[0])) throw new Error("salary client ownership violation");
        pending.salaries.push({ username: params[0], client_id: params[1] });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO settings")) { pending.settings.push({ username: params[0], key: params[1] }); return { rowCount: 1, rows: [] }; }
      if (sql.includes("INSERT INTO hours_sqlite_migration_runs")) { pending.migrations.push({ source_key: params[0] }); return { rowCount: 1, rows: [] }; }
      return { rowCount: null, rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return connection; } };

  try {
    await assert.rejects(
      runMigration({ sqlite, pool, sourceIdentity: "synthetic-fixture", onStage(stage) {
        if (stage === "before-commit") throw new Error("simulated interruption");
      } }),
      /simulated interruption/
    );
    assert.deepEqual(committed, emptyState(), "all synthetic rows must roll back together");

    const resumed = await runMigration({ sqlite, pool, sourceIdentity: "synthetic-fixture" });
    assert.equal(resumed.alreadyMigrated, false);
    assert.equal(resumed.migratedUsers, 2);
    assert.equal(resumed.migratedSessions, 2);
    assert.equal(committed.users.length, 2);
    assert.equal(committed.clients.length, 2);
    assert.deepEqual(committed.mappings, [
      { source_client_id: "7", target_client_id: 401 },
      { source_client_id: "7", target_client_id: 402 },
    ]);
    assert.deepEqual(committed.entries, [
      { username: "synthetic-user", client_id: 401 },
      { username: "synthetic-user-b", client_id: 402 },
    ]);
    assert.deepEqual(committed.salaries, [
      { username: "synthetic-user", client_id: 401 },
      { username: "synthetic-user-b", client_id: 402 },
    ]);
    assert.equal(committed.settings.length, 2);
    assert.deepEqual(committed.sessions, [
      { token: "synthetic-session-a", username: "synthetic-user" },
      { token: "synthetic-session-b", username: "synthetic-user-b" },
    ]);
    assert.equal(committed.tokens.length, 2);
    assert.deepEqual(JSON.parse(committed.timers[0].state_json), { clientId: "401", date: "2026-01-02", end: null });
    assert.deepEqual(JSON.parse(committed.timers[1].state_json), { clientId: "402", date: "2026-01-03", end: null });
    assert.equal(committed.migrations.length, 1);

    const repeated = await runMigration({ sqlite, pool, sourceIdentity: "synthetic-fixture" });
    assert.equal(repeated.alreadyMigrated, true);
    assert.equal(committed.clients.length, 2, "a completed source must not create duplicate clients");
    assert.equal(committed.entries.length, 2, "a completed source must not duplicate work entries");

    const preexistingDestination = emptyState();
    preexistingDestination.users.push({ username: "synthetic-user-b" });
    committed = preexistingDestination;
    await assert.rejects(
      runMigration({ sqlite, pool, sourceIdentity: "synthetic-conflict" }),
      /source accounts already exist/
    );
    assert.deepEqual(committed, preexistingDestination, "a destination account conflict must not import or overwrite rows");
  } finally {
    sqlite.close();
  }
});
