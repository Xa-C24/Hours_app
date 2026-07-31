const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SETTINGS,
  normalizeSettings,
  normalizeSettingsPatch,
  formatMinutesAsHHMM,
} = require("../settings");

test("normalizeSettings keeps defaults and sanitizes invalid values", () => {
  const result = normalizeSettings({
    theme: "unknown",
    accentColor: "steel",
    dailyGoal: "07:30",
    defaultPause: "-15",
    defaultStartTime: "08:45",
    defaultEndTime: "99:00",
    firstDayOfWeek: "sunday",
    compactMode: "true",
    animations: "reduced",
    fontSize: "large",
    profileRole: "  Consultante senior  ",
    profileEmail: "  ALICE@EXEMPLE.FR  ",
    avatarStyle: "illustration",
    exportFilenamePattern: "  hours_{month}  ",
    exportSignature: "  Alice Martin  ",
    notifications: {
      missingEntry: 0,
      goalReached: "yes",
    },
  });

  assert.equal(result.theme, DEFAULT_SETTINGS.theme);
  assert.equal(result.accentColor, "steel");
  assert.equal(result.dailyGoal, 450);
  assert.equal(result.defaultPause, 0);
  assert.equal(result.defaultStartTime, "08:45");
  assert.equal(result.defaultEndTime, DEFAULT_SETTINGS.defaultEndTime);
  assert.equal(result.firstDayOfWeek, "sunday");
  assert.equal(result.contractType, "35h");
  assert.equal(result.profileRole, "Consultante senior");
  assert.equal(result.profileEmail, "alice@exemple.fr");
  assert.equal(result.avatarStyle, "illustration");
  assert.equal(result.compactMode, true);
  assert.equal(result.animations, "reduced");
  assert.equal(result.fontSize, "large");
  assert.equal(result.exportFilenamePattern, "hours_{month}");
  assert.equal(result.exportSignature, "Alice Martin");
  assert.deepEqual(result.notifications, {
    missingEntry: false,
    goalReached: true,
    weeklySummary: false,
    productNews: false,
  });
  assert.deepEqual(result.onboarding, {
    status: "not_started",
    currentStep: 1,
    completedAt: "",
    skippedAt: "",
  });
});

test("normalizeSettingsPatch only returns provided keys", () => {
  const result = normalizeSettingsPatch({
    defaultPause: "45",
    notifications: {
      weeklySummary: true,
    },
  });

  assert.deepEqual(result, {
    defaultPause: 45,
    notifications: {
      missingEntry: true,
      goalReached: true,
      weeklySummary: true,
      productNews: false,
    },
  });
});

test("normalizeSettingsPatch sanitizes onboarding and profile fields", () => {
  const result = normalizeSettingsPatch({
    profileName: "  Alice Martin  ",
    companyName: "  TimePilot  ",
    profileRole: "  Chef de projet  ",
    profileEmail: "  PM@TIMEPILOT.FR  ",
    contractType: "39h",
    avatarStyle: "logo",
    fontSize: "compact",
    exportFilenamePattern: "  exports_{client}  ",
    exportSignature: "  PM signature  ",
    onboarding: {
      status: "in_progress",
      currentStep: 4,
      completedAt: "2026-07-09T12:00:00.000Z",
    },
  });

  assert.deepEqual(result, {
    profileName: "Alice Martin",
    companyName: "TimePilot",
    profileRole: "Chef de projet",
    profileEmail: "pm@timepilot.fr",
    contractType: "39h",
    avatarStyle: "logo",
    fontSize: "compact",
    exportFilenamePattern: "exports_{client}",
    exportSignature: "PM signature",
    onboarding: {
      status: "in_progress",
      currentStep: 4,
      completedAt: "2026-07-09T12:00:00.000Z",
      skippedAt: "",
    },
  });
});

test("formatMinutesAsHHMM formats minute totals", () => {
  assert.equal(formatMinutesAsHHMM(0), "00:00");
  assert.equal(formatMinutesAsHHMM(465), "07:45");
});
