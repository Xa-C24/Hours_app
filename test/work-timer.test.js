const test = require("node:test");
const assert = require("node:assert/strict");
const { transition, totals } = require("../public/work-timer");
const minute = 60000;

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
