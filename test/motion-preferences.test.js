const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function createMotion() {
  const source = fs.readFileSync(path.join(__dirname, "../public/theme.js"), "utf8");
  const attributes = new Map();
  const cleaned = [];
  let systemChanged;
  const media = { matches: false, addEventListener(type, listener) { systemChanged = listener; } };
  const window = { matchMedia: () => media };
  const document = {
    documentElement: {
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
    },
    querySelectorAll(selector) {
      if (selector === ".ripple-dot") return [{ remove: () => cleaned.push("ripple") }];
      if (selector === ".is-pressed") return [{ classList: { remove: () => cleaned.push("pressed") } }];
      return [{ style: { removeProperty: (key) => cleaned.push(key) } }];
    },
  };
  vm.runInNewContext(source.slice(0, source.indexOf('  const THEME_KEY')) + "})();", { window, document });
  return { motion: window.hoursMotion, attributes, cleaned, media, systemChanged: () => systemChanged() };
}

test("all motion modes switch immediately and restore effects when re-enabled", () => {
  const app = createMotion();
  for (const mode of ["subtle", "reduced", "off", "subtle"]) {
    app.attributes.set("data-animations", mode);
    app.motion.refresh();
    assert.equal(app.attributes.get("data-motion"), mode);
    assert.equal(app.motion.allowsEffects(), mode === "subtle");
    assert.equal(app.motion.scrollBehavior(), mode === "subtle" ? "smooth" : "instant");
  }
  for (const effect of ["ripple", "pressed", "--pointer-x", "--pointer-y", "--tilt-x", "--tilt-y"]) {
    assert.ok(app.cleaned.includes(effect), effect);
  }
});

test("system reduction is respected live and never overrides explicit off", () => {
  const app = createMotion();
  app.attributes.set("data-animations", "subtle");
  app.media.matches = true;
  app.systemChanged();
  assert.equal(app.motion.getMode(), "reduced");
  assert.equal(app.attributes.get("data-motion"), "reduced");
  app.attributes.set("data-animations", "off");
  app.motion.refresh();
  assert.equal(app.motion.getMode(), "off");
  app.media.matches = false;
  app.systemChanged();
  assert.equal(app.motion.getMode(), "off");
});
