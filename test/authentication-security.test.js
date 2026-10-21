const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const serverPath = path.resolve(__dirname, "..", "server.js");
const dbPath = path.resolve(__dirname, "..", "db.js");

function hash(value, salt) {
  return crypto.scryptSync(value, salt, 64).toString("hex");
}

function buildDb({ createUserError = null, ensureUserDatabaseError = null, users = [] } = {}) {
  const userStore = new Map(users.map((user) => [user.username, { ...user }]));
  const sessions = new Map();
  const mobileTokens = new Map();
  const calls = { createUser: 0, ensureUserDatabase: 0, cleanup: 0, updateCredentials: 0 };
  return {
    calls,
    userStore,
    sessions,
    mobileTokens,
    async getSessionByToken(token) { return sessions.get(token) || null; },
    async touchSession(token, expiresAtMs) {
      const session = sessions.get(token);
      if (!session) return false;
      session.expires_at_ms = expiresAtMs;
      return true;
    },
    async deleteSession(token) { sessions.delete(token); },
    async deleteExpiredSessions(now) {
      for (const [token, session] of sessions) if (session.expires_at_ms <= now) sessions.delete(token);
    },
    async upsertSession(session) { sessions.set(session.token, { ...session }); },
    async getUserByUsername(username) { return userStore.get(username) || null; },
    async createUser(user) {
      calls.createUser += 1;
      if (createUserError) throw createUserError;
      if (userStore.has(user.username)) {
        const error = new Error("duplicate");
        error.code = "SQLITE_CONSTRAINT_UNIQUE";
        throw error;
      }
      userStore.set(user.username, { ...user });
    },
    async ensureUserDatabase() {
      calls.ensureUserDatabase += 1;
      if (ensureUserDatabaseError) throw ensureUserDatabaseError;
    },
    async deleteUserAfterFailedProvisioning(username) {
      calls.cleanup += 1;
      userStore.delete(username);
    },
    async updateUserPasswordAndRecoveryCode(next) {
      calls.updateCredentials += 1;
      const user = userStore.get(next.username);
      if (!user || user.recovery_code_salt !== next.previous_recovery_code_salt
        || user.recovery_code_hash !== next.previous_recovery_code_hash
        || (user.recovery_code_expires_at_ms ?? null) !== next.previous_recovery_code_expires_at_ms) return false;
      Object.assign(user, {
        password_salt: next.password_salt,
        password_hash: next.password_hash,
        recovery_code_salt: next.recovery_code_salt,
        recovery_code_hash: next.recovery_code_hash,
        recovery_code_expires_at_ms: next.recovery_code_expires_at_ms,
      });
      for (const [token, session] of sessions) if (session.username === next.username) sessions.delete(token);
      for (const token of mobileTokens.values()) {
        if (token.username === next.username && !token.revoked_at) token.revoked_at = new Date().toISOString();
      }
      return true;
    },
  };
}

async function withAuthServer(options, run) {
  const previousDb = require.cache[dbPath];
  const previousServer = require.cache[serverPath];
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.NODE_ENV = "test";
  const db = buildDb(options);
  delete require.cache[serverPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  const { app } = require(serverPath);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`, db);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    delete require.cache[serverPath];
    if (previousServer) require.cache[serverPath] = previousServer;
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

async function csrfContext(baseUrl, page) {
  const response = await fetch(`${baseUrl}/${page}`);
  const html = await response.text();
  const csrfCookie = response.headers.getSetCookie().find((value) => value.startsWith("hours_csrf="))?.split(";")[0];
  const csrfToken = html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1];
  assert.ok(csrfCookie);
  assert.ok(csrfToken);
  return { cookie: csrfCookie, csrfToken };
}

async function postForm(baseUrl, page, fields, context) {
  const response = await fetch(`${baseUrl}/${page}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: context.cookie },
    body: new URLSearchParams({ ...fields, _csrf: context.csrfToken }),
    redirect: "manual",
  });
  return { response, html: await response.text() };
}

