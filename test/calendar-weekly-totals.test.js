const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const serverModulePath = path.resolve(__dirname, "..", "server.js");
const dbModulePath = path.resolve(__dirname, "..", "db.js");

function makeDay(isoDate, entry = null) {
  return { isoDate, entry };
}

function makeWorkedEntry(workedMinutes, targetMinutes = 420) {
  return {
    worked_minutes: workedMinutes,
    target_minutes: targetMinutes,
  };
}

test("weekly calendar summary aggregates a normal week without overtime", () => {
  const { buildCalendarWeekSummaries } = require(serverModulePath);
  const summaries = buildCalendarWeekSummaries([
    [
      makeDay("2026-08-17", makeWorkedEntry(420)),
      makeDay("2026-08-18", makeWorkedEntry(420)),
      makeDay("2026-08-19", makeWorkedEntry(420)),
      makeDay("2026-08-20", makeWorkedEntry(420)),
      makeDay("2026-08-21", makeWorkedEntry(420)),
      makeDay("2026-08-22"),
      makeDay("2026-08-23"),
    ],
  ], "2026-08-21");

  assert.equal(summaries[0].totalWorkedHHMM, "35:00");
  assert.equal(summaries[0].totalOvertimeHHMM, "00:00");
  assert.equal(summaries[0].isEmptyFutureWeek, false);
});

test("weekly calendar summary reuses recovered minutes already present on entries", () => {
  const { buildCalendarWeekSummaries } = require(serverModulePath);
  const summaries = buildCalendarWeekSummaries([[
    makeDay("2026-08-24", { ...makeWorkedEntry(420), recovered_minutes: 30 }),
    makeDay("2026-08-25", { ...makeWorkedEntry(420), recovered_minutes: 45 }),
    makeDay("2026-08-26"), makeDay("2026-08-27"), makeDay("2026-08-28"), makeDay("2026-08-29"), makeDay("2026-08-30"),
  ]], "2026-08-25");

  assert.equal(summaries[0].totalRecoveredMinutes, 75);
  assert.equal(summaries[0].totalRecoveredHHMM, "01:15");
});

test("weekly calendar summary keeps overtime from existing worked and target minutes", () => {
  const { buildCalendarWeekSummaries } = require(serverModulePath);
  const summaries = buildCalendarWeekSummaries([
    [
      makeDay("2026-08-17", makeWorkedEntry(480)),
      makeDay("2026-08-18", makeWorkedEntry(440)),
      makeDay("2026-08-19", makeWorkedEntry(420)),
      makeDay("2026-08-20", makeWorkedEntry(420)),
      makeDay("2026-08-21", makeWorkedEntry(420)),
      makeDay("2026-08-22"),
      makeDay("2026-08-23"),
    ],
  ], "2026-08-21");

  assert.equal(summaries[0].totalWorkedHHMM, "36:20");
  assert.equal(summaries[0].totalOvertimeHHMM, "01:20");
});

test("weekly calendar summary does not cancel daily overtime with an under-target day", () => {
  const { buildCalendarWeekSummaries } = require(serverModulePath);
  const summaries = buildCalendarWeekSummaries([[
    makeDay("2026-08-17", makeWorkedEntry(480)),
    makeDay("2026-08-18", makeWorkedEntry(360)),
    makeDay("2026-08-19"), makeDay("2026-08-20"), makeDay("2026-08-21"), makeDay("2026-08-22"), makeDay("2026-08-23"),
  ]], "2026-08-18");

  assert.equal(summaries[0].totalWorkedHHMM, "14:00");
  assert.equal(summaries[0].totalOvertimeHHMM, "01:00");
});

test("weekly calendar summary includes cross-month weeks on the same monday-sunday line", () => {
  const { buildCalendarWeekSummaries } = require(serverModulePath);
  const summaries = buildCalendarWeekSummaries([
    [
      makeDay("2026-06-29", makeWorkedEntry(420)),
      makeDay("2026-06-30", makeWorkedEntry(420)),
      makeDay("2026-07-01", makeWorkedEntry(420)),
      makeDay("2026-07-02", makeWorkedEntry(420)),
      makeDay("2026-07-03", makeWorkedEntry(420)),
      makeDay("2026-07-04"),
      makeDay("2026-07-05"),
    ],
  ], "2026-08-21");

  assert.equal(summaries[0].totalWorkedHHMM, "35:00");
  assert.equal(summaries[0].totalOvertimeHHMM, "00:00");
});

