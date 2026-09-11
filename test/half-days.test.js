const test = require("node:test");
const assert = require("node:assert/strict");
const types = require("../public/day-types");
const { validateAndPrepareWorkEntry } = require("../services/work-entry-service");
const dependencies = {
  defaultDayType: "office",
  getClientById: async (username, id) => username === "alice" && id === 1 ? { id: 1 } : null,
  isValidDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value || ""),
  isValidTime: value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || ""),
  isWorkedDayType: value => types.workedFraction(value) > 0,
  maxCommentLength: 1000,
  normalizeClientId: Number,
  normalizeDayType: value => types.options.some(option => option.value === value) ? value : "",
  toMinutes: value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)),
};
const input = { username: "alice", clientId: 1, workDate: "2026-09-11", dayType: "office__leave", arrivalTime: "09:00", departureTime: "12:00", lunchBreakMinutes: 60 };

test("half-day controls toggle, submit both choices and restore a saved day", () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  class Element extends EventTarget {
    constructor() { super(); this.children = []; this.dataset = {}; this.style = {}; this.value = ""; }
    append(...children) { this.children.push(...children); }
    add(option) { this.children.push(option); }
    after(element) { this.sibling = element; }
  }
  const select = new Element();
  const pause = { value: "60" };
  select.value = "office";
  select.form = { querySelector: () => pause };
  const document = { createElement: () => new Element(), querySelectorAll: () => [select], body: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../public/half-day-fields"), "utf8"), {
    window: { hoursDayTypes: types }, document, Event,
    Option: function (label, value) { this.label = label; this.value = value; },
    MutationObserver: class { observe() {} },
  });
  const mode = select.sibling.children[0].children[0];
  const halves = select.sibling.children[1];
  const afternoon = halves.children[1].children[0];
  mode.checked = true;
  mode.dispatchEvent(new Event("change"));
  assert.equal(halves.hidden, false);
  assert.equal(select.hidden, true);
  afternoon.value = "leave";
  afternoon.dispatchEvent(new Event("change"));
  assert.equal(select.value, "office__leave");
  assert.equal(pause.value, "0");
  mode.checked = false;
  mode.dispatchEvent(new Event("change"));
  assert.equal(select.value, "office");
  assert.equal(select.hidden, false);
  select.value = "leave__remote";
  select.dispatchEvent(new Event("change"));
  assert.equal(mode.checked, true);
  assert.equal(halves.children[0].children[0].value, "leave");
  assert.equal(afternoon.value, "remote");
});

test("morning at office and afternoon on leave stores three hours without lunch deduction", async () => {
  const result = await validateAndPrepareWorkEntry(input, dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.entry.day_type, "office__leave");
  assert.equal(result.entry.worked_minutes, 180);
  assert.equal(result.entry.lunch_break_minutes, 0);
  assert.equal(types.fraction(result.entry.day_type, "leave"), 0.5);
  assert.equal(types.workedFraction(result.entry.day_type), 0.5);
});

test("afternoon work, two absences, and full worked days keep their respective durations", async () => {
  const afternoon = await validateAndPrepareWorkEntry({ ...input, dayType: "leave__remote", arrivalTime: "14:00", departureTime: "17:30" }, dependencies);
  assert.equal(afternoon.entry.worked_minutes, 210);
  const absent = await validateAndPrepareWorkEntry({ ...input, dayType: "rtt__leave", arrivalTime: "bad", departureTime: "bad" }, dependencies);
  assert.equal(absent.entry.worked_minutes, 0);
  assert.equal(absent.entry.arrival_time, "");
  const full = await validateAndPrepareWorkEntry({ ...input, dayType: "office", departureTime: "17:00" }, dependencies);
  assert.equal(full.entry.worked_minutes, 420);
  const mixedWork = await validateAndPrepareWorkEntry({ ...input, dayType: "office__remote", departureTime: "17:00" }, dependencies);
  assert.equal(mixedWork.entry.worked_minutes, 420);
});

test("half days reject invalid types, times and clients", async () => {
  for (const patch of [{ dayType: "office__invalid" }, { departureTime: "08:00" }, { arrivalTime: "25:00" }, { clientId: 2 }]) {
    assert.equal((await validateAndPrepareWorkEntry({ ...input, ...patch }, dependencies)).ok, false);
  }
});

test("calendar totals use half the target and count half a day of leave", async () => {
  const dbPath = require.resolve("../db");
  const serverPath = require.resolve("../server");
  const previousDb = require.cache[dbPath];
  const previousServer = require.cache[serverPath];
  const record = (await validateAndPrepareWorkEntry(input, dependencies)).entry;
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    getWorkEntriesByClient: async () => [record],
    getPayPeriodSalary: async () => 0,
  } };
  delete require.cache[serverPath];
  try {
    const { decorateWorkEntries, getMonthData } = require("../server");
    const [entry] = decorateWorkEntries([record]);
    assert.equal(entry.target_minutes, 210);
    assert.equal(entry.day_type_display, "Matin : Bureau · Après-midi : Congés");
    const data = await getMonthData("alice", 1, "2026-09");
    assert.equal(data.dayTypeCounts.leave, 0.5);
    assert.equal(data.dayTypeCounts.office, 0.5);
    assert.equal(data.workedDayCount, 0.5);
  } finally {
    if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
    if (previousServer) require.cache[serverPath] = previousServer; else delete require.cache[serverPath];
  }
});
