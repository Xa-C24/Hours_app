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
    value, dataset: {}, listeners: {}, attributes: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; }, dispatchEvent() {},
  });
  const fields = Object.fromEntries(Object.entries({ clientId: "1", date, dayType: "office", arrivalTime: "08:00", departureTime: "17:00", lunchBreakMinutes: "60" }).map(([key, value]) => [key, element(value)]));
  const status = element();
  const manual = element();
  const makeActions = () => {
    const buttons = ["play", "pause", "stop"].map(action => Object.assign(element(), { dataset: { timerAction: action } }));
    const playLabel = element();
    return { buttons, playLabel, querySelectorAll: () => buttons, querySelector: () => playLabel, cloneNode: () => makeActions() };
  };
  const actions = makeActions();
  const buttons = actions.buttons;
  const selectors = { "[data-timer-status]": status, "[data-timer-manual]": manual, "[data-timer-clock]": element(), "[data-timer-play-label]": actions.playLabel, ".work-timer-actions": actions };
  const warnings = [0, 1].map(() => {
    const message = element();
    const link = element();
    return { hidden: true, message, link, querySelector: key => key === "[data-timer-warning-message]" ? message : link };
  });
  const panel = { querySelector: key => selectors[key], querySelectorAll: () => buttons };
  const cockpitSelectors = { "[data-cockpit-timer-context]": element(), "[data-cockpit-timer-clock]": element(), "[data-cockpit-timer-status]": element(), "[data-timer-warning]": warnings[0] };
  const cockpit = { querySelector: key => cockpitSelectors[key], insertBefore(group) { this.actions = group; } };
  const classes = new Set();
  const windowListeners = {};
  const intervals = new Map();
  let submissions = 0;
  const formListeners = {};
  const form = {
    dataset: { timerUser: "fixture", isEditing: "0" },
    elements: { namedItem: key => fields[key] },
    querySelector: key => key === "[data-work-timer]" ? panel : key === "[data-entry-submit-button]" ? (options.missingSubmitButton ? null : { disabled: false }) : {},
    classList: { add: key => classes.add(key), contains: key => classes.has(key), toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key) },
    addEventListener(type, callback) { formListeners[type] = callback; }, requestSubmit() { submissions++; },
  };
  vm.runInNewContext(source, {
    document: { querySelector: key => key === "[data-entry-form]" ? form : { click() {} }, querySelectorAll: () => warnings, getElementById: id => id === "cockpit-timer-controls" && options.cockpit ? cockpit : null, addEventListener() {} },
    window: { hoursDayTypes: { workedFraction: () => 1 }, confirm: () => confirm,
      addEventListener: (type, callback) => { windowListeners[type] = callback; },
      fetch: async (url, request) => {
        if (options.fetch) return options.fetch(url, request, { start, end, date });
        if (options.offline) throw new Error("offline");
        return { ok: true, json: async () => ({ version: 1, serverNow: Date.now(), state: { start, end, pauseMs: 30 * 60000, pausedAt: null, clientId: "1", date } }) };
      },
    },
    sessionStorage: { getItem: () => JSON.stringify({ start, end, pauseMs: 30 * 60000, pausedAt: null, clientId: "1", date }), setItem() {} },
    Event: class {}, setInterval: (callback, delay) => intervals.set(delay, callback),
    Date: class extends Date { static now() { return options.now ? options.now() : Date.now(); } }, AbortSignal,
  });
  await new Promise(resolve => setImmediate(resolve));
  return { fields, status, manual, classes, buttons, cockpit, warnings, intervals, windowListeners, formListeners, submissions: () => submissions };
}

