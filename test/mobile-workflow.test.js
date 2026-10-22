const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const view = fs.readFileSync(path.join(__dirname, "..", "views", "index.ejs"), "utf8");

test("save confirmation requires matching server data, including corrections to an existing day", () => {
  const start = view.indexOf("const savedEntry = bootstrapEntries.find");
  const end = view.indexOf("if (", start);
  const entry = { workDate: "2026-09-25", dayType: "office", arrivalTime: "09:00", departureTime: "17:00", lunchBreakMinutes: "30", commentText: "Correction" };
  const serverEntry = { work_date: entry.workDate, day_type: "office", is_worked_day: true, arrival_time_display: "09:00", departure_time_display: "17:00", lunch_break_minutes_display: 30, comment_text: "Correction" };
  const confirmed = (bootstrapEntries, submitted = entry) => vm.runInNewContext(
    `${view.slice(start, end)}; saveConfirmed`,
    { bootstrapEntries, saveFlash: { workDate: entry.workDate, entry: submitted } }
  );
  assert.equal(confirmed([]), false);
  assert.equal(confirmed([serverEntry]), true);
  assert.equal(confirmed([{ ...serverEntry, departure_time_display: "16:00" }]), false);
  assert.equal(confirmed([{ ...serverEntry, comment_text: "Ancienne saisie" }]), false);
  assert.equal(confirmed([serverEntry], null), false);
});

test("mobile navigation makes only the selected view interactive and releases desktop views", () => {
  const makeView = (key) => ({
    dataset: { mobileView: key }, attrs: {}, classList: { toggle() {} },
    setAttribute(key, value) { this.attrs[key] = value; },
    removeAttribute(key) { delete this.attrs[key]; },
  });
  const views = ["dashboard", "entry", "calendar", "history", "settings"].map(makeView);
  let selected = views[0];
  const mobileQuery = { matches: true };
  const phoneQuery = { matches: true };
  const context = vm.createContext({ views, mobileQuery, phoneQuery, getActiveView: () => selected, navButtons: [], dots: [] });
  const start = view.indexOf("const syncActiveState = () => {");
  const end = view.indexOf("const setIndex = (", start);
  vm.runInContext(`${view.slice(start, end)}; this.sync = syncActiveState;`, context);
  for (const current of views) {
    selected = current;
    context.sync();
    for (const item of views) {
      assert.equal(item.inert, item !== current);
      assert.equal(item.attrs["aria-hidden"], String(item !== current));
    }
  }
  mobileQuery.matches = false;
  context.sync();
  for (const item of views) {
    assert.equal(item.inert, false);
    assert.equal(item.attrs["aria-hidden"], undefined);
  }
});

test("submitting preserves the draft without claiming a successful server save", () => {
  const start = view.indexOf('entryForm.addEventListener("submit", () => {');
  const end = view.indexOf('window.addEventListener("pageshow"', start);
  let submit;
  let drafts = 0;
  let cacheWrites = 0;
  const state = {};
  const context = vm.createContext({
    entryForm: { addEventListener: (_, callback) => { submit = callback; } },
    readEntryFromForm: () => ({ workDate: "2026-09-25" }), state,
    draftSaveTimeoutId: 1, persistDraftNow: () => { drafts++; },
    window: { clearTimeout() {} }, renderStatus() {}, renderBadge() {},
    updateSubmitButton() {}, submitButton: { dataset: {} }, scrollRestoreApi: null,
    sessionStorage: { setItem() {} }, SAVE_FLASH_STORAGE_KEY: "test",
    clientIdInput: { value: "fixture" },
    persistEntryInCache: () => { cacheWrites++; }, setFormState() {},
  });
  vm.runInContext(view.slice(start, end), context);
  submit();
  assert.equal(drafts, 1);
  assert.equal(cacheWrites, 0);
  assert.equal(state.statusVariant, "is-loading");
  assert.equal(state.isSaving, true);
});
