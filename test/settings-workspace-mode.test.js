const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const viewPath = path.join(__dirname, "..", "views", "index.ejs");
const stylePath = path.join(__dirname, "..", "public", "style.css");

test("desktop settings mode isolates the settings workspace from business content", () => {
  const view = fs.readFileSync(viewPath, "utf8");
  const styles = fs.readFileSync(stylePath, "utf8");

  assert.match(view, /data-mobile-shell data-main-workspace/);
  assert.match(view, /client-empty-card" data-main-workspace/);
  const mainWorkspaceStart = view.indexOf('<div class="mobile-premium-shell" data-mobile-shell data-main-workspace>');
  const mainWorkspaceEnd = view.indexOf('<footer class="app-footer">', mainWorkspaceStart);
  const mainWorkspaceMarkup = view.slice(mainWorkspaceStart, mainWorkspaceEnd);

  [
    "cockpit-dashboard",
    "cockpit-quick-actions",
    "cockpit-week-activity",
    "mobile-stats-card",
    "data-entry-card",
    "pay-period-card",
    "data-calendar-board",
    "data-archived-clients-card",
  ].forEach((marker) => {
    assert.ok(mainWorkspaceMarkup.includes(marker), `${marker} must remain under data-main-workspace`);
  });

  assert.match(view, /const mainWorkspaces = Array\.from\(document\.querySelectorAll\("\[data-main-workspace\]"\)\)/);
  assert.match(view, /document\.documentElement\.toggleAttribute\("data-settings-mode", isActive\)/);
  assert.match(view, /document\.body\.toggleAttribute\("data-settings-mode", isActive\)/);
  assert.match(view, /item\.hidden = isActive/);
  assert.match(view, /footer\.hidden = isActive/);
  assert.match(view, /document\.documentElement\.removeAttribute\("data-settings-mode"\)/);
  assert.match(view, /mobileSettingsButton\.click\(\)/);
  assert.match(styles, /\[data-main-workspace\]\[hidden\],\s*\.app-footer\[hidden\] \{\s*display: none !important;/);
  assert.match(styles, /html\[data-settings-mode="true"\] \[data-main-workspace\],\s*body\[data-settings-mode="true"\] \[data-main-workspace\] \{\s*display: none !important;/);
  assert.match(styles, /html\[data-settings-mode="true"\] \.app-footer,/);
  assert.match(styles, /html\[data-settings-mode="true"\] \.settings-workspace,/);
});
