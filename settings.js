const SETTING_KEYS = [
  "theme",
  "accentColor",
  "dailyGoal",
  "defaultPause",
  "defaultStartTime",
  "defaultEndTime",
  "firstDayOfWeek",
  "contractType",
  "profileName",
  "companyName",
  "profileRole",
  "profileEmail",
  "profilePhoto",
  "companyLogo",
  "avatarStyle",
  "compactMode",
  "animations",
  "fontSize",
  "notifications",
  "exportFilenamePattern",
  "exportSignature",
  "onboarding",
];

const DEFAULT_SETTINGS = {
  theme: "light",
  accentColor: "amber",
  dailyGoal: 7 * 60,
  defaultPause: 60,
  defaultStartTime: "09:00",
  defaultEndTime: "17:00",
  firstDayOfWeek: "monday",
  contractType: "35h",
  profileName: "",
  companyName: "",
  profileRole: "",
  profileEmail: "",
  profilePhoto: "",
  companyLogo: "",
  avatarStyle: "monogram",
  compactMode: false,
  animations: "subtle",
  fontSize: "comfort",
  notifications: {
    missingEntry: true,
    goalReached: true,
    weeklySummary: false,
    productNews: false,
  },
  exportFilenamePattern: "hours_{client}_{month}",
  exportSignature: "",
  onboarding: {
    status: "not_started",
    currentStep: 1,
    completedAt: "",
    skippedAt: "",
  },
};

const THEMES = [
  "light",
  "dark",
  "deep-ocean-blue",
  "light-blue",
  "orange-sunset",
  "forest-green",
  "light-green",
  "robot",
];

const ACCENT_COLORS = ["amber", "steel", "sage", "coral"];
const FIRST_DAY_OF_WEEK_VALUES = ["monday", "sunday"];
const ANIMATION_VALUES = ["subtle", "reduced", "off"];
const CONTRACT_TYPE_VALUES = ["35h", "39h", "freelance", "custom"];
const AVATAR_STYLE_VALUES = ["monogram", "illustration", "logo"];
const FONT_SIZE_VALUES = ["comfort", "compact", "large"];
const ONBOARDING_STATUS_VALUES = ["not_started", "in_progress", "completed", "skipped"];
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function normalizeChoice(value, allowedValues, fallback) {
  return allowedValues.includes(value) ? value : fallback;
}

function normalizeTime(value, fallback) {
  return typeof value === "string" && TIME_PATTERN.test(value.trim()) ? value.trim() : fallback;
}

function parseMinutesValue(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  if (TIME_PATTERN.test(trimmed)) {
    const [hours, minutes] = trimmed.split(":").map(Number);
    return hours * 60 + minutes;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function normalizeDailyGoal(value) {
  const normalized = parseMinutesValue(value, DEFAULT_SETTINGS.dailyGoal);
  return Math.max(0, Math.min(24 * 60, normalized));
}

function normalizeDefaultPause(value) {
  const normalized = parseMinutesValue(value, DEFAULT_SETTINGS.defaultPause);
  return Math.max(0, Math.min(24 * 60, normalized));
}

function normalizeNotifications(value) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : DEFAULT_SETTINGS.notifications;
  return {
    missingEntry: normalizeBoolean(input.missingEntry, DEFAULT_SETTINGS.notifications.missingEntry),
    goalReached: normalizeBoolean(input.goalReached, DEFAULT_SETTINGS.notifications.goalReached),
    weeklySummary: normalizeBoolean(input.weeklySummary, DEFAULT_SETTINGS.notifications.weeklySummary),
    productNews: normalizeBoolean(input.productNews, DEFAULT_SETTINGS.notifications.productNews),
  };
}

function normalizeText(value, fallback = "", maxLength = 160) {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim().slice(0, maxLength);
}

function normalizeEmail(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim().slice(0, 160).toLowerCase();
}

function normalizeImageData(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("data:image/") ? trimmed : "";
}

function normalizeOnboarding(value) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : DEFAULT_SETTINGS.onboarding;
  return {
    status: normalizeChoice(input.status, ONBOARDING_STATUS_VALUES, DEFAULT_SETTINGS.onboarding.status),
    currentStep: Math.max(1, Math.min(6, Number.parseInt(input.currentStep, 10) || 1)),
    completedAt: normalizeText(input.completedAt, "", 40),
    skippedAt: normalizeText(input.skippedAt, "", 40),
  };
}

