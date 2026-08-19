const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const manifestPath = path.join(projectRoot, "public", "manifest.json");
const viewPath = path.join(projectRoot, "views", "index.ejs");

function readPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("manifest keeps the expected standalone PWA configuration", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(manifest.name, "Hours App");
  assert.equal(manifest.short_name, "Hours");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "any");
  assert.equal(manifest.background_color, "#ffffff");
  assert.equal(manifest.theme_color, "#1f2937");
  assert.deepEqual(
    manifest.icons.map((icon) => ({ src: icon.src, sizes: icon.sizes, type: icon.type })),
    [
      { src: "/ApH192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/ApH512x512.png", sizes: "512x512", type: "image/png" },
      { src: "/ApH32x32.png", sizes: "32x32", type: "image/png" },
    ]
  );
});

test("head declares iOS and desktop PWA integration tags", () => {
  const view = fs.readFileSync(viewPath, "utf8");

  assert.match(view, /<meta name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover" \/>/);
  assert.match(view, /<meta name="theme-color" content="#1f2937" \/>/);
  assert.match(view, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
  assert.match(view, /<meta name="apple-mobile-web-app-status-bar-style" content="default" \/>/);
  assert.match(view, /<meta name="apple-mobile-web-app-title" content="Hours" \/>/);
  assert.match(view, /<link rel="icon" type="image\/png" sizes="32x32" href="\/ApH32x32\.png" \/>/);
  assert.match(view, /<link rel="apple-touch-icon" sizes="180x180" href="\/ApH180x180\.png" \/>/);
  assert.match(view, /<link rel="manifest" href="\/manifest\.json" \/>/);
});

test("pwa icon files exist with the expected dimensions", () => {
  const files = [
    { path: path.join(projectRoot, "public", "ApH192x192.png"), width: 192, height: 192 },
    { path: path.join(projectRoot, "public", "ApH512x512.png"), width: 512, height: 512 },
    { path: path.join(projectRoot, "public", "ApH180x180.png"), width: 180, height: 180 },
    { path: path.join(projectRoot, "public", "ApH32x32.png"), width: 32, height: 32 },
  ];

  files.forEach((file) => {
    assert.equal(fs.existsSync(file.path), true, `${path.basename(file.path)} should exist`);
    assert.deepEqual(readPngDimensions(file.path), { width: file.width, height: file.height });
  });
});
