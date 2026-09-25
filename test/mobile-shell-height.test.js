const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const view = fs.readFileSync(path.join(__dirname, "..", "views", "index.ejs"), "utf8");
const start = view.indexOf("const syncShellHeight = () => {");
const end = view.indexOf("const observeActiveView", start);
const source = view.slice(start, end);

test("mobile shell includes navigation, dots and margins for each selected page", () => {
  const track = {};
  const child = (height, top, bottom) => ({
    getBoundingClientRect: () => ({ height }),
    style: { marginTop: top, marginBottom: bottom },
  });
  const shell = {
    style: {},
    children: [track, child(24, "12px", "0px"), child(68, "12px", "0px")],
  };
  const mobileQuery = { matches: true };
  let activeView = { scrollHeight: 900 };
  const context = vm.createContext({
    shell, track, mobileQuery,
    getActiveView: () => activeView,
    window: { getComputedStyle: (element) => element.style },
  });
  vm.runInContext(`${source}\nthis.sync = syncShellHeight;`, context);
  context.sync();
  assert.equal(shell.style.height, "1016px");
  activeView = { scrollHeight: 350 };
  context.sync();
  assert.equal(shell.style.height, "466px");
  mobileQuery.matches = false;
  context.sync();
  assert.equal(shell.style.height, "");
});
