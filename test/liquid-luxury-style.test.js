const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extractThemeTokenRules } = require("../design-lab/theme-tokens");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Liquid Luxury is offered with the four existing styles across app and auth screens", () => {
  const views = ["views/index.ejs", "views/login.ejs", "views/register.ejs", "views/forgot-password.ejs"];
  const options = ["premium", "robot", "retro", "medieval", "liquid-luxury"];

  for (const viewPath of views) {
    const view = read(viewPath);
    assert.match(view, /Liquid Luxury/);
    for (const style of options) assert.match(view, new RegExp(`value="${style}"`), `${viewPath} includes ${style}`);
    assert.match(view, /allowedStyles = \["premium", "robot", "retro", "medieval", "liquid-luxury"\]/);
  }
});

test("style selection accepts, applies, stores and restores liquid-luxury locally", () => {
  const themeScript = read("public/theme.js");
  assert.match(themeScript, /const STYLES = \["premium", "robot", "retro", "medieval", "liquid-luxury"\]/);
  assert.match(themeScript, /function applyStyle\(style, persist = true\)/);
  assert.match(themeScript, /localStorage\.setItem\(STYLE_KEY, normalizedStyle\)/);
  assert.match(themeScript, /normalizeStyle\(storedStyle, initialTheme\)/);
  assert.match(themeScript, /setAttribute\("data-style", normalizedStyle\)/);
  assert.match(themeScript, /Liquid Luxury : des surfaces satinées/);
});

test("dedicated styling is scoped to the new style and uses the application's 11 palette tokens", () => {
  const css = read("public/liquid-luxury.css");
  const appCss = read("public/style.css");
  const paletteCss = extractThemeTokenRules(appCss);
  const paletteNames = new Set([...paletteCss.matchAll(/:root\[data-theme="([^"]+)"\]/g)].map((match) => match[1]));
  const paletteCount = paletteNames.size;

  assert.equal(paletteCount, 11);
  assert.match(paletteCss, /^:root\s*\{/);
  assert.match(css, /:root\[data-style="liquid-luxury"\]/);
  assert.match(css, /--theme-metal/);
  assert.match(css, /--theme-highlight/);
  assert.match(css, /--primary/);
  assert.match(css, /--save-primary/);
  assert.match(css, /--danger/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /:root\[data-style="(?:premium|robot|retro|medieval)"\]/);
});

test("Liquid Luxury targets the real cockpit and timer elements while preserving live progress", () => {
  const css = read("public/liquid-luxury.css");
  const view = read("views/index.ejs");

  for (const selector of [
    ".cockpit-hero",
    ".cockpit-progress-ring-core",
    ".cockpit-action-card",
    "[data-cockpit-timer-clock]",
    ".work-timer-clock[data-timer-clock]",
  ]) {
    assert.ok(css.includes(selector), `Liquid Luxury CSS targets ${selector}`);
  }

  assert.match(view, /class="cockpit-hero[^"]*"/);
  assert.match(view, /class="cockpit-progress-ring-core"/);
  assert.match(view, /class="cockpit-action-card"/);
  assert.match(view, /data-cockpit-timer-clock/);
  assert.match(view, /class="work-timer-clock" data-timer-clock/);
  assert.match(css, /\.cockpit-progress-ring[\s\S]*?var\(--cockpit-progress-angle\)/);
  assert.doesNotMatch(css, /:root\s+:is\([^)]*\.cockpit-hero/);
});

test("Liquid Luxury stylesheet is linked and included in the new service worker cache", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /hours-static-v35/);
  assert.match(sw, /"\/liquid-luxury\.css"/);
  for (const viewPath of ["views/index.ejs", "views/login.ejs", "views/register.ejs", "views/forgot-password.ejs"]) {
    assert.match(read(viewPath), /\/liquid-luxury\.css\?v=liquid-luxury-1/);
  }
});
