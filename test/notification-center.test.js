const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createScopedStorageKey,
  isPastExpectedWorkday,
  collectDrafts,
  buildNotifications,
  createReadStateStore,
} = require("../public/notification-center");

function createMemoryStorage(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries));
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return [...store.keys()][index] || null;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("missing-entry notification is created for an expected workday without entry", () => {
  const notifications = buildNotifications({
    entries: [],
    settings: {
      dailyGoal: 420,
      notifications: {
        missingEntry: true,
        goalReached: false,
        weeklySummary: false,
      },
    },
    todayIso: "2026-08-19",
    payPeriodStartDate: "2026-08-17",
    payPeriodEndDate: "2026-08-31",
    drafts: [],
  });

  assert.equal(notifications[0].category, "missingEntry");
  assert.equal(notifications[0].id, "missing-entry:2026-08-18");
});

test("goal reached notification reuses the existing daily goal threshold", () => {
  const notifications = buildNotifications({
    entries: [
      {
        work_date: "2026-08-19",
        worked_minutes: 450,
        worked_hhmm: "07:30",
      },
    ],
    settings: {
      dailyGoal: 420,
      notifications: {
        missingEntry: false,
        goalReached: true,
        weeklySummary: false,
      },
    },
    todayIso: "2026-08-19",
    payPeriodStartDate: "2026-08-01",
    payPeriodEndDate: "2026-08-31",
    drafts: [],
  });

  assert.equal(notifications[0].category, "goalReached");
  assert.match(notifications[0].message, /07:30/);
});

test("disabled preference prevents notifications", () => {
  const notifications = buildNotifications({
    entries: [],
    settings: {
      dailyGoal: 420,
      notifications: {
        missingEntry: false,
        goalReached: false,
        weeklySummary: false,
      },
    },
    todayIso: "2026-08-19",
    payPeriodStartDate: "2026-08-17",
    payPeriodEndDate: "2026-08-31",
    drafts: [],
  });

  assert.deepEqual(notifications, []);
});

test("collectDrafts keeps only recent drafts for the current client", () => {
  const storage = createMemoryStorage({
    "hours:draft:client-a:2026-08-19": JSON.stringify({ clientId: "client-a", workDate: "2026-08-19" }),
    "hours:draft:client-a:2026-08-15": JSON.stringify({ clientId: "client-a", workDate: "2026-08-15" }),
    "hours:draft:client-b:2026-08-19": JSON.stringify({ clientId: "client-b", workDate: "2026-08-19" }),
  });

  const drafts = collectDrafts(storage, "alice", "client-a", "2026-08-19");

  assert.deepEqual(drafts.map((draft) => draft.workDate), ["2026-08-19"]);
});

test("read-state store supports unread badge and mark as read flows", () => {
  const storage = createMemoryStorage();
  const store = createReadStateStore(storage, "alice", "client-a");
  const key = createScopedStorageKey("hours:notifications:read", "alice", "client-a");

  store.set(["n1", "n2"]);

  assert.deepEqual(store.get(), ["n1", "n2"]);
  assert.equal(storage.getItem(key), JSON.stringify(["n1", "n2"]));
});

test("weekly summary appears on Friday only when enabled", () => {
  const notifications = buildNotifications({
    entries: [
      { work_date: "2026-08-17", worked_minutes: 420, is_worked_day: true },
      { work_date: "2026-08-18", worked_minutes: 420, is_worked_day: true },
      { work_date: "2026-08-19", worked_minutes: 420, is_worked_day: true },
      { work_date: "2026-08-20", worked_minutes: 420, is_worked_day: true },
      { work_date: "2026-08-21", worked_minutes: 360, is_worked_day: true },
    ],
    settings: {
      dailyGoal: 420,
      notifications: {
        missingEntry: false,
        goalReached: false,
        weeklySummary: true,
      },
    },
    todayIso: "2026-08-21",
    payPeriodStartDate: "2026-08-17",
    payPeriodEndDate: "2026-08-31",
    drafts: [],
  });

  assert.equal(notifications[0].category, "weeklySummary");
  assert.match(notifications[0].message, /Il reste 01:00/);
});

test("weekday detection follows the existing calendar rule", () => {
  assert.equal(isPastExpectedWorkday("2026-08-18", "2026-08-19"), true);
  assert.equal(isPastExpectedWorkday("2026-08-16", "2026-08-19"), false);
  assert.equal(isPastExpectedWorkday("2026-08-19", "2026-08-19"), false);
});