test("registration creates the account before provisioning and displays a one-time recovery code", async () => {
  await withAuthServer({}, async (baseUrl, db) => {
    const context = await csrfContext(baseUrl, "register");
    const { response, html } = await postForm(baseUrl, "register", { username: "alice", password: "correct horse battery" }, context);
    assert.equal(response.status, 200);
    assert.equal(db.calls.createUser, 1);
    assert.equal(db.calls.ensureUserDatabase, 1);
    assert.ok(db.userStore.has("alice"));
    assert.ok(db.userStore.get("alice").recovery_code_expires_at_ms > Date.now());
    assert.match(response.headers.get("cache-control"), /no-store/i);
    assert.match(html, /Votre code de récupération/);
    assert.match(html, /[A-Za-z0-9_-]{32}/);
    assert.doesNotMatch(html, /password_hash/);
  });
});

test("failed account insertion does not create an orphan user database", async () => {
  await withAuthServer({ createUserError: new Error("synthetic insertion failure") }, async (baseUrl, db) => {
    const context = await csrfContext(baseUrl, "register");
    const { response, html } = await postForm(baseUrl, "register", { username: "alice", password: "correct horse battery" }, context);
    assert.equal(response.status, 500);
    assert.equal(db.calls.ensureUserDatabase, 0);
    assert.equal(db.calls.cleanup, 0);
    assert.equal(db.userStore.has("alice"), false);
    assert.doesNotMatch(html, /synthetic insertion failure|password_hash/);
  });
});

test("failed user database provisioning removes the newly created authentication account", async () => {
  await withAuthServer({ ensureUserDatabaseError: new Error("synthetic provisioning failure") }, async (baseUrl, db) => {
    const context = await csrfContext(baseUrl, "register");
    const { response } = await postForm(baseUrl, "register", { username: "alice", password: "correct horse battery" }, context);
    assert.equal(response.status, 500);
    assert.equal(db.calls.createUser, 1);
    assert.equal(db.calls.ensureUserDatabase, 1);
    assert.equal(db.calls.cleanup, 1);
    assert.equal(db.userStore.has("alice"), false);
  });
});

test("login accepts the correct password and gives the same response for invalid credentials", async () => {
  const salt = "fixture-salt";
  await withAuthServer({ users: [{ username: "alice", password_salt: salt, password_hash: hash("correct horse battery", salt) }] }, async (baseUrl, db) => {
    const context = await csrfContext(baseUrl, "login");
    const good = await postForm(baseUrl, "login", { username: "alice", password: "correct horse battery" }, context);
    assert.equal(good.response.status, 302);
    assert.equal(db.sessions.size, 1);
    const bad = await postForm(baseUrl, "login", { username: "alice", password: "wrong password" }, context);
    assert.equal(bad.response.status, 200);
    assert.match(bad.html, /Connexion impossible avec les informations fournies/);
    assert.doesNotMatch(bad.html, /identifiant incorrect|mot de passe incorrect/i);
  });
});

test("login remains compatible with existing passwords longer than the new registration limit", async () => {
  const salt = "legacy-long-password-salt";
  const legacyPassword = "é".repeat(129);
  await withAuthServer({ users: [{ username: "legacy", password_salt: salt, password_hash: hash(legacyPassword, salt) }] }, async (baseUrl, db) => {
    const context = await csrfContext(baseUrl, "login");
    const result = await postForm(baseUrl, "login", { username: "legacy", password: legacyPassword }, context);
    assert.equal(result.response.status, 302);
    assert.equal(db.sessions.size, 1);
  });
});

