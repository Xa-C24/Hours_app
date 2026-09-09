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

test("incomplete entry notification detects a partial workday", () => {
  const notifications = buildNotifications({
    entries: [
      {
        work_date: "2026-08-18",
        day_type: "office",
        arrival_time: "09:00",
        departure_time: "",
      },
    ],
    settings: {
      dailyGoal: 420,
      notifications: {
        missingEntry: false,
        incompleteEntry: true,
      },
    },
    todayIso: "2026-08-19",
    payPeriodStartDate: "2026-08-01",
    payPeriodEndDate: "2026-08-31",
    drafts: [],
  });

  assert.equal(notifications[0].category, "incompleteEntry");
  assert.match(notifications[0].message, /incomplets ou incohérents/);
});

test("disabled préférence prevents notifications", () => {
  const notifications = buildNotifications({
    entries: [],
    settings: {
      dailyGoal: 420,
      notifications: {
        missingEntry: false,
        incompleteEntry: false,
        weeklyRisk: false,
        weeklyOvertime: false,
        periodEnding: false,
        unsavedDraft: false,
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

test("weekly risk appears on Friday when the weekly objective is not reached", () => {
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
        weeklyRisk: true,
      },
    },
    todayIso: "2026-08-21",
    payPeriodStartDate: "2026-08-17",
    payPeriodEndDate: "2026-08-31",
    drafts: [],
  });

  assert.equal(notifications[0].category, "weeklyRisk");
  assert.match(notifications[0].message, /00:60|01:00/);
});

test("weekly overtime uses the configured threshold and elapsed workdays", () => {
  const notifications = buildNotifications({
    entries: [
      { work_date: "2026-08-17", worked_minutes: 450, is_worked_day: true },
      { work_date: "2026-08-18", worked_minutes: 450, is_worked_day: true },
    ],
    settings: {
      dailyGoal: 420,
      notifications: {
        weeklyOvertime: true,
        weeklyOvertimeThreshold: 30,
      },
    },
    todayIso: "2026-08-18",
    payPeriodStartDate: "2026-08-17",
    payPeriodEndDate: "2026-08-31",
    drafts: [],
  });

  assert.equal(notifications[0].category, "weeklyOvertime");
  assert.match(notifications[0].message, /01:00/);
});

test("period ending notification lists pending workdays two days before closing", () => {
  const notifications = buildNotifications({
    entries: [],
    settings: {
      dailyGoal: 420,
      notifications: {
        periodEnding: true,
      },
    },
    todayIso: "2026-08-19",
    payPeriodStartDate: "2026-08-17",
    payPeriodEndDate: "2026-08-21",
    drafts: [],
  });

  assert.equal(notifications[0].category, "periodEnding");
  assert.match(notifications[0].message, /2 journées à compléter/);
});

test("an incomplete draft replaces the generic unsaved draft notification", () => {
  const notifications = buildNotifications({
    entries: [],
    settings: {
      dailyGoal: 420,
      notifications: {
        incompleteEntry: true,
        unsavedDraft: true,
      },
    },
    todayIso: "2026-08-19",
    payPeriodStartDate: "2026-08-17",
    payPeriodEndDate: "2026-08-31",
    drafts: [{ workDate: "2026-08-19", dayType: "office", arrivalTime: "09:00", departureTime: "" }],
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, "incomplete-draft:2026-08-19");
});

test("a complete draft creates an unsaved draft notification", () => {
  const notifications = buildNotifications({
    entries: [],
    settings: {
      dailyGoal: 420,
      notifications: {
        incompleteEntry: true,
        unsavedDraft: true,
      },
    },
    todayIso: "2026-08-19",
    payPeriodStartDate: "2026-08-17",
    payPeriodEndDate: "2026-08-31",
    drafts: [{ workDate: "2026-08-19", dayType: "office", arrivalTime: "09:00", departureTime: "17:00", lunchBreakMinutes: 60 }],
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].category, "draft");
});

test("weekday detection follows the existing calendar rule", () => {
  assert.equal(isPastExpectedWorkday("2026-08-18", "2026-08-19"), true);
  assert.equal(isPastExpectedWorkday("2026-08-16", "2026-08-19"), false);
  assert.equal(isPastExpectedWorkday("2026-08-19", "2026-08-19"), false);
});
