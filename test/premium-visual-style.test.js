const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extractThemeTokenRules } = require("../design-lab/theme-tokens");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Premium visual tokens follow the active palette and cover the real app surfaces", () => {
  const css = read("public/style.css");
  const paletteRules = extractThemeTokenRules(css);
  const paletteNames = new Set([...paletteRules.matchAll(/:root\[data-theme="([^"]+)"\]/g)].map((match) => match[1]));

  assert.equal(paletteNames.size, 11);
  assert.match(css, /:root\[data-style="premium"\]\s*\{[\s\S]*?--premium-gradient:[^;]*var\(--card-bg\)/);
  assert.match(css, /:root\[data-style="premium"\] :is\(\.home-premium-page, \.auth-premium-page\) :is\([^)]*\.login-card-premium/);
  for (const selector of [
    ".cockpit-action-card",
    ".entry-card[data-entry-card]",
    ".client-modal-dialog",
    ".day-details-modal-dialog",
    ".week-summary-modal-dialog",
    ".notifications-panel",
    ".app-custom-select-menu",
  ]) {
    assert.ok(css.includes(selector), `premium stylesheet contains ${selector}`);
  }
  assert.match(css, /:root\[data-style="premium"\] \.home-premium-page \.client-modal-backdrop/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /:root\[data-style="premium"\][^\n]*#(?:d9b56a|f3dfb1|e2bf79|e5485d)/i);
});

test("Premium stylesheet cache version is consistent across app and auth pages", () => {
  const version = "hours-premium-v4-12-20261020";
  for (const view of ["views/index.ejs", "views/login.ejs", "views/register.ejs", "views/forgot-password.ejs"]) {
    assert.match(read(view), new RegExp(`/style\\.css\\?v=${version}`), `${view} uses the refreshed stylesheet`);
  }
  assert.match(read("public/sw.js"), /hours-static-v35/);
});

test("Premium button system covers app and auth controls with semantic and interaction states", () => {
  const css = read("public/style.css");
  assert.match(css, /:root\[data-style="premium"\] :is\(button:not\(\.cockpit-action-card\)/);
  for (const selector of [
    "input[type=\"submit\"]",
    "[role=\"button\"]",
    ".button-link",
    ":hover:not(:disabled)",
    ":active:not(:disabled)",
    ":focus-visible",
    "[aria-disabled=\"true\"]",
    ".btn-save-primary",
    ".danger",
    "[data-timer-action=\"pause\"]",
  ]) {
    assert.ok(css.includes(selector), `Premium button system contains ${selector}`);
  }
  assert.doesNotMatch(css, /:root\[data-style="premium"\]\.home-premium-page :is\([^\n]*button:not\(\.cockpit-action-card\)/);
});

test("Premium action colors resolve after the neutral base and meet contrast targets", () => {
  const css = read("public/style.css");
  const paletteRules = extractThemeTokenRules(css);
  const primaryColors = [...new Set([...paletteRules.matchAll(/--primary:\s*(#[\da-f]{6})\s*;/gi)].map((match) => match[1].toLowerCase()))];
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const contrastWithWhite = (hex) => 1.05 / (luminance(hex) + 0.05);
  const primarySurface = (hex) => {
    const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16));
    return `#${channels.map((value, index) => Math.round(value * 0.55 + [16, 24, 32][index] * 0.45).toString(16).padStart(2, "0")).join("")}`;
  };
  const premiumRoot = css.match(/:root\[data-style="premium"\]\s*\{([^}]*)\}/);
  assert.ok(premiumRoot, "Premium defines semantic action tokens");
  const semanticColor = (name) => {
    const value = premiumRoot[1].match(new RegExp(`--premium-${name}:\\s*(#[\\da-f]{6})\\s*;`, "i"));
    assert.ok(value, `--premium-${name} has an explicit color`);
    assert.ok(contrastWithWhite(value[1]) >= 4.5, `white text is readable on --premium-${name}`);
    return value[1].toLowerCase();
  };

  assert.ok(primaryColors.length >= 11, "all eleven palette primary tokens and additional derived tokens are checked");
  for (const color of primaryColors) {
    assert.ok(contrastWithWhite(primarySurface(color)) >= 4.5, `primary color ${color} keeps readable white text after darkening`);
  }
  assert.equal(semanticColor("success"), "#1d6b42");
  assert.equal(semanticColor("danger"), "#b42332");
  assert.equal(semanticColor("warning"), "#9a5700");

  const neutralBase = css.indexOf(':root[data-style="premium"] :is(button:not(.cockpit-action-card)');
  const primaryActions = css.indexOf(':root[data-style="premium"] :is(button[type="submit"]');
  const successActions = css.indexOf(':root[data-style="premium"] :is(.success, .btn-success, .btn-save-primary');
  assert.ok(primaryActions > neutralBase, "palette primary color overrides the neutral base");
  assert.ok(successActions > primaryActions, "success color overrides generic submit color");
  assert.match(css, /:root\[data-style="premium"\] :is\(button\[type="submit"\][^\n]*\[data-day-details-create\]/);
  assert.match(css, /--premium-primary-action:\s*color-mix\(in srgb, var\(--primary\) 55%, #101820 45%\)/);
  assert.match(css, /:root\[data-style="premium"\] \.home-premium-page \.day-details-modal-dialog \.day-details-empty \.form-actions \[data-day-details-create\]\s*\{[^}]*background: linear-gradient\(150deg/);
  assert.match(css, /:root\[data-style="premium"\] \.home-premium-page \.btn-save-primary\[data-entry-submit-button\]\s*\{[^}]*var\(--premium-success\)/);
  assert.match(css, /\.btn-save-primary\[data-entry-submit-button\]:hover:not\(:disabled\)\s*\{[^}]*var\(--premium-success\)/);
  assert.match(css, /\.btn-save-primary\[data-entry-submit-button\]:active:not\(:disabled\)\s*\{[^}]*transform: translateY\(1px\)/);
  assert.match(css, /\.btn-save-primary\[data-entry-submit-button\]:focus-visible\s*\{[^}]*outline: 3px solid/);
  assert.match(css, /\.btn-save-primary\[data-entry-submit-button\]:disabled,[\s\S]*?\.btn-save-primary\[data-entry-submit-button\]\.is-saving\s*\{[^}]*opacity: 1;[^}]*filter: saturate\(0\.48\)/);
  assert.match(css, /:root\[data-style="premium"\] \.home-premium-page \.client-modal-close,\s*:root\[data-style="premium"\] \.toast-close/);
  assert.match(css, /\.day-details-modal-dialog \.client-modal-close\s*\{[^}]*width: auto;[^}]*min-width: max-content;[^}]*white-space: nowrap;/);
  assert.match(read("public/workspace-tabs.js"), /data-day-details-create=/);
  assert.match(read("public/workspace-tabs.js"), /data-mobile-calendar-create=/);
  assert.match(read("views/index.ejs"), /data-confirm-replace-submit/);
});
