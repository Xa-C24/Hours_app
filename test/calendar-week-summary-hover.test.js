const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const style = fs.readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");

test("weekly summary cards keep a quiet rest state and a pointer-only premium hover", () => {
  assert.match(style, /\.calendar-week-total-card\s*\{[\s\S]*?transform: scale\(1\);[\s\S]*?box-shadow: none;[\s\S]*?transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;/);
  assert.match(style, /@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*?\.calendar-week-total-card:hover\s*\{[\s\S]*?transform: translateY\(-2px\) scale\(1\.035\);[\s\S]*?border-color: rgba\(255, 255, 255, 0\.55\);[\s\S]*?0 0 18px rgba\(255, 255, 255, 0\.1\);/);
  assert.doesNotMatch(style, /\.calendar-week-total-card:active/);
});

test("weekly summary card reduced motion removes transform while retaining a subtle hover boundary", () => {
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.calendar-week-total-card\s*\{[\s\S]*?transition: border-color 160ms ease, box-shadow 160ms ease;/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.calendar-week-total-card:hover\s*\{[\s\S]*?transform: none;[\s\S]*?0 0 8px rgba\(255, 255, 255, 0\.12\);/);
});
