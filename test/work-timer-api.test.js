const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createWorkTimerRouter, recoverLegacy, dateInZone } = require("../routes/work-timer");

async function fixture(run) {
  const records = new Map();
  let now = Date.parse("2026-09-25T08:00:00Z");
  const db = {
    getWorkTimer: async user => records.get(user) || { version: 0, state: null },
    getClientById: async (user, id) => id === 1 ? { id } : null,
    saveWorkTimer: async (user, version, state) => {
      if ((records.get(user)?.version || 0) !== version) return null;
      const next = { version: version + 1, state };
      records.set(user, next);
      return next;
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.authUser = req.get("test-user"); next(); });
  app.use(createWorkTimerRouter(db, () => now));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const request = async (body, user = "alice") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(user ? { "test-user": user } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  try { await run({ request, advance: ms => { now += ms; }, records }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const command = (action, version, rest = {}) => ({ action, version, clientId: "1", date: "2026-09-25", timeZone: "Europe/Paris", ...rest });

test("timer API restores shared state and rejects simultaneous starts and stale stops", async () => fixture(async ({ request, advance }) => {
  const concurrent = await Promise.all([request(command("play", 0)), request(command("play", 0))]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
  const restored = await request();
  assert.equal(restored.body.version, 1);
  assert.equal(restored.cache, "no-store");
  advance(60000);
  assert.equal((await request(command("pause", 1))).status, 200);
  assert.equal((await request(command("stop", 1))).status, 409);
  advance(120000);
  const stop = await request(command("stop", 2));
  assert.equal(stop.status, 200);
  assert.equal(stop.body.state.pauseMs, 120000);
  assert.equal(stop.body.state.end - stop.body.state.start, 180000);
  assert.deepEqual((await request()).body.state, stop.body.state);
}));

test("timer API isolates users and validates ownership, version and dates", async () => fixture(async ({ request }) => {
  assert.equal((await request(null, "")).status, 401);
  assert.equal((await request(command("play", 0, { clientId: "2" }))).status, 404);
  assert.equal((await request(command("play", -1))).status, 400);
  assert.equal((await request(command("play", 0, { date: "2026-09-24" }))).status, 400);
  assert.equal((await request(command("play", 0, { timeZone: "invalid" }))).status, 400);
  assert.equal((await request(command("play", 0))).status, 200);
  assert.equal((await request(null, "bob")).body.state, null);
  assert.equal((await request(command("pause", 0), "bob")).status, 409);
}));

test("legacy recovery is explicit and cannot replace an existing server timer", async () => fixture(async ({ request }) => {
  const legacy = { start: Date.parse("2026-09-25T07:00:00Z"), end: null, pausedAt: null, pauseMs: 0 };
  const restored = await request(command("recover", 0, { legacy }));
  assert.equal(restored.status, 200);
  assert.equal(restored.body.state.start, legacy.start);
  assert.equal((await request(command("recover", 1, { legacy }))).status, 409);
  assert.equal(recoverLegacy({ ...legacy, pauseMs: -1 }, Date.now()), null);
  assert.equal(recoverLegacy({ ...legacy, end: legacy.start - 1 }, Date.now()), null);
  assert.equal(dateInZone(Date.parse("2026-09-25T23:00:00Z"), "Europe/Paris"), "2026-09-26");
}));
