const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const serverModulePath = path.resolve(__dirname, "..", "server.js");
const dbModulePath = path.resolve(__dirname, "..", "db.js");

function buildMockDb() {
  const mobileTokens = new Map();
  const passwordSalt = "mobile-test-salt";
  const passwordHash = crypto.scryptSync("correct-password", passwordSalt, 64).toString("hex");
  return {
    async getSessionByToken(token) {
      if (token !== "valid") {
        return null;
      }
      return { token, username: "alice", expires_at_ms: Date.now() + 60_000 };
    },
    async upsertSession() {},
    async getUserByUsername(username) {
      return username === "alice"
        ? { username, password_salt: passwordSalt, password_hash: passwordHash }
        : null;
    },
    async createMobileAuthToken(token) {
      mobileTokens.set(token.token_hash, { ...token, revoked_at: null });
    },
    async getMobileAuthTokenByHash(tokenHash) {
      return mobileTokens.get(tokenHash) || null;
    },
    async touchMobileAuthToken() {},
    async revokeMobileAuthToken(tokenHash) {
      const token = mobileTokens.get(tokenHash);
      if (token) token.revoked_at = new Date().toISOString();
    },
    async revokeMobileAuthTokensByUsername() {},
    async deleteExpiredMobileAuthTokens() {},
    async getAllClients(username) {
      return username === "alice"
        ? [{ id: 1, company_name: "Acme", company_logo: "" }]
        : [];
    },
    async getPayPeriodSalary() {
      return 0;
    },
    async getWorkEntriesByClient() {
      return [];
    },
  };
}

async function withApiServer(run) {
  const originalDbCache = require.cache[dbModulePath];
  const originalServerCache = require.cache[serverModulePath];

  delete require.cache[serverModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: buildMockDb(),
  };

  const { app } = require(serverModulePath);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    delete require.cache[serverModulePath];
    if (originalServerCache) {
      require.cache[serverModulePath] = originalServerCache;
    }
    if (originalDbCache) {
      require.cache[dbModulePath] = originalDbCache;
    } else {
      delete require.cache[dbModulePath];
    }
  }
}

async function requestJson(baseUrl, pathname, authenticated = false) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    redirect: "manual",
    headers: authenticated ? { Cookie: "hours_session=valid" } : {},
  });
  return { response, body: await response.json() };
}

async function postJson(baseUrl, pathname, body, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("API v1 health is public and only exposes its version", async () => {
  await withApiServer(async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, "/api/v1/health");

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, api: "v1" });
  });
});

test("API v1 me returns JSON 401 without a login redirect", async () => {
  await withApiServer(async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, "/api/v1/me");

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("location"), null);
    assert.deepEqual(body, {
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Authentication required" },
    });
  });
});

test("API v1 unknown routes return JSON 404", async () => {
  await withApiServer(async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, "/api/v1/does-not-exist");

    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      ok: false,
      error: { code: "NOT_FOUND", message: "API endpoint not found" },
    });
  });
});

test("API v1 reuses the session and client selection without sensitive fields", async () => {
  await withApiServer(async (baseUrl) => {
    const me = await requestJson(baseUrl, "/api/v1/me", true);
    const clients = await requestJson(baseUrl, "/api/v1/clients", true);

    assert.equal(me.response.status, 200);
    assert.deepEqual(me.body, { ok: true, data: { user: { username: "alice" } } });
    assert.equal(clients.response.status, 200);
    assert.deepEqual(clients.body, {
      ok: true,
      data: { clients: [{ id: 1, companyName: "Acme", companyLogo: "" }] },
    });
  });
});

test("API v1 calendar reuses the existing month calculations", async () => {
  await withApiServer(async (baseUrl) => {
    const { response, body } = await requestJson(
      baseUrl,
      "/api/v1/calendar?month=2026-08&clientId=1",
      true
    );

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.client, { id: 1, companyName: "Acme", companyLogo: "" });
    assert.equal(body.data.calendar.month, "2026-08");
    assert.equal(body.data.calendar.clientId, 1);
  });
});

test("web routes keep their existing login redirect", async () => {
  await withApiServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`, { redirect: "manual" });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/login");
  });
});

test("mobile bundle is served locally without changing the web root", async () => {
  await withApiServer(async (baseUrl) => {
    for (const pathname of ["/mobile/", "/mobile/js/api.js", "/mobile/css/mobile.css"]) {
      const response = await fetch(`${baseUrl}${pathname}`, { redirect: "manual" });
      assert.equal(response.status, 200, pathname);
    }
    const root = await fetch(`${baseUrl}/`, { redirect: "manual" });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get("location"), "/login");
  });
});

test("API v1 CORS allows only the Capacitor iOS origin", async () => {
  await withApiServer(async (baseUrl) => {
    const origin = "capacitor://localhost";
    const preflight = await fetch(`${baseUrl}/api/v1/me`, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.match(preflight.headers.get("access-control-allow-methods"), /GET.*POST.*OPTIONS/);
    assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization.*Content-Type/);

    const health = await fetch(`${baseUrl}/api/v1/health`, { headers: { Origin: origin } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), origin);

    const evil = await fetch(`${baseUrl}/api/v1/health`, { headers: { Origin: "https://evil.example" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);

    const web = await fetch(`${baseUrl}/`, { redirect: "manual", headers: { Origin: origin } });
    assert.equal(web.headers.get("access-control-allow-origin"), null);
  });
});

test("mobile login stores only a token hash and bearer logout revokes that token", async () => {
  await withApiServer(async (baseUrl) => {
    const login = await postJson(baseUrl, "/api/v1/auth/login", {
      username: "alice",
      password: "correct-password",
    });
    assert.equal(login.response.status, 200);
    assert.equal(typeof login.body.data.token, "string");
    assert.equal(login.body.data.user.password_hash, undefined);

    const me = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { Authorization: `Bearer ${login.body.data.token}` },
    });
    assert.equal(me.status, 200);

    const logout = await postJson(baseUrl, "/api/v1/auth/logout", {}, {
      Authorization: `Bearer ${login.body.data.token}`,
    });
    assert.equal(logout.response.status, 200);
    assert.deepEqual(logout.body, { ok: true, data: { loggedOut: true } });

    const revoked = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { Authorization: `Bearer ${login.body.data.token}` },
    });
    assert.equal(revoked.status, 401);
  });
});
