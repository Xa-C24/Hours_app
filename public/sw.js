const STATIC_CACHE_NAME = "hours-static-v8";
const STATIC_ASSETS = [
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
  "/ApH32x32.png",
  "/hours.png",
];

const STATIC_ASSET_PATHS = new Set(STATIC_ASSETS);
const CACHEABLE_DESTINATIONS = new Set(["style", "script", "image", "manifest"]);

function normalizeUrl(inputUrl, baseUrl = "https://app.local") {
  return new URL(inputUrl, baseUrl);
}

function isCacheableStaticAssetRequest(requestUrl, options = {}) {
  const requestMethod = options.method || "GET";
  const requestDestination = options.destination || "";
  const origin = options.origin || "https://app.local";
  const normalizedUrl = normalizeUrl(requestUrl, origin);

  if (requestMethod !== "GET") {
    return false;
  }
  if (normalizedUrl.origin !== origin) {
    return false;
  }
  if (!CACHEABLE_DESTINATIONS.has(requestDestination)) {
    return false;
  }
  return STATIC_ASSET_PATHS.has(normalizedUrl.pathname);
}

function getObsoleteCacheKeys(cacheKeys, activeCacheName = STATIC_CACHE_NAME) {
  return cacheKeys.filter((cacheKey) => cacheKey !== activeCacheName);
}

async function serveStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);
  if (response && response.status === 200 && response.type === "basic") {
    await cache.put(request, response.clone());
  }
  return response;
}

if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(STATIC_CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    event.waitUntil(self.skipWaiting());
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(getObsoleteCacheKeys(keys).map((key) => caches.delete(key)))
      )
    );
    event.waitUntil(self.clients.claim());
  });

  self.addEventListener("fetch", (event) => {
    if (
      !isCacheableStaticAssetRequest(event.request.url, {
        method: event.request.method,
        destination: event.request.destination,
        origin: self.location.origin,
      })
    ) {
      return;
    }

    event.respondWith(serveStaticAsset(event.request));
  });

  self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") {
      self.skipWaiting();
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STATIC_CACHE_NAME,
    STATIC_ASSETS,
    isCacheableStaticAssetRequest,
    getObsoleteCacheKeys,
  };
}
