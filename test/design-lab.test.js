const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extractThemeTokenRules } = require("../design-lab/theme-tokens");

const projectRoot = path.join(__dirname, "..");

function themeTokens(theme) {
  const sourceCss = fs.readFileSync(path.join(projectRoot, "public", "style.css"), "utf8");
  const tokenCss = extractThemeTokenRules(sourceCss);
  const variables = {};

  for (const match of tokenCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((selector) => selector.trim());
    if (!selectors.includes(":root") && !selectors.includes(`:root[data-theme="${theme}"]`)) continue;
    for (const declaration of match[2].split(";")) {
      const item = declaration.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
      if (item) variables[item[1]] = item[2];
    }
  }
  return variables;
}

function contrastRatio(firstHex, secondHex) {
  const luminance = (hex) => {
    const number = Number.parseInt(hex.slice(1), 16);
    const channels = [number >> 16, (number >> 8) & 255, number & 255]
      .map((channel) => channel / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const first = luminance(firstHex);
  const second = luminance(secondHex);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("design lab exposes only real root palette custom properties", () => {
  const sourceCss = fs.readFileSync(path.join(projectRoot, "public", "style.css"), "utf8");
  const tokensCss = extractThemeTokenRules(sourceCss);

  assert.match(tokensCss, /^:root\s*\{/);
  for (const theme of ["dark", "deep-ocean-blue", "light-blue", "orange-sunset", "forest-green", "light-green", "bordeaux-night", "lavender-mist", "obsidian-gold", "robot"]) {
    assert.match(tokensCss, new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{`));
  }
  assert.match(tokensCss, /--primary\s*:/);
  assert.match(tokensCss, /--card-bg\s*:/);
  assert.doesNotMatch(tokensCss, /@import|https?:\/\//i);
  assert.doesNotMatch(tokensCss, /\.home-premium-page|button\s*\{/);
});

test("design lab page keeps the same preview components in every proposal", () => {
  const view = fs.readFileSync(path.join(projectRoot, "views", "design-lab.ejs"), "utf8");
  const compiled = require("ejs").compile(view);
  const html = compiled({});

  assert.equal((html.match(/class="proposal proposal--/g) || []).length, 4);
  for (const component of ["save", "edit", "delete", "cancel", "start", "pause", "stop", "create", "date", "time", "select", "info-card", "worked-card", "mini-modal"]) {
    assert.equal((html.match(new RegExp(`data-lab-component="${component}"`, "g")) || []).length, 4, `${component} should appear in each proposal`);
  }
});

test("Liquid Luxury stays marked as selected and has a separate 2.0 comparison", () => {
  const view = fs.readFileSync(path.join(projectRoot, "views", "design-lab.ejs"), "utf8");
  const css = fs.readFileSync(path.join(projectRoot, "design-lab", "design-lab.css"), "utf8");

  assert.match(view, /tag: 'DIRECTION RETENUE'/);
  assert.match(view, /badge: 'CHOIX VALIDÉ'/);
  assert.match(view, /id: 'b2'/);
  assert.match(view, /badge: 'À COMPARER'/);
  assert.match(view, /Objectif/);
  assert.match(view, /Reste/);
  assert.match(css, /\.proposal--b\s*\{/);
  assert.match(css, /\.proposal--b2\s*\{/);
  assert.match(css, /prefers-reduced-motion/);
});

test("design lab starts with B versus B2.0 and exposes palette and solo controls", () => {
  const view = fs.readFileSync(path.join(projectRoot, "views", "design-lab.ejs"), "utf8");
  const css = fs.readFileSync(path.join(projectRoot, "design-lab", "design-lab.css"), "utf8");
  const js = fs.readFileSync(path.join(projectRoot, "design-lab", "design-lab.js"), "utf8");
  const html = require("ejs").compile(view)({});

  assert.match(html, /data-compare-left[\s\S]*value="b" selected/);
  assert.match(html, /data-compare-right[\s\S]*value="b2" selected/);
  assert.equal((html.match(/data-examine="/g) || []).length, 4);
  assert.match(html, /data-theme-shortcut="light"/);
  assert.match(html, /data-theme-shortcut="deep-ocean-blue"/);
  assert.match(js, /data-return-compare/);
  assert.match(js, /data-theme-shortcut/);
  assert.match(js, /proposal\.hidden = !selected\.includes/);
  assert.match(css, /\.lab-shell\s*\{\s*width:\s*100%;\s*max-width:\s*none/);
  assert.match(css, /\.lab-variants\s*\[data-proposal\]\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.lab-variants\.is-solo/);
  assert.match(css, /@media \(max-width: 700px\)/);
});

test("ivory and midnight blue palette text tokens retain readable base-surface contrast", () => {
  for (const theme of ["light", "deep-ocean-blue"]) {
    const tokens = themeTokens(theme);
    assert.ok(contrastRatio(tokens["--text"], tokens["--card-bg"]) >= 4.5, `${theme} primary text contrast`);
    assert.ok(contrastRatio(tokens["--muted"], tokens["--card-bg"]) >= 4.5, `${theme} secondary text contrast`);
    assert.ok(contrastRatio(tokens["--primary"], tokens["--card-bg"]) >= 4.5, `${theme} accent contrast`);
  }
});
