const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const view = fs.readFileSync(path.join(__dirname, "..", "views", "index.ejs"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "..", "public", "workspace-tabs.js"), "utf8");
const style = fs.readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");

test("weekly cards expose accessible modal hooks and seven-day local data", () => {
  assert.match(view, /role="button"[\s\S]*?tabindex="0"[\s\S]*?aria-haspopup="dialog"[\s\S]*?data-week-summary-index/);
  assert.match(view, /data-week-start="<%= _calendarWeeks\[weekIndex\]/);
  assert.match(view, /data-week-end="<%= _calendarWeeks\[weekIndex\]/);
  assert.match(view, /data-week-number="<%= calendarWeekSummary/);
  assert.match(view, /id="calendar-week-modal-data" type="application\/json"/);
  assert.match(view, /<% let _calendarWeekModalData = \[\]; %>\s*<% if \(selectedClient\) \{ %>/);
  assert.match(view, /_calendarWeekModalData = _calendarWeeks\.map\(\(weekDays, weekIndex\) => \{/);
  assert.match(view, /JSON\.stringify\(_calendarWeekModalData\)\.replace/);
  assert.match(view, /data-week-summary-modal aria-hidden="true" hidden/);
  assert.match(view, /recoveredHHMM/);
  assert.match(script, /function openWeekSummaryModal\(index, trigger\)/);
  assert.match(script, /document\.querySelectorAll\("\.calendar-week-total-card\[data-week-summary-index\]"\)/);
  assert.match(script, /card\.addEventListener\("click", \(\) => \{\s*openWeekSummaryModal\(card\.dataset\.weekSummaryIndex \|\| "", card\);/);
  assert.match(script, /window\.addEventListener\("hours:calendar-rendered", bindWeekSummaryCards\)/);
  assert.match(script, /weekSummaryContent\.innerHTML = buildWeekSummaryMarkup\(week\)/);
  assert.match(script, /weekSummaryModal\.setAttribute\("aria-hidden", "false"\)/);
  assert.match(script, /weekSummaryModal\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(script, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(script, /closeWeekSummaryModal\(\)/);
  assert.match(script, /function formatWeekSummaryValue\(value\)/);
  assert.match(script, /function formatWeekSummaryRange\(startDate, endDate\)/);
  assert.match(script, /formatWeekSummaryValue\(day\.pause\)/);
  assert.match(script, /week-summary-type-pill/);
});

test("weekly modal payload stays in scope after the selected client block", () => {
  const declaration = view.indexOf("<% let _calendarWeekModalData = []; %>");
  const selectedClientBlock = view.indexOf("<% if (selectedClient) { %>", declaration);
  const assignment = view.indexOf("_calendarWeekModalData = _calendarWeeks.map", selectedClientBlock);
  const selectedClientEnd = view.indexOf("<% } else { %>", assignment);
  const payloadNode = view.indexOf('<script id="calendar-week-modal-data"', selectedClientEnd);

  assert.ok(declaration !== -1 && declaration < selectedClientBlock);
  assert.ok(assignment > selectedClientBlock && assignment < selectedClientEnd);
  assert.ok(payloadNode > selectedClientEnd);
});

test("settings calendar replacement preserves the weekly summary hooks", () => {
  const settingsStore = fs.readFileSync(path.join(__dirname, "..", "public", "settings-store.js"), "utf8");

  assert.match(settingsStore, /class="calendar-week-total-card\$\{[^\n]*\}"[\s\S]*?role="button"[\s\S]*?tabindex="0"[\s\S]*?aria-haspopup="dialog"/);
  assert.match(settingsStore, /data-week-summary-index="\$\{weekSummaryIndex\}"/);
  assert.match(settingsStore, /data-week-start="\$\{weekStartIso\}"/);
  assert.match(settingsStore, /data-week-end="\$\{weekEndIso\}"/);
  assert.match(settingsStore, /data-week-number="\$\{weekNumber\}"/);
  assert.match(settingsStore, /window\.dispatchEvent\(new CustomEvent\("hours:calendar-rendered"\)\)/);
});

test("weekly summary modal has desktop table and mobile cards", () => {
  assert.match(script, /class="week-summary-table"/);
  assert.match(script, /class="week-summary-mobile-list"/);
  assert.match(script, /Total récupération/);
  assert.match(style, /\.week-summary-table-wrap\s*\{[\s\S]*?overflow-x: auto;/);
  assert.match(style, /@media \(max-width: 700px\)[\s\S]*?\.week-summary-table-wrap\s*\{[\s\S]*?display: none;/);
  assert.match(style, /\.week-summary-mobile-list\s*\{[\s\S]*?display: grid;/);
  assert.match(style, /\.client-modal-dialog\.week-summary-modal-dialog\s*\{[\s\S]*?color-mix\(in srgb, var\(--primary\)/);
  assert.match(style, /\.week-summary-table\s*\{[\s\S]*?border-collapse: separate;/);
  assert.match(style, /\.week-summary-type-pill\s*\{[\s\S]*?var\(--primary\)/);
  assert.match(style, /\.week-summary-modal-dialog \[data-week-summary-subtitle\]\s*\{[\s\S]*?width: fit-content;[\s\S]*?var\(--primary\)/);
  assert.match(style, /\.week-summary-modal-dialog \[data-week-summary-subtitle\]:hover\s*\{[\s\S]*?translateY\(-1px\) scale\(1\.015\);/);
  assert.match(style, /--week-kpi-hours: color-mix\(in srgb, var\(--primary\)/);
  assert.match(style, /\.week-summary-totals article:hover\s*\{[\s\S]*?translateY\(-2px\) scale\(1\.02\);/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.week-summary-totals article:hover,[\s\S]*?\{[\s\S]*?transform: none;/);
});
