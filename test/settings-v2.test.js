const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const viewPath = path.join(__dirname, "..", "views", "index.ejs");
const storePath = path.join(__dirname, "..", "public", "settings-store.js");
const stylePath = path.join(__dirname, "..", "public", "style.css");

test("Settings V2 exposes one useful panel at a time", () => {
  const view = fs.readFileSync(viewPath, "utf8");
  const start = view.indexOf('class="settings-panel settings-v2-panel is-active"');
  const end = view.indexOf('class="settings-panel" data-settings-section="profile"', start);
  const workspace = view.slice(start, end);

  ["profile", "work", "goals", "appearance", "notifications", "account"].forEach((key) => {
    assert.match(workspace, new RegExp(`data-settings-section="${key}"`));
  });
  assert.match(workspace, /data-settings-section="work" data-settings-form="work" hidden/);
  assert.match(view, /const setVisibleSection = \(targetKey\) =>/);
  assert.match(view, /section\.hidden = !isActive/);
  assert.match(view, /settings-nav-secondary/);
  assert.match(view, /style\.css\?v=entry-status-client-v2/);
  assert.match(view, /settings-store\.js\?v=settings-v2-3/);
  assert.doesNotMatch(workspace, /productNews|contractType|exportFilenamePattern|exportSignature/);
});

test("Settings V2 keeps local forms and immediate préférences on the existing store", () => {
  const store = fs.readFileSync(storePath, "utf8");

  assert.match(store, /target\.closest\("\[data-settings-form\]"\)/);
  assert.match(store, /data-settings-save-section/);
  assert.match(store, /saveSectionButton\.closest\(`\[data-settings-section="\$\{sectionKey\}"\]`\)/);
  assert.doesNotMatch(store, /document\.querySelector\(`\.settings-v2-panel\[data-settings-section="\$\{sectionKey\}"\]/);
  assert.match(store, /await savePatch\(patch\)/);
  assert.match(store, /element\.type === "radio"/);
  assert.match(store, /element\.checked = element\.value === String\(state\.settings\[key\]\)/);
});

test("custom selects constrain their menu and choose a dropup from available viewport space", () => {
  const store = fs.readFileSync(storePath, "utf8");
  const style = fs.readFileSync(stylePath, "utf8");

  assert.match(style, /\.app-custom-select\.is-open\s*\{[\s\S]*?z-index: 20;/);
  assert.match(style, /\.app-custom-select-menu,[\s\S]*?max-height: min\(18rem, 45dvh, var\(--app-custom-select-available-height, 18rem\)\);[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/);
  assert.match(style, /\.app-custom-select\.is-dropup \.app-custom-select-menu,[\s\S]*?bottom: calc\(100% \+ 0\.45rem\);/);
  assert.match(store, /function positionCustomSelectMenu\(wrapper, trigger, menu\)/);
  assert.match(store, /const shouldOpenUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;/);
  assert.match(store, /wrapper\.classList\.toggle\("is-dropup", shouldOpenUp\)/);
  assert.match(store, /menu\.style\.setProperty\("--app-custom-select-available-height"/);
  assert.match(store, /genericSelect\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
  assert.match(store, /genericSelect\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
});

test("positive save actions share the green save CTA treatment", () => {
  const view = fs.readFileSync(viewPath, "utf8");
  const style = fs.readFileSync(stylePath, "utf8");

  assert.match(view, /data-settings-save-section="profile" data-ripple>Enregistrer<\/button>/);
  assert.match(view, /class="primary btn-save-primary" data-settings-save-section="profile"/);
  assert.match(view, /class="primary btn-save-primary" data-settings-save-section="work"/);
  assert.match(view, /<button type="submit" class="btn-save-primary" data-ripple>Enregistrer<\/button>/);
  assert.match(style, /--save-primary: #2f8f5b;/);
  assert.match(style, /\.btn-save-primary\s*\{[\s\S]*?background: linear-gradient\(135deg, var\(--save-primary\), var\(--save-primary-hover\)\);/);
  assert.match(style, /\.btn-save-primary:hover:not\(:disabled\)\s*\{[\s\S]*?transform: translateY\(-1px\) scale\(1\.04\);/);
  assert.match(style, /\.btn-save-primary:active:not\(:disabled\)\s*\{[\s\S]*?transform: translateY\(0\) scale\(0\.96\);/);
  assert.match(style, /\.btn-save-primary:focus-visible\s*\{[\s\S]*?var\(--save-primary-focus\)/);
  assert.match(style, /\.btn-save-primary:disabled,[\s\S]*?\.btn-save-primary\.is-saving\s*\{[\s\S]*?box-shadow: none;/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.btn-save-primary:hover:not\(:disabled\)[\s\S]*?transform: none;/);
});
