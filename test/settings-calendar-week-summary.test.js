const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const settingsStorePath = path.join(__dirname, "..", "public", "settings-store.js");
const viewPath = path.join(__dirname, "..", "views", "index.ejs");

test("client calendar renderer appends one weekly summary after seven slots", () => {
  const source = fs.readFileSync(settingsStorePath, "utf8");

  assert.match(source, /calendar-week-total-heading">SEMAINE/);
  assert.match(source, /let weekWorkedMinutes = 0;/);
  assert.match(source, /let weekTargetMinutes = 0;/);
  assert.match(source, /class="calendar-week-total-card/);
  assert.match(source, /\(dayIndex \+ 1\) % 7 === 0/);
  assert.match(source, /gridHtml \+= appendWeekSummary\(cursor\);/);
  const view = fs.readFileSync(viewPath, "utf8");
  assert.match(view, /target_minutes: entry\.target_minutes/);
  assert.match(view, /overtime_minutes: entry\.overtime_minutes/);
  assert.match(view, /settings-store\.js\?v=settings-v2-5/);
});
