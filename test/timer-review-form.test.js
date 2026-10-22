const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../server"), "utf8");
const start = source.indexOf("async function renderIndex(");
const renderSource = source.slice(start, source.indexOf("\nfunction renderLogin", start));

async function review(entries, options = {}) {
  let rendered;
  const render = vm.runInNewContext(`${renderSource}\nrenderIndex;`, {
    getUserSettings: async () => ({ dailyGoal: 420, defaultStartTime: "09:00", defaultEndTime: "17:00", defaultPause: 60 }),
    normalizeMonth: value => value || "2026-10",
    getClientSelection: async () => ({ clients: [{ id: 1 }], selectedClient: { id: 1 } }),
    getArchivedClientHistory: async () => [],
    getMonthData: async () => ({ entries, salaryAmountCents: null }),
    formatDate: () => "2026-10-20",
    isValidDate: value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    DEFAULT_DAY_TYPE: "office", DEFAULT_SETTINGS: {}, DAY_TYPE_FILTERS: [],
    dayTypes: { options: [] }, buildCalendarWeekSummaries() {},
    IS_DEVELOPMENT: false, DEVELOPMENT_REVISION: "test",
  });
  await render({ locals: {}, render: (view, data) => { rendered = { view, data }; } }, { editDate: "2026-10-14", ...options });
  return rendered.data;
}

test("reviewing an unsaved timer day opens that date without claiming an existing entry", async () => {
  const data = await review([]);
  assert.equal(data.formData.date, "2026-10-14");
  assert.equal(data.formData.originalWorkDate, "");
  assert.equal(data.isEditing, false);
  assert.equal(data.defaultEntryFormData.date, "2026-10-20");
});

test("reviewing a saved timer day preserves its hours and existing-entry identity", async () => {
  const data = await review([{ work_date: "2026-10-14", day_type: "remote", arrival_time: "08:00", departure_time: "16:00", lunch_break_minutes: 30, comment_text: "Exemple" }]);
  assert.equal(data.formData.date, "2026-10-14");
  assert.equal(data.formData.arrivalTime, "08:00");
  assert.equal(data.formData.departureTime, "16:00");
  assert.equal(data.formData.commentText, "Exemple");
  assert.equal(data.formData.originalWorkDate, "2026-10-14");
  assert.equal(data.isEditing, true);
});

test("an invalid timer review date keeps the normal new-day form", async () => {
  const data = await review([], { editDate: "invalid" });
  assert.equal(data.formData.date, "2026-10-20");
  assert.equal(data.isEditing, false);
});
