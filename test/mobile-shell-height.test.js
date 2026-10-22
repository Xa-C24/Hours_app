const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const view = fs.readFileSync(path.join(__dirname, "..", "views", "index.ejs"), "utf8");
const start = view.indexOf("const syncShellHeight = () => {");
const end = view.indexOf("const observeActiveView", start);
const source = view.slice(start, end);

test("phone shell height follows the active view and clears outside the phone breakpoint", () => {
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
  const phoneQuery = { matches: true };
  let activeView = { scrollHeight: 900 };
  const context = vm.createContext({
    shell, track, mobileQuery, phoneQuery,
    getActiveView: () => activeView,
    window: { getComputedStyle: (element) => element.style },
  });
  vm.runInContext(`${source}\nthis.sync = syncShellHeight;`, context);
  context.sync();
  assert.equal(shell.style.height, "900px");
  activeView = { scrollHeight: 350 };
  context.sync();
  assert.equal(shell.style.height, "350px");
  phoneQuery.matches = false;
  context.sync();
  assert.equal(shell.style.height, "");
  phoneQuery.matches = true;
  mobileQuery.matches = false;
  context.sync();
  assert.equal(shell.style.height, "");
});
