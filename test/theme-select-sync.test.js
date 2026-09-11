const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../public/theme.js"), "utf8");

function boot(style, customMenus = true, script = source) {
  const attributes = new Map([["data-theme", "dark"], ["data-style", style]]);
  const storage = new Map();
  const makeSelect = (value) => ({
    value, visibleValue: value, listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
  });
  const themeSelect = makeSelect("light");
  const styleSelect = makeSelect("premium");
  let ready;
  const window = customMenus ? { hoursSettingsStore: {
    refreshCustomSelects() {
      for (const select of [themeSelect, styleSelect]) select.visibleValue = select.value;
    },
  } } : {};
  window.addEventListener = () => {};
  window.matchMedia = () => ({ matches: false });
  vm.runInNewContext(script, {
    window,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: {
      documentElement: {
        getAttribute: (key) => attributes.get(key),
        setAttribute: (key, value) => attributes.set(key, value),
      },
      body: { classList: { contains: () => false } },
      querySelector: () => null,
      querySelectorAll: (selector) => selector === "[data-theme-selector]" ? [themeSelect]
        : selector === "[data-style-selector]" ? [styleSelect] : [],
      addEventListener(type, listener) { if (type === "DOMContentLoaded") ready = listener; },
    },
  });
  ready();
  return { attributes, storage, themeSelect, styleSelect };
}

test("restored styles refresh custom menu labels after DOMContentLoaded", () => {
  for (const style of ["robot", "retro", "premium", "medieval"]) {
    const app = boot(style);
    assert.equal(app.styleSelect.visibleValue, style);
    assert.equal(app.themeSelect.visibleValue, "dark");
    assert.equal(app.storage.size, 0, "initialization must not rewrite preferences");
  }
});

test("style changes keep the rendered menu, root and stored preference aligned", () => {
  const app = boot("robot");
  for (const style of ["premium", "medieval", "premium", "retro", "robot"]) {
    app.styleSelect.listeners.change({ target: { value: style } });
    assert.equal(app.attributes.get("data-style"), style);
    assert.equal(app.styleSelect.visibleValue, style);
    assert.equal(app.storage.get("hours_style"), style);
    assert.equal(app.attributes.get("data-theme"), "dark", "style changes preserve the palette");
  }
});

test("native selectors still initialize without the settings store", () => {
  assert.equal(boot("robot", false).styleSelect.value, "robot");
});

test("regression reproduces the stale Premium label without the refresh calls", () => {
  const oldSource = source.replaceAll("window.hoursSettingsStore?.refreshCustomSelects?.();", "");
  const app = boot("robot", true, oldSource);
  assert.equal(app.attributes.get("data-style"), "robot");
  assert.equal(app.styleSelect.value, "robot");
  assert.equal(app.styleSelect.visibleValue, "premium");
});