function normalizeSettingValue(key, value) {
  switch (key) {
    case "theme":
      return normalizeChoice(value, THEMES, DEFAULT_SETTINGS.theme);
    case "accentColor":
      return normalizeChoice(value, ACCENT_COLORS, DEFAULT_SETTINGS.accentColor);
    case "dailyGoal":
      return normalizeDailyGoal(value);
    case "defaultPause":
      return normalizeDefaultPause(value);
    case "defaultStartTime":
      return normalizeTime(value, DEFAULT_SETTINGS.defaultStartTime);
    case "defaultEndTime":
      return normalizeTime(value, DEFAULT_SETTINGS.defaultEndTime);
    case "firstDayOfWeek":
      return normalizeChoice(value, FIRST_DAY_OF_WEEK_VALUES, DEFAULT_SETTINGS.firstDayOfWeek);
    case "contractType":
      return normalizeChoice(value, CONTRACT_TYPE_VALUES, DEFAULT_SETTINGS.contractType);
    case "profileName":
      return normalizeText(value, DEFAULT_SETTINGS.profileName, 120);
    case "companyName":
      return normalizeText(value, DEFAULT_SETTINGS.companyName, 160);
    case "profileRole":
      return normalizeText(value, DEFAULT_SETTINGS.profileRole, 120);
    case "profileEmail":
      return normalizeEmail(value, DEFAULT_SETTINGS.profileEmail);
    case "profilePhoto":
      return normalizeImageData(value);
    case "companyLogo":
      return normalizeImageData(value);
    case "avatarStyle":
      return normalizeChoice(value, AVATAR_STYLE_VALUES, DEFAULT_SETTINGS.avatarStyle);
    case "compactMode":
      return normalizeBoolean(value, DEFAULT_SETTINGS.compactMode);
    case "animations":
      return normalizeChoice(value, ANIMATION_VALUES, DEFAULT_SETTINGS.animations);
    case "fontSize":
      return normalizeChoice(value, FONT_SIZE_VALUES, DEFAULT_SETTINGS.fontSize);
    case "notifications":
      return normalizeNotifications(value);
    case "exportFilenamePattern":
      return normalizeText(value, DEFAULT_SETTINGS.exportFilenamePattern, 120);
    case "exportSignature":
      return normalizeText(value, DEFAULT_SETTINGS.exportSignature, 160);
    case "onboarding":
      return normalizeOnboarding(value);
    default:
      return undefined;
  }
}

function normalizeSettings(input = {}) {
  const normalized = {};
  for (const key of SETTING_KEYS) {
    const rawValue = Object.prototype.hasOwnProperty.call(input, key)
      ? input[key]
      : DEFAULT_SETTINGS[key];
    normalized[key] = normalizeSettingValue(key, rawValue);
  }
  return normalized;
}

function normalizeSettingsPatch(input = {}) {
  const normalized = {};
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      continue;
    }
    normalized[key] = normalizeSettingValue(key, input[key]);
  }
  return normalized;
}

function mergeSettings(...values) {
  return Object.assign({}, DEFAULT_SETTINGS, ...values.map((value) => normalizeSettingsPatch(value)));
}

function formatMinutesAsHHMM(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

module.exports = {
  SETTING_KEYS,
  DEFAULT_SETTINGS,
  THEMES,
  ACCENT_COLORS,
  FIRST_DAY_OF_WEEK_VALUES,
  ANIMATION_VALUES,
  CONTRACT_TYPE_VALUES,
  AVATAR_STYLE_VALUES,
  FONT_SIZE_VALUES,
  normalizeSettings,
  normalizeSettingsPatch,
  mergeSettings,
  formatMinutesAsHHMM,
};