test("weekly calendar summary includes cross-year weeks on the same monday-sunday line", () => {
  const { buildCalendarWeekSummaries } = require(serverModulePath);
  const summaries = buildCalendarWeekSummaries([
    [
      makeDay("2026-12-28", makeWorkedEntry(420)),
      makeDay("2026-12-29", makeWorkedEntry(420)),
      makeDay("2026-12-30", makeWorkedEntry(420)),
      makeDay("2026-12-31", makeWorkedEntry(420)),
      makeDay("2027-01-01", makeWorkedEntry(420)),
      makeDay("2027-01-02"),
      makeDay("2027-01-03"),
    ],
  ], "2026-08-21");

  assert.equal(summaries[0].totalWorkedHHMM, "35:00");
  assert.equal(summaries[0].totalOvertimeHHMM, "00:00");
  assert.equal(summaries[0].weekNumber, 53);
});

test("weekly calendar summary shows dashes for a fully future empty week", () => {
  const { buildCalendarWeekSummaries } = require(serverModulePath);
  const summaries = buildCalendarWeekSummaries([
    [
      makeDay("2026-08-24"),
      makeDay("2026-08-25"),
      makeDay("2026-08-26"),
      makeDay("2026-08-27"),
      makeDay("2026-08-28"),
      makeDay("2026-08-29"),
      makeDay("2026-08-30"),
    ],
  ], "2026-08-21");

  assert.equal(summaries[0].totalWorkedHHMM, "—");
  assert.equal(summaries[0].totalOvertimeHHMM, "—");
  assert.equal(summaries[0].isEmptyFutureWeek, true);
});

test("weekly calendar summary marks the current week from the real today date", () => {
  const { buildCalendarWeekSummaries } = require(serverModulePath);
  const summaries = buildCalendarWeekSummaries([
    [
      makeDay("2026-08-24", makeWorkedEntry(420)),
      makeDay("2026-08-25", makeWorkedEntry(420)),
      makeDay("2026-08-26"),
      makeDay("2026-08-27"),
      makeDay("2026-08-28"),
      makeDay("2026-08-29"),
      makeDay("2026-08-30"),
    ],
  ], "2026-08-25");

  assert.equal(summaries[0].weekNumber, 35);
  assert.equal(summaries[0].isCurrentWeek, true);
});

test("weekly calendar summary keeps leave and weekend days at zero without hiding overtime", () => {
  const { buildCalendarWeekSummaries } = require(serverModulePath);
  const summaries = buildCalendarWeekSummaries([
    [
      makeDay("2026-08-17", makeWorkedEntry(420)),
      makeDay("2026-08-18", { worked_minutes: 0, target_minutes: 0 }),
      makeDay("2026-08-19", makeWorkedEntry(420)),
      makeDay("2026-08-20", makeWorkedEntry(420)),
      makeDay("2026-08-21", makeWorkedEntry(420)),
      makeDay("2026-08-22", { worked_minutes: 0, target_minutes: 0 }),
      makeDay("2026-08-23", { worked_minutes: 0, target_minutes: 0 }),
    ],
  ], "2026-08-21");

  assert.equal(summaries[0].totalWorkedHHMM, "28:00");
  assert.equal(summaries[0].totalOvertimeHHMM, "00:00");
});

