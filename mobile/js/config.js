const RENDER_API_BASE_URL = "https://hours-app-lvty.onrender.com";

export function isCapacitorNativeRuntime() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

export function getApiBaseUrl() {
  if (typeof globalThis.HOURS_API_BASE_URL === "string" && globalThis.HOURS_API_BASE_URL) {
    return globalThis.HOURS_API_BASE_URL.replace(/\/$/, "");
  }
  return isCapacitorNativeRuntime() ? RENDER_API_BASE_URL : "";
}