test("blocked save message survives the next clock render while the timer is running", async () => {
  const app = await setup(true, { fetch: async (url, request, fixture) => ({ ok: true, json: async () => ({
    version: 1, serverNow: Date.now(), state: { start: fixture.start, end: null, pauseMs: 0, pausedAt: null, clientId: "1", date: fixture.date },
  }) }) });
  const event = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  app.formListeners.submit(event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.match(app.status.textContent, /Terminez le suivi avec/);
  app.intervals.get(1000)();
  assert.match(app.status.textContent, /Terminez le suivi avec/);
  assert.equal(app.submissions(), 0);
});

test("entry and cockpit controls stay present and synchronized through pause, resume and stop", async () => {
  let paused = false;
  let stopped = false;
  const writes = [];
  const app = await setup(true, { cockpit: true, fetch: async (url, request, fixture) => {
    if (request.method === "POST") {
      const action = JSON.parse(request.body).action;
      writes.push(action);
      if (action === "pause") paused = true;
      if (action === "play") paused = false;
      if (action === "stop") stopped = true;
    }
    return { ok: true, json: async () => ({ version: 1 + writes.length, serverNow: Date.now(),
      state: { start: fixture.start, end: stopped ? fixture.end : null, pauseMs: 0,
        pausedAt: paused ? fixture.start + 3600000 : null, clientId: "1", date: fixture.date },
    }) };
  } });
  const dashboardButtons = app.cockpit.actions.buttons;
  assert.equal(app.buttons.length, 3, "the entry keeps its own controls");
  assert.equal(dashboardButtons.length, 3);
  assert.notEqual(app.buttons[0], dashboardButtons[0]);
  const assertBoth = expected => {
    assert.deepEqual(app.buttons.map(button => button.disabled), expected);
    assert.deepEqual(dashboardButtons.map(button => button.disabled), expected);
  };
  assertBoth([true, false, false]);
  await app.buttons[1].listeners.click();
  assert.deepEqual(writes, ["pause"]);
  assertBoth([false, true, false]);
  assert.equal(app.buttons[0].attributes["aria-label"], "Reprendre");
  assert.equal(dashboardButtons[0].attributes.title, "Reprendre");
  await dashboardButtons[0].listeners.click();
  assert.deepEqual(writes, ["pause", "play"]);
  assertBoth([true, false, false]);
  assert.equal(app.buttons[0].attributes["aria-label"], "Démarrer");
  await app.buttons[2].listeners.click();
  assert.deepEqual(writes, ["pause", "play", "stop"]);
  assertBoth([false, true, true]);
  assert.equal(app.submissions(), 1);
});

test("offline startup disables both sets of timer controls", async () => {
  const app = await setup(true, { cockpit: true, offline: true });
  assert.ok([...app.buttons, ...app.cockpit.actions.buttons].every(button => button.disabled));
  assert.equal(app.submissions(), 0);
});

test("eight-hour warning appears without a reload for another day and clears after confirmed stop", async () => {
  let now = Date.now();
  let stopped = false;
  let writes = 0;
  const app = await setup(true, {
    now: () => now,
    fetch: async (url, request, fixture) => {
      if (request.method === "POST") writes++;
      return { ok: true, json: async () => ({ version: stopped ? 2 : 1,
        serverNow: fixture.start + 8 * 3600000 - 1000,
        state: { start: fixture.start, end: stopped ? fixture.end : null, pauseMs: 0,
          pausedAt: fixture.start + 3600000, clientId: "2", date: "2026-10-14" },
      }) };
    },
  });
  assert.ok(app.warnings.every(warning => warning.hidden));
  now += 1000;
  app.intervals.get(1000)();
  for (const warning of app.warnings) {
    assert.equal(warning.hidden, false);
    assert.match(warning.message.textContent, /14\/10\/2026.*8 h 00 min/);
    assert.equal(warning.link.attributes.href, "/entries/2026-10-14/edit?clientId=2#entryFormPanel");
  }
  assert.equal(app.fields.clientId.value, "1");
  assert.equal(app.submissions(), 0);
  assert.equal(writes, 0);
  stopped = true;
  await app.windowListeners.focus();
  assert.ok(app.warnings.every(warning => warning.hidden));
  assert.equal(writes, 0);
});

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

test("timer renders safely when a page form has no submit button", async () => {
  const app = await setup(true, { missingSubmitButton: true });
  assert.match(app.status.textContent, /Chronomètre arrêté/);
  assert.equal(app.buttons[0].disabled, false);
  assert.equal(app.buttons[1].disabled, true);
  assert.equal(app.buttons[2].disabled, true);
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
