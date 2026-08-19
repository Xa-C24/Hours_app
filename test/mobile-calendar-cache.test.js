const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMonthCacheKey,
  createMonthCacheStore,
} = require("../public/workspace-tabs.js");

test("createMonthCacheKey isolates months and clients", () => {
  assert.equal(createMonthCacheKey("client-a", "2026-08"), "client-a:2026-08");
  assert.notEqual(createMonthCacheKey("client-a", "2026-08"), createMonthCacheKey("client-a", "2026-09"));
  assert.notEqual(createMonthCacheKey("client-a", "2026-08"), createMonthCacheKey("client-b", "2026-08"));
});

test("createMonthCacheStore stores and reads payloads by client and month", () => {
  const store = createMonthCacheStore();
  const augustPayload = { month: "2026-08", entries: [{ work_date: "2026-08-18" }] };
  const septemberPayload = { month: "2026-09", entries: [] };

  store.set("client-a", "2026-08", augustPayload);
  store.set("client-a", "2026-09", septemberPayload);

  assert.equal(store.has("client-a", "2026-08"), true);
  assert.equal(store.has("client-a", "2026-10"), false);
  assert.deepEqual(store.get("client-a", "2026-08"), augustPayload);
  assert.deepEqual(store.get("client-a", "2026-09"), septemberPayload);
});

test("createMonthCacheStore never mixes two clients", () => {
  const store = createMonthCacheStore();
  store.set("client-a", "2026-08", { marker: "A" });
  store.set("client-b", "2026-08", { marker: "B" });

  assert.deepEqual(store.get("client-a", "2026-08"), { marker: "A" });
  assert.deepEqual(store.get("client-b", "2026-08"), { marker: "B" });
});