test("password recovery rotates credentials and revokes the account's sessions and mobile tokens", async () => {
  const salt = "fixture-salt";
  const user = {
    username: "alice", password_salt: salt, password_hash: hash("old password", salt),
    recovery_code_salt: salt, recovery_code_hash: hash("123456", salt),
  };
  await withAuthServer({ users: [user] }, async (baseUrl, db) => {
    db.sessions.set("alice-session", { token: "alice-session", username: "alice", expires_at_ms: Date.now() + 60_000 });
    db.sessions.set("bob-session", { token: "bob-session", username: "bob", expires_at_ms: Date.now() + 60_000 });
    db.mobileTokens.set("alice-mobile", { username: "alice", revoked_at: null });
    db.mobileTokens.set("bob-mobile", { username: "bob", revoked_at: null });
    const context = await csrfContext(baseUrl, "forgot-password");
    const fields = { username: "alice", recoveryCode: "123456", newPassword: "new secure password", confirmPassword: "new secure password" };
    const result = await postForm(baseUrl, "forgot-password", fields, context);
    assert.equal(result.response.status, 200);
    assert.equal(db.calls.updateCredentials, 1);
    assert.ok(db.userStore.get("alice").recovery_code_expires_at_ms > Date.now());
    assert.equal(db.sessions.has("alice-session"), false);
    assert.equal(db.sessions.has("bob-session"), true);
    assert.ok(db.mobileTokens.get("alice-mobile").revoked_at);
    assert.equal(db.mobileTokens.get("bob-mobile").revoked_at, null);
    assert.match(result.html, /Mot de passe réinitialisé/);
    const invalid = await postForm(baseUrl, "forgot-password", fields, context);
    assert.match(invalid.html, /Réinitialisation impossible avec les informations fournies/);
    assert.equal(db.calls.updateCredentials, 1);
  });
});

test("expired recovery codes cannot change credentials or revoke active sessions", async () => {
  const salt = "fixture-salt";
  const user = {
    username: "alice", password_salt: salt, password_hash: hash("old password", salt),
    recovery_code_salt: salt, recovery_code_hash: hash("123456", salt),
    recovery_code_expires_at_ms: Date.now() - 1,
  };
  await withAuthServer({ users: [user] }, async (baseUrl, db) => {
    db.sessions.set("alice-session", { token: "alice-session", username: "alice", expires_at_ms: Date.now() + 60_000 });
    const context = await csrfContext(baseUrl, "forgot-password");
    const result = await postForm(baseUrl, "forgot-password", {
      username: "alice", recoveryCode: "123456", newPassword: "new secure password", confirmPassword: "new secure password",
    }, context);
    assert.equal(result.response.status, 200);
    assert.match(result.html, /Réinitialisation impossible avec les informations fournies/);
    assert.equal(db.calls.updateCredentials, 0);
    assert.equal(db.sessions.has("alice-session"), true);
  });
});

test("login attempts are limited per identity and invalid recovery data is generic", async () => {
  await withAuthServer({}, async (baseUrl) => {
    const loginContext = await csrfContext(baseUrl, "login");
    let result;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      result = await postForm(baseUrl, "login", { username: "missing", password: "wrong password" }, loginContext);
    }
    assert.equal(result.response.status, 429);
    const recoveryContext = await csrfContext(baseUrl, "forgot-password");
    const recovery = await postForm(baseUrl, "forgot-password", {
      username: "missing", recoveryCode: "123456", newPassword: "new secure password", confirmPassword: "new secure password",
    }, recoveryContext);
    assert.match(recovery.html, /Réinitialisation impossible avec les informations fournies/);
    assert.doesNotMatch(recovery.html, /utilisateur inexistant|compte introuvable/i);
  });
});

test("expired sessions are deleted without renewal", async () => {
  await withAuthServer({}, async (baseUrl, db) => {
    db.sessions.set("expired-session", { token: "expired-session", username: "alice", expires_at_ms: Date.now() - 1 });
    const response = await fetch(baseUrl, { headers: { Cookie: "hours_session=expired-session" }, redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/login");
    assert.equal(db.sessions.has("expired-session"), false);
  });
});

test("password length is checked in UTF-8 bytes before account creation", async () => {
  await withAuthServer({}, async (baseUrl, db) => {
    const context = await csrfContext(baseUrl, "register");
    const oversizedPassword = "é".repeat(129);
    const { response, html } = await postForm(baseUrl, "register", { username: "alice", password: oversizedPassword }, context);
    assert.equal(response.status, 200);
    assert.match(html, /256 octets maximum en UTF-8/);
    assert.equal(db.calls.createUser, 0);
    assert.equal(db.calls.ensureUserDatabase, 0);
  });
});
