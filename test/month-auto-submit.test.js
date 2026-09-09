const assert = require("node:assert/strict");
const test = require("node:test");
const {
  bindPayPeriodMonthAutoSubmit,
  bindPayPeriodCalendarNavigationRestore,
} = require("../public/workspace-tabs.js");

function createMonthControl({ value = "2026-09", valid = true, requestSubmit = true } = {}) {
  const listeners = new Map();
  const form = {
    method: "get",
    action: "https://hours.local/",
    clientId: "1",
    submitted: 0,
    setAttribute(name, valueToSet) {
      this[name] = valueToSet;
    },
    submit() {
      this.submitted += 1;
    },
  };
  if (requestSubmit) {
    form.requestSubmit = () => {
      form.submitted += 1;
    };
  }
  const input = {
    value,
    checkValidity: () => valid,
    closest: (selector) => (selector === "form" ? form : null),
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatchChange() {
      listeners.get("change")();
    },
  };
  return { form, input };
}

test("month change submits the GET form once with the active client and saved scroll state", () => {
  const { form, input } = createMonthControl();
  const loadingStatus = { hidden: true };
  const savedStates = [];
  bindPayPeriodMonthAutoSubmit(input, {
    loadingStatus,
    scrollRestoreApi: {
      targets: { payPeriod: "pay-period" },
      save: (state) => savedStates.push(state),
    },
    getScrollY: () => 640,
  });

  input.value = "2026-10";
  input.dispatchChange();
  input.dispatchChange();

  assert.equal(form.submitted, 1);
  assert.equal(form.method, "get");
  assert.equal(form.clientId, "1");
  assert.equal(input.value, "2026-10");
  assert.equal(form["aria-busy"], "true");
  assert.equal(loadingStatus.hidden, false);
  assert.equal(savedStates.length, 1);
  assert.equal(savedStates[0].target, "pay-period");
  assert.equal(savedStates[0].scrollY, 640);
});

test("month change does not submit an empty or invalid value", () => {
  const empty = createMonthControl({ value: "" });
  bindPayPeriodMonthAutoSubmit(empty.input);
  empty.input.dispatchChange();
  assert.equal(empty.form.submitted, 0);

  const invalid = createMonthControl({ value: "2026-10", valid: false });
  bindPayPeriodMonthAutoSubmit(invalid.input);
  invalid.input.dispatchChange();
  assert.equal(invalid.form.submitted, 0);
});

test("month change falls back to native form.submit when requestSubmit is unavailable", () => {
  const { form, input } = createMonthControl({ requestSubmit: false });
  bindPayPeriodMonthAutoSubmit(input);
  input.dispatchChange();
  assert.equal(form.submitted, 1);
});

function createCalendarLink() {
  const listeners = new Map();
  return {
    events: [],
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    click() {
      const event = {
        defaultPrevented: false,
        preventDefault: () => {
          event.defaultPrevented = true;
        },
      };
      listeners.get("click")(event);
      this.events.push(event);
    },
    pressSpace() {
      listeners.get("keydown")({
        key: " ",
        preventDefault: () => {},
      });
    },
  };
}

function createPageLifecycle() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    showPage() {
      listeners.get("pageshow")();
    },
  };
}

test("calendar previous and next links save the pay period scroll before one native navigation", () => {
  for (const trigger of ["click", "space"]) {
    const link = createCalendarLink();
    const savedStates = [];
    bindPayPeriodCalendarNavigationRestore([link], {
      scrollRestoreApi: {
        targets: { payPeriod: "pay-period" },
        save: (state) => savedStates.push(state),
      },
      getScrollY: () => 820,
    });

    if (trigger === "click") {
      link.click();
    } else {
      link.pressSpace();
    }
    link.click();

    assert.equal(savedStates.length, 1);
    assert.equal(savedStates[0].target, "pay-period");
    assert.equal(savedStates[0].scrollY, 820);
    assert.equal(link.events[0].defaultPrevented, false);
    assert.equal(link.events[1].defaultPrevented, true);
  }
});

test("calendar navigation recreates scroll state after every completed page cycle", () => {
  const savedStates = [];
  const scrollRestoreApi = {
    targets: { payPeriod: "pay-period" },
    save: (state) => savedStates.push(state),
  };

  ["previous", "previous", "next"].forEach((direction, index) => {
    const link = createCalendarLink();
    bindPayPeriodCalendarNavigationRestore([link], {
      scrollRestoreApi,
      getScrollY: () => 700 + index,
      pageLifecycle: createPageLifecycle(),
    });
    link.click();
    assert.equal(link.events[0].defaultPrevented, false, `${direction} navigation remains native`);
  });

  assert.equal(savedStates.length, 3);
  assert.deepEqual(savedStates.map((state) => state.target), ["pay-period", "pay-period", "pay-period"]);
  assert.deepEqual(savedStates.map((state) => state.scrollY), [700, 701, 702]);
});

test("calendar navigation lock resets when a page is restored from bfcache", () => {
  const link = createCalendarLink();
  const lifecycle = createPageLifecycle();
  const savedStates = [];
  bindPayPeriodCalendarNavigationRestore([link], {
    scrollRestoreApi: { save: (state) => savedStates.push(state) },
    getScrollY: () => 920,
    pageLifecycle: lifecycle,
  });

  link.click();
  link.click();
  lifecycle.showPage();
  link.click();

  assert.equal(savedStates.length, 2);
  assert.equal(link.events[0].defaultPrevented, false);
  assert.equal(link.events[1].defaultPrevented, true);
  assert.equal(link.events[2].defaultPrevented, false);
});
