const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const sqlitePath = path.resolve(__dirname, "..", "db-sqlite.js");
const postgresPath = path.resolve(__dirname, "..", "db-postgres.js");

const changedCredentials = {
  username: "synthetic-user",
  password_salt: "next-password-salt",
  password_hash: "next-password-hash",
  recovery_code_salt: "next-recovery-salt",
  recovery_code_hash: "next-recovery-hash",
  recovery_code_expires_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
  previous_recovery_code_salt: "old-recovery-salt",
  previous_recovery_code_hash: "old-recovery-hash",
  previous_recovery_code_expires_at_ms: null,
};

test("SQLite adapter atomically rotates credentials and revokes only the target account", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hours-auth-sqlite-"));
  const previousDbPath = process.env.DB_PATH;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousModule = require.cache[sqlitePath];
  process.env.DB_PATH = path.join(root, "auth.sqlite");
  delete process.env.DATABASE_URL;
  delete require.cache[sqlitePath];
  const db = require(sqlitePath);
  try {
    db.createUser({
      username: changedCredentials.username,
      password_salt: "old-password-salt",
      password_hash: "old-password-hash",
      recovery_code_salt: changedCredentials.previous_recovery_code_salt,
      recovery_code_hash: changedCredentials.previous_recovery_code_hash,
      recovery_code_expires_at_ms: changedCredentials.previous_recovery_code_expires_at_ms,
    });
    db.createUser({ username: "other-user", password_salt: "s", password_hash: "h", recovery_code_salt: "s", recovery_code_hash: "h" });
    db.upsertSession({ token: "target-session", username: changedCredentials.username, expires_at_ms: Date.now() + 60_000 });
    db.upsertSession({ token: "other-session", username: "other-user", expires_at_ms: Date.now() + 60_000 });
    db.createMobileAuthToken({ token_hash: "target-token", username: changedCredentials.username, expires_at_ms: Date.now() + 60_000 });
    db.createMobileAuthToken({ token_hash: "other-token", username: "other-user", expires_at_ms: Date.now() + 60_000 });

    assert.equal(db.updateUserPasswordAndRecoveryCode(changedCredentials), true);
    assert.equal(db.getUserByUsername(changedCredentials.username).password_hash, "next-password-hash");
    assert.equal(db.getSessionByToken("target-session"), null);
    assert.ok(db.getSessionByToken("other-session"));
    assert.ok(db.getMobileAuthTokenByHash("target-token").revoked_at);
    assert.equal(db.getMobileAuthTokenByHash("other-token").revoked_at, null);

    const beforeConflict = db.getUserByUsername(changedCredentials.username);
    assert.equal(db.updateUserPasswordAndRecoveryCode(changedCredentials), false);
    assert.deepEqual(db.getUserByUsername(changedCredentials.username), beforeConflict);
  } finally {
    db.close();
    delete require.cache[sqlitePath];
    if (previousModule) require.cache[sqlitePath] = previousModule;
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createPostgresDriver({ failOnRevocation = false } = {}) {
  const state = {
    user: {
      username: changedCredentials.username,
      password_salt: "old-password-salt",
      password_hash: "old-password-hash",
      recovery_code_salt: changedCredentials.previous_recovery_code_salt,
      recovery_code_hash: changedCredentials.previous_recovery_code_hash,
      recovery_code_expires_at_ms: changedCredentials.previous_recovery_code_expires_at_ms,
    },
    sessions: [
      { token: "target-session", username: changedCredentials.username },
      { token: "other-session", username: "other-user" },
    ],
    tokens: [
      { token_hash: "target-token", username: changedCredentials.username, revoked_at: null },
      { token_hash: "other-token", username: "other-user", revoked_at: null },
    ],
  };

  class Pool {
    async connect() {
      let snapshot = null;
      return {
        async query(query, params = []) {
          const sql = String(query).replace(/\s+/g, " ").trim();
          if (sql === "BEGIN") { snapshot = structuredClone(state); return { rowCount: null, rows: [] }; }
          if (sql === "ROLLBACK") { Object.assign(state, snapshot); snapshot = null; return { rowCount: null, rows: [] }; }
          if (sql === "COMMIT") { snapshot = null; return { rowCount: null, rows: [] }; }
          if (sql.startsWith("UPDATE users SET")) {
            if (state.user.recovery_code_salt !== params[7] || state.user.recovery_code_hash !== params[8]
              || (state.user.recovery_code_expires_at_ms ?? null) !== (params[9] ?? null)) return { rowCount: 0, rows: [] };
            Object.assign(state.user, { password_salt: params[1], password_hash: params[2], recovery_code_salt: params[3], recovery_code_hash: params[4], recovery_code_expires_at_ms: params[5] });
            return { rowCount: 1, rows: [] };
          }
          if (sql.startsWith("DELETE FROM sessions")) {
            state.sessions = state.sessions.filter((session) => session.username !== params[0]);
            return { rowCount: 1, rows: [] };
          }
          if (sql.startsWith("UPDATE mobile_auth_tokens")) {
            if (failOnRevocation) throw new Error("synthetic token revocation failure");
            for (const token of state.tokens) if (token.username === params[0] && !token.revoked_at) token.revoked_at = params[1];
            return { rowCount: 1, rows: [] };
          }
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    }
    async query(query, params) { return (await this.connect()).query(query, params); }
    async end() {}
  }
  return { Pool, state };
}

async function withMockPostgres(options, run) {
  const previousDbUrl = process.env.DATABASE_URL;
  const previousModule = require.cache[postgresPath];
  const originalLoad = Module._load;
  const driver = createPostgresDriver(options);
  process.env.DATABASE_URL = "postgres://synthetic.invalid/synthetic";
  delete require.cache[postgresPath];
  Module._load = function(request, parent, isMain) {
    if (request === "pg" && parent?.filename === postgresPath) return driver;
    return originalLoad.call(this, request, parent, isMain);
  };
  let db;
  try {
    db = require(postgresPath);
  } finally {
    Module._load = originalLoad;
  }
  try {
    await run(db, driver.state);
  } finally {
    await db.close();
    delete require.cache[postgresPath];
    if (previousModule) require.cache[postgresPath] = previousModule;
    if (previousDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDbUrl;
  }
}

test("PostgreSQL adapter matches SQLite's credential rotation and revocation contract", async () => {
  await withMockPostgres({}, async (db, state) => {
    assert.equal(await db.updateUserPasswordAndRecoveryCode(changedCredentials), true);
    assert.equal(state.user.password_hash, "next-password-hash");
    assert.deepEqual(state.sessions.map((session) => session.username), ["other-user"]);
    assert.ok(state.tokens.find((token) => token.username === changedCredentials.username).revoked_at);
    assert.equal(state.tokens.find((token) => token.username === "other-user").revoked_at, null);
    const beforeConflict = structuredClone(state);
    assert.equal(await db.updateUserPasswordAndRecoveryCode(changedCredentials), false);
    assert.deepEqual(state, beforeConflict);
  });
});

test("PostgreSQL adapter rolls back credentials and revocations if a transaction step fails", async () => {
  await withMockPostgres({ failOnRevocation: true }, async (db, state) => {
    const before = structuredClone(state);
    await assert.rejects(db.updateUserPasswordAndRecoveryCode(changedCredentials), /synthetic token revocation failure/);
    assert.deepEqual(state, before);
  });
});
