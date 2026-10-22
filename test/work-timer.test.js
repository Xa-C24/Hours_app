const test = require("node:test");
const assert = require("node:assert/strict");
const { transition, totals, timerWarning } = require("../public/work-timer");
const minute = 60000;

test("forgotten timer warning starts at eight elapsed hours, including pauses", () => {
  const state = { start: 0, end: null, pausedAt: 60 * minute, pauseMs: 0, clientId: "2", date: "2026-10-14" };
  assert.equal(timerWarning(state, 480 * minute - 1), null);
  const warning = timerWarning(state, 480 * minute);
  assert.match(warning.message, /14\/10\/2026.*8 h 00 min.*pauses comprises/);
  assert.equal(warning.href, "/entries/2026-10-14/edit?clientId=2#entryFormPanel");
  assert.match(timerWarning(state, 3 * 24 * 60 * minute + 12 * minute).message, /72 h 12 min/);
  assert.equal(state.end, null, "showing an alert never stops the timer");
});

test("stopped, absent and invalid timers never trigger a forgotten timer warning", () => {
  const now = 600 * minute;
  assert.equal(timerWarning(null, now), null);
  assert.equal(timerWarning({ start: 0, end: 500 * minute }, now), null);
  assert.equal(timerWarning({ start: NaN, end: null }, now), null);
  assert.equal(timerWarning({ start: 0, end: null }, NaN), null);
  assert.equal(timerWarning({ start: now + 1, end: null }, now), null);
  assert.equal(timerWarning({ start: 0, end: null, date: '<script>', clientId: '../x' }, now).href, "");
});

test("timer deducts multiple pauses and resumes without changing arrival", () => {
  let state = transition(null, "play", 0);
  state = transition(state, "pause", 60 * minute);
  assert.equal(totals(state, 75 * minute).workedMs, 60 * minute);
  state = transition(state, "play", 90 * minute);
  state = transition(state, "pause", 150 * minute);
  state = transition(state, "play", 165 * minute);
  state = transition(state, "stop", 240 * minute);
  assert.equal(state.start, 0);
  assert.deepEqual(totals(state, 300 * minute), { workedMs: 195 * minute, pauseMinutes: 45 });
});

test("stop during a pause excludes time up to stop and survives serialization", () => {
  let state = transition(null, "play", 0);
  state = transition(state, "pause", 60 * minute);
  state = JSON.parse(JSON.stringify(state));
  state = transition(state, "stop", 100 * minute);
  assert.deepEqual(totals(state, 200 * minute), { workedMs: 60 * minute, pauseMinutes: 40 });
  assert.equal(transition(state, "stop", 200 * minute), state);
});

test("repeated actions and backward clocks do not reset the timer", () => {
  const state = transition(null, "play", minute);
  assert.equal(transition(state, "play", 2 * minute), state);
  assert.equal(transition(state, "stop", 0), state);
  const paused = transition(state, "pause", 2 * minute);
  assert.equal(transition(paused, "pause", 3 * minute), paused);
  assert.equal(transition(paused, "play", minute), paused);
});
