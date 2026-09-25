const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "public", "work-timer.js"), "utf8");

async function setup(confirm, options = {}) {
  const now = new Date();
  now.setHours(9, 0, 0, 0);
  const start = now.getTime();
  const end = start + 3 * 3600000;
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const element = (value = "") => ({
    value, dataset: {}, listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    setAttribute() {}, dispatchEvent() {},
  });
  const fields = Object.fromEntries(Object.entries({ clientId: "1", date, dayType: "office", arrivalTime: "08:00", departureTime: "17:00", lunchBreakMinutes: "60" }).map(([key, value]) => [key, element(value)]));
  const status = element();
  const manual = element();
  const selectors = { "[data-timer-status]": status, "[data-timer-manual]": manual, "[data-timer-clock]": element(), "[data-timer-play-label]": element() };
  const buttons = ["play", "pause", "stop"].map(action => Object.assign(element(), { dataset: { timerAction: action } }));
  const panel = { querySelector: key => selectors[key], querySelectorAll: () => buttons };
  const classes = new Set();
  const windowListeners = {};
  let submissions = 0;
  const form = {
    dataset: { timerUser: "fixture", isEditing: "0" },
    elements: { namedItem: key => fields[key] },
    querySelector: key => key === "[data-work-timer]" ? panel : { disabled: false },
    classList: { add: key => classes.add(key), contains: key => classes.has(key), toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key) },
    addEventListener() {}, requestSubmit() { submissions++; },
  };
  vm.runInNewContext(source, {
    document: { querySelector: () => form, getElementById: () => null, addEventListener() {} },
    window: { hoursDayTypes: { workedFraction: () => 1 }, confirm: () => confirm,
      addEventListener: (type, callback) => { windowListeners[type] = callback; },
      fetch: async (url, request) => {
        if (options.fetch) return options.fetch(url, request, { start, end, date });
        if (options.offline) throw new Error("offline");
        return { ok: true, json: async () => ({ version: 1, serverNow: Date.now(), state: { start, end, pauseMs: 30 * 60000, pausedAt: null, clientId: "1", date } }) };
      },
    },
    sessionStorage: { getItem: () => JSON.stringify({ start, end, pauseMs: 30 * 60000, pausedAt: null, clientId: "1", date }), setItem() {} },
    Event: class {}, setInterval() {}, Date, AbortSignal,
  });
  await new Promise(resolve => setImmediate(resolve));
  return { fields, status, manual, classes, buttons, windowListeners, submissions: () => submissions };
}

test("stopped timer reload can recover hours without submitting or claiming a save", async () => {
  const app = await setup(true);
  assert.match(app.status.textContent, /Vérifiez que la journée est enregistrée/);
  await app.manual.listeners.click();
  assert.equal(app.fields.arrivalTime.value, "09:00");
  assert.equal(app.fields.departureTime.value, "12:00");
  assert.equal(app.fields.lunchBreakMinutes.value, "30");
  assert.equal(app.submissions(), 0);
  assert.ok(app.classes.has("timer-manual"));
});

test("declining timer recovery preserves manually entered hours", async () => {
  const app = await setup(false);
  await app.manual.listeners.click();
  assert.equal(app.fields.arrivalTime.value, "08:00");
  assert.equal(app.fields.departureTime.value, "17:00");
  assert.equal(app.submissions(), 0);
});

test("offline startup cannot start an unpersisted timer", async () => {
  const app = await setup(true, { offline: true });
  assert.ok(app.buttons.every(button => button.disabled));
  assert.match(app.status.textContent, /Connexion indisponible/);
  await app.buttons[0].listeners.click();
  assert.equal(app.submissions(), 0);
});

test("lost stop response is recovered from the server without duplicate submission", async () => {
  let stopped = false;
  let writes = 0;
  const app = await setup(true, {
    fetch: async (url, request, fixture) => {
      if (request.method === "POST") {
        writes++;
        stopped = true;
        throw new Error("response lost after commit");
      }
      return { ok: true, json: async () => ({
        version: stopped ? 2 : 1, serverNow: Date.now(),
        state: { start: fixture.start, end: stopped ? fixture.end : null, pauseMs: 0, pausedAt: null, clientId: "1", date: fixture.date },
      }) };
    },
  });
  await app.buttons[2].listeners.click();
  assert.equal(writes, 1);
  assert.equal(app.submissions(), 0);
  assert.match(app.status.textContent, /action non confirmée/);
  await app.windowListeners.focus();
  assert.match(app.status.textContent, /Chronomètre arrêté/);
  assert.equal(writes, 1);
  assert.equal(app.submissions(), 0);
});
