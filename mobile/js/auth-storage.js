import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { isCapacitorNativeRuntime } from "./config.js";

const TOKEN_KEY = "hours.mobile.bearer";
let runtimeToken = "";

export const authStorage = {
  getRuntimeToken: () => runtimeToken,
  async getToken() {
    if (!isCapacitorNativeRuntime()) return runtimeToken;
    const result = await SecureStorage.get({ key: TOKEN_KEY });
    runtimeToken = result.value || "";
    return runtimeToken;
  },
  async setToken(token) {
    runtimeToken = token;
    if (isCapacitorNativeRuntime()) await SecureStorage.set({ key: TOKEN_KEY, value: token });
  },
  async removeToken() {
    runtimeToken = "";
    if (isCapacitorNativeRuntime()) await SecureStorage.remove({ key: TOKEN_KEY });
  },
};
