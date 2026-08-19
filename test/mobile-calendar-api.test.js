const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const serverModulePath = path.resolve(__dirname, "..", "server.js");
const dbModulePath = path.resolve(__dirname, "..", "db.js");

function buildMockDb() {
  const augustEntries = [
    {
      work_date: "2026-07-18",
      worked_minutes: 480,
      day_type: "office",
      arrival_time: "09:00",
      departure_time: "17:30",
      lunch_break_minutes: 30,
      comment_text: "Client meeting",
    },
    {
      work_date: "2026-08-14",
      worked_minutes: 360,
      day_type: "remote",
      arrival_time: "09:00",
      departure_time: "15:30",
      lunch_break_minutes: 30,
      comment_text: "",
    },
  ];
  const julyEntries = [
    {
      work_date: "2026-07-14",
      worked_minutes: 420,
      day_type: "office",
      arrival_time: "08:30",
      departure_time: "16:30",
      lunch_break_minutes: 30,
      comment_text: "Month close",
    },
  ];
  const clientThreeEntries = [
    {
      work_date: "2026-08-10",
      worked_minutes: 0,
      day_type: "leave",
      arrival_time: "",
      departure_time: "",
      lunch_break_minutes: 0,
      comment_text: "Paid leave",
    },
  ];

  return {
    failMonth: "",
    async healthCheck() {
      return { ok: true, engine: "sqlite" };
    },
    async getSessionByToken(token) {
      if (token === "valid") {
        return {
          token,
          username: "alice",
          expires_at_ms: Date.now() + 60_000,
        };
      }
      return null;
    },
    async upsertSession() {},
    async deleteExpiredSessions() {},
    async getClientById(username, clientId) {
      if (username !== "alice") {
        return null;
      }
      if (clientId === 1) {
        return { id: 1, company_name: "Acme" };
      }
      if (clientId === 3) {
        return { id: 3, company_name: "Bravo" };
      }
      return null;
    },
    async getPayPeriodSalary(username, clientId, month) {
      if (this.failMonth && month === this.failMonth) {
        throw new Error("db down");
      }
      if (username !== "alice") {
        return null;
      }
      if (clientId === 3) {
        return 250000;
      }
      return 320000;
    },
    async getWorkEntriesByClient(username, clientId, startDate) {
      if (username !== "alice") {
        return [];
      }
      if (clientId === 1 && startDate === "2026-07-15") {
        return augustEntries;
      }
      if (clientId === 1 && startDate === "2026-01-01") {
        return [...julyEntries, ...augustEntries];
      }
      if (clientId === 1 && startDate === "2026-06-15") {
        return julyEntries;
      }
      if (clientId === 3 && startDate === "2026-07-15") {
        return clientThreeEntries;
      }
      if (clientId === 3 && startDate === "2026-01-01") {
        return clientThreeEntries;
      }
      return [];
    },
  };
}

async function withMonthApiServer(run) {
  const mockDb = buildMockDb();
  const originalDbCache = require.cache[dbModulePath];
  const originalServerCache = require.cache[serverModulePath];

  delete require.cache[serverModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: mockDb,
  };

  const { app } = require(serverModulePath);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await run({ baseUrl, mockDb });
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

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    headers: {
      Cookie: "hours_session=valid",
      Accept: "application/json",
    },
  });
  return {
    response,
    body: response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : await response.text(),
  };
}

test("month API loads the current month payload for the authenticated client", async () => {
  await withMonthApiServer(async ({ baseUrl }) => {
    const { response, body } = await getJson(baseUrl, "/api/entries/month?clientId=1&month=2026-08");

    assert.equal(response.status, 200);
    assert.equal(body.month, "2026-08");
    assert.equal(body.clientId, 1);
    assert.equal(body.entries.length, 2);
    assert.equal(body.entries[0].work_date, "2026-07-18");
    assert.equal(body.entries[0].worked_hhmm, "08:00");
    assert.equal(body.totalHHMM, "14:00");
  });
});

test("month API loads the previous month and handles year boundaries with empty months", async () => {
  await withMonthApiServer(async ({ baseUrl }) => {
    const july = await getJson(baseUrl, "/api/entries/month?clientId=1&month=2026-07");
    assert.equal(july.response.status, 200);
    assert.equal(july.body.entries.length, 1);
    assert.equal(july.body.entries[0].work_date, "2026-07-14");

    const january = await getJson(baseUrl, "/api/entries/month?clientId=1&month=2027-01");
    assert.equal(january.response.status, 200);
    assert.equal(Array.isArray(january.body.entries), true);
    assert.equal(january.body.entries.length, 0);
  });
});

test("month API keeps two clients separated and returns empty months when needed", async () => {
  await withMonthApiServer(async ({ baseUrl }) => {
    const acme = await getJson(baseUrl, "/api/entries/month?clientId=1&month=2026-08");
    const bravo = await getJson(baseUrl, "/api/entries/month?clientId=3&month=2026-08");
    const bravoEmpty = await getJson(baseUrl, "/api/entries/month?clientId=3&month=2026-09");

    assert.equal(acme.response.status, 200);
    assert.equal(bravo.response.status, 200);
    assert.notEqual(acme.body.entries[0].work_date, bravo.body.entries[0].work_date);
    assert.equal(bravo.body.entries[0].day_type, "leave");
    assert.equal(bravoEmpty.body.entries.length, 0);
  });
});

test("month API rejects clients that do not belong to the authenticated user", async () => {
  await withMonthApiServer(async ({ baseUrl }) => {
    const { response, body } = await getJson(baseUrl, "/api/entries/month?clientId=2&month=2026-08");

    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: "Client introuvable." });
  });
});

test("month API surfaces backend errors with a server failure", async () => {
  await withMonthApiServer(async ({ baseUrl, mockDb }) => {
    mockDb.failMonth = "2026-10";
    const { response, body } = await getJson(baseUrl, "/api/entries/month?clientId=1&month=2026-10");

    assert.equal(response.status, 500);
    assert.equal(body, "Erreur interne du serveur.");
  });
});
