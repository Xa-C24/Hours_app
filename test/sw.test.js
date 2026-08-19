const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STATIC_CACHE_NAME,
  STATIC_ASSETS,
  isCacheableStaticAssetRequest,
  getObsoleteCacheKeys,
} = require("../public/sw");

const APP_ORIGIN = "https://hours.example";

test("service worker precache list contains only explicit static assets", () => {
  assert.equal(STATIC_CACHE_NAME, "hours-static-v8");
  assert.deepEqual(STATIC_ASSETS, [
    "/manifest.json",
    "/style.css",
    "/theme.js",
    "/toast-center.js",
    "/entry-draft-store.js",
    "/notification-center.js",
    "/settings-store.js",
    "/onboarding.js",
    "/workspace-tabs.js",
    "/vendor/emoji-picker-element/index.js",
    "/icon.svg",
    "/ApH192x192.png",
    "/ApH512x512.png",
    "/ApH180x180.png",
    "/ApH32x32.png",
    "/hours.png",
  ]);
});

test("service worker never caches authenticated or dynamic application routes", () => {
  const deniedRequests = [
    { url: "https://hours.example/", destination: "document" },
    { url: "https://hours.example/api/settings", destination: "script" },
    { url: "https://hours.example/api/entries/by-date?clientId=3&date=2026-08-19", destination: "script" },
    { url: "https://hours.example/export.xlsx?clientId=7&month=2026-08", destination: "document" },
    { url: "https://hours.example/export.pdf?clientId=7&month=2026-08", destination: "document" },
    { url: "https://hours.example/export.csv?clientId=7&month=2026-08", destination: "document" },
    { url: "https://hours.example/login", destination: "document" },
    { url: "https://hours.example/register", destination: "document" },
    { url: "https://hours.example/forgot-password", destination: "document" },
    { url: "https://hours.example/logout", method: "POST", destination: "document" },
  ];

  deniedRequests.forEach((request) => {
    assert.equal(
      isCacheableStaticAssetRequest(request.url, {
        method: request.method || "GET",
        destination: request.destination,
        origin: APP_ORIGIN,
      }),
      false,
      `request should be network-only: ${request.url}`
    );
  });
});

test("service worker allows only explicit public static assets", () => {
  const allowedRequests = [
    { url: "https://hours.example/style.css", destination: "style" },
    { url: "https://hours.example/theme.js", destination: "script" },
    { url: "https://hours.example/toast-center.js", destination: "script" },
    { url: "https://hours.example/entry-draft-store.js", destination: "script" },
    { url: "https://hours.example/notification-center.js", destination: "script" },
    { url: "https://hours.example/settings-store.js", destination: "script" },
    { url: "https://hours.example/onboarding.js", destination: "script" },
    { url: "https://hours.example/workspace-tabs.js", destination: "script" },
    { url: "https://hours.example/vendor/emoji-picker-element/index.js", destination: "script" },
    { url: "https://hours.example/manifest.json", destination: "manifest" },
    { url: "https://hours.example/icon.svg", destination: "image" },
    { url: "https://hours.example/ApH192x192.png", destination: "image" },
    { url: "https://hours.example/ApH512x512.png", destination: "image" },
    { url: "https://hours.example/ApH180x180.png", destination: "image" },
    { url: "https://hours.example/ApH32x32.png", destination: "image" },
    { url: "https://hours.example/hours.png", destination: "image" },
  ];

  allowedRequests.forEach((request) => {
    assert.equal(
      isCacheableStaticAssetRequest(request.url, {
        method: "GET",
        destination: request.destination,
        origin: APP_ORIGIN,
      }),
      true,
      `request should be cacheable: ${request.url}`
    );
  });
});

test("service worker rejects non-allowlisted same-origin assets and cross-origin requests", () => {
  const deniedRequests = [
    { url: "https://hours.example/logo_app.png", destination: "image" },
    { url: "https://hours.example/bandeau_extract.png", destination: "image" },
    { url: "https://hours.example/hoursP.png", destination: "image" },
    { url: "https://cdn.example/style.css", destination: "style" },
  ];

  deniedRequests.forEach((request) => {
    assert.equal(
      isCacheableStaticAssetRequest(request.url, {
        method: "GET",
        destination: request.destination,
        origin: APP_ORIGIN,
      }),
      false,
      `request should stay off cache: ${request.url}`
    );
  });
});

test("service worker removes old caches and keeps the active version", () => {
  assert.deepEqual(
    getObsoleteCacheKeys(["hours-static-v5", "hours-static-v6", STATIC_CACHE_NAME, "misc-cache"]),
    ["hours-static-v5", "hours-static-v6", "misc-cache"]
  );
});