test("weekly calendar summary formats totals above twenty-four hours as HH:MM durations", () => {
  const { buildCalendarWeekSummaries } = require(serverModulePath);
  const summaries = buildCalendarWeekSummaries([
    [
      makeDay("2026-08-17", makeWorkedEntry(600)),
      makeDay("2026-08-18", makeWorkedEntry(600)),
      makeDay("2026-08-19", makeWorkedEntry(600)),
      makeDay("2026-08-20", makeWorkedEntry(600)),
      makeDay("2026-08-21", makeWorkedEntry(600)),
      makeDay("2026-08-22"),
      makeDay("2026-08-23"),
    ],
  ], "2026-08-21");

  assert.equal(summaries[0].totalWorkedHHMM, "50:00");
  assert.equal(summaries[0].totalOvertimeHHMM, "15:00");
});

test("decorateWorkEntries keeps YYYY-MM-DD dates stable without UTC day shift", () => {
  const { decorateWorkEntries } = require(serverModulePath);
  const entries = decorateWorkEntries([
    {
      work_date: "2026-08-25",
      worked_minutes: 420,
      day_type: "office",
      arrival_time: "09:00",
      departure_time: "17:00",
      lunch_break_minutes: 60,
      comment_text: "",
    },
  ]);

  assert.equal(entries[0].work_date, "2026-08-25");
  assert.equal(entries[0].week_start, "2026-08-24");
});

test("decorateWorkEntries applies the configured daily target to worked days", () => {
  const { decorateWorkEntries } = require(serverModulePath);
  const [entry] = decorateWorkEntries([{
    work_date: "2026-08-25",
    worked_minutes: 420,
    day_type: "office",
    arrival_time: "09:00",
    departure_time: "17:00",
    lunch_break_minutes: 60,
    comment_text: "",
  }], 360);

  assert.equal(entry.target_minutes, 360);
  assert.equal(entry.overtime_minutes, 60);
});

test("getMonthData keeps business totals on pay-period entries and extends calendar entries to full visible weeks", async () => {
  const originalDbCache = require.cache[dbModulePath];
  const originalServerCache = require.cache[serverModulePath];

  delete require.cache[serverModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      async getPayPeriodSalary() {
        return null;
      },
      async getWorkEntriesByClient(username, clientId, startDate, endDate) {
        assert.equal(username, "alice");
        assert.equal(clientId, 1);
        if (startDate === "2026-06-15" && endDate === "2026-07-15") {
          return [
            {
              work_date: "2026-06-30",
              worked_minutes: 420,
              day_type: "office",
              arrival_time: "09:00",
              departure_time: "17:00",
              lunch_break_minutes: 60,
              comment_text: "",
            },
            {
              work_date: "2026-07-01",
              worked_minutes: 480,
              day_type: "office",
              arrival_time: "09:00",
              departure_time: "18:00",
              lunch_break_minutes: 60,
              comment_text: "",
            },
          ];
        }
        if (startDate === "2026-06-15" && endDate === "2026-07-20") {
          return [
            {
              work_date: "2026-06-30",
              worked_minutes: 420,
              day_type: "office",
              arrival_time: "09:00",
              departure_time: "17:00",
              lunch_break_minutes: 60,
              comment_text: "",
            },
            {
              work_date: "2026-07-01",
              worked_minutes: 480,
              day_type: "office",
              arrival_time: "09:00",
              departure_time: "18:00",
              lunch_break_minutes: 60,
              comment_text: "",
            },
            {
              work_date: "2026-07-16",
              worked_minutes: 420,
              day_type: "office",
              arrival_time: "09:00",
              departure_time: "17:00",
              lunch_break_minutes: 60,
              comment_text: "",
            },
          ];
        }
        if (startDate === "2026-01-01" && endDate === "2026-07-15") {
          return [];
        }
        return [];
      },
    },
  };

  try {
    const { getMonthData } = require(serverModulePath);
    const monthData = await getMonthData("alice", 1, "2026-07");

    assert.deepEqual(
      monthData.entries.map((entry) => entry.work_date),
      ["2026-06-30", "2026-07-01"]
    );
    assert.deepEqual(
      monthData.calendarEntries.map((entry) => entry.work_date),
      ["2026-06-30", "2026-07-01", "2026-07-16"]
    );
    assert.equal(monthData.totalHHMM, "15:00");
    assert.equal(monthData.totalOvertimeHHMM, "01:00");
  } finally {
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
});
