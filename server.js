const path = require("path");
const crypto = require("crypto");
const express = require("express");
const db = require("./db");
const {
  buildPeriodWorkbook,
  buildHistoryWorkbook,
  buildExportFilename,
} = require("./excel-export");
const {
  DEFAULT_SETTINGS,
  normalizeSettings,
  normalizeSettingsPatch,
  mergeSettings,
} = require("./settings");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const DAILY_TARGET_MINUTES = 7 * 60;
const SESSION_COOKIE_NAME = "hours_session";
const CSRF_COOKIE_NAME = "hours_csrf";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const CSRF_TOKEN_DURATION_MS = 12 * 60 * 60 * 1000;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 10;
const RECOVERY_CODE_REGEX = /^\d{6}$/;
const MAX_COMMENT_LENGTH = 1000;
const MAX_CLIENT_FIELD_LENGTH = 500;
const MAX_CLIENT_LOGO_LENGTH = 2_000_000;
const CSV_SEPARATOR = ";";
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMITS = {
  login: { maxAttempts: 5, windowMs: RATE_LIMIT_WINDOW_MS },
  register: { maxAttempts: 4, windowMs: RATE_LIMIT_WINDOW_MS },
  forgotPassword: { maxAttempts: 5, windowMs: RATE_LIMIT_WINDOW_MS },
};

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_TYPE_OPTIONS = [
  { value: "office", label: "Bureau", isWorkedDay: true },
  { value: "remote", label: "Télétravail", isWorkedDay: true },
  { value: "leave", label: "Congés", isWorkedDay: false },
  { value: "rtt", label: "RTT", isWorkedDay: false },
  { value: "sick_leave", label: "Arret", isWorkedDay: false },
  { value: "holiday", label: "Férié", isWorkedDay: false },
];
const DEFAULT_DAY_TYPE = "office";
const DAY_TYPE_CONFIG_BY_VALUE = new Map(
  DAY_TYPE_OPTIONS.map((option) => [option.value, option])
);
const DAY_TYPE_FILTERS = [
  { value: "all", label: "Tous" },
  ...DAY_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
];

function getCanonicalDayTypeLabel(dayType, fallbackLabel = "") {
  switch (dayType) {
    case "office":
      return "Bureau";
    case "remote":
      return "Télétravail";
    case "leave":
      return "Congés";
    case "rtt":
      return "RTT";
    case "sick_leave":
      return "Arrêt";
    case "holiday":
      return "Férié";
    default:
      return fallbackLabel;
  }
}

function normalizeDisplayLabel(label) {
  const normalizedLabel = String(label ?? "");
  switch (normalizedLabel) {
    case "TÃ©lÃ©travail":
      return "Télétravail";
    case "CongÃ©s":
      return "Congés";
    case "Arret":
      return "Arrêt";
    case "FÃ©riÃ©":
      return "Férié";
    default:
      return normalizedLabel;
  }
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: false, limit: "6mb" }));
app.use(
  "/vendor/emoji-picker-element",
  express.static(path.join(__dirname, "node_modules", "emoji-picker-element"))
);
app.use(express.static(path.join(__dirname, "public")));

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use((req, res, next) => {
  ensureCsrfToken(req, res);
  next();
});

app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true });
});

function parseCookies(cookieHeader) {
  if (typeof cookieHeader !== "string" || cookieHeader.trim() === "") {
    return {};
  }
  const cookies = {};
  for (const item of cookieHeader.split(";")) {
    const [rawName, ...valueParts] = item.split("=");
    const name = rawName.trim();
    if (!name) {
      continue;
    }
    const value = valueParts.join("=").trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch (error) {
      cookies[name] = value;
    }
  }
  return cookies;
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || "";
}

async function createSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  await db.deleteExpiredSessions(Date.now());
  await db.upsertSession({
    token,
    username,
    expires_at_ms: Date.now() + SESSION_DURATION_MS,
  });
  return token;
}

async function getSessionFromRequest(req) {
  const token = getSessionTokenFromRequest(req);
  if (!token) {
    return null;
  }
  const session = await db.getSessionByToken(token);
  if (!session) {
    return null;
  }
  if (session.expires_at_ms <= Date.now()) {
    await db.deleteSession(token);
    return null;
  }
  await db.upsertSession({
    token,
    username: session.username,
    expires_at_ms: Date.now() + SESSION_DURATION_MS,
  });
  return { token, username: session.username };
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

function isValidUsername(value) {
  return typeof value === "string" && USERNAME_REGEX.test(value);
}

function isValidPassword(value) {
  return typeof value === "string" && value.length >= MIN_PASSWORD_LENGTH;
}

function normalizeRecoveryCode(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidRecoveryCode(value) {
  return typeof value === "string" && RECOVERY_CODE_REGEX.test(value);
}

function hashPassword(password, saltHex = crypto.randomBytes(16).toString("hex")) {
  const hashHex = crypto.scryptSync(password, saltHex, 64).toString("hex");
  return { saltHex, hashHex };
}

function generateRecoveryCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function verifyPassword(password, saltHex, expectedHashHex) {
  if (typeof password !== "string" || typeof saltHex !== "string" || typeof expectedHashHex !== "string") {
    return false;
  }
  try {
    const expectedBuffer = Buffer.from(expectedHashHex, "hex");
    const computedBuffer = crypto.scryptSync(password, saltHex, expectedBuffer.length);
    if (expectedBuffer.length !== computedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, computedBuffer);
  } catch (error) {
    return false;
  }
}

function getRequestIp(req) {
  if (typeof req.ip === "string" && req.ip) {
    return req.ip;
  }
  if (typeof req.socket?.remoteAddress === "string" && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }
  return "unknown";
}

function logSecurityEvent(event, details = {}) {
  const safeDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (["password", "token", "csrfToken", "recoveryCode", "newPassword", "confirmPassword"].includes(key)) {
      continue;
    }
    safeDetails[key] = value;
  }
  console.warn(
    `[security] ${event} ${JSON.stringify({
      at: new Date().toISOString(),
      ...safeDetails,
    })}`
  );
}

function safeEqualString(leftValue, rightValue) {
  if (typeof leftValue !== "string" || typeof rightValue !== "string") {
    return false;
  }
  const leftBuffer = Buffer.from(leftValue);
  const rightBuffer = Buffer.from(rightValue);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function generateCsrfToken() {
  return crypto.randomBytes(24).toString("hex");
}

function isValidCsrfToken(value) {
  return typeof value === "string" && /^[a-f0-9]{48}$/i.test(value);
}

function setCsrfCookie(res, csrfToken) {
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CSRF_TOKEN_DURATION_MS,
  });
}

function getCsrfTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const csrfToken = cookies[CSRF_COOKIE_NAME] || "";
  return isValidCsrfToken(csrfToken) ? csrfToken : "";
}

function ensureCsrfToken(req, res) {
  const existingToken = getCsrfTokenFromRequest(req);
  if (existingToken) {
    req.csrfToken = existingToken;
    res.locals.csrfToken = existingToken;
    return existingToken;
  }
  const nextToken = generateCsrfToken();
  setCsrfCookie(res, nextToken);
  req.csrfToken = nextToken;
  res.locals.csrfToken = nextToken;
  return nextToken;
}

function buildSecurityErrorMessage(actionLabel) {
  return `${actionLabel} impossible pour le moment. Rechargez la page puis réessayez.`;
}

const authAttemptStore = new Map();

function consumeRateLimitBucket(key, maxAttempts, windowMs) {
  const now = Date.now();
  const entry = authAttemptStore.get(key);
  if (!entry || entry.resetAtMs <= now) {
    authAttemptStore.set(key, {
      count: 1,
      resetAtMs: now + windowMs,
    });
    return { allowed: true, remaining: Math.max(0, maxAttempts - 1) };
  }
  if (entry.count >= maxAttempts) {
    return { allowed: false, remaining: 0, retryAfterMs: entry.resetAtMs - now };
  }
  entry.count += 1;
  authAttemptStore.set(key, entry);
  return { allowed: true, remaining: Math.max(0, maxAttempts - entry.count) };
}

function isDuplicateUsernameError(error) {
  return Boolean(
    error &&
      typeof error.message === "string" &&
      (
        error.message.includes("UNIQUE constraint failed: users.username") ||
        error.message.includes('duplicate key value violates unique constraint') ||
        error.message.includes("users_username_key")
      )
  );
}

function normalizeDayType(value) {
  return typeof value === "string" && DAY_TYPE_CONFIG_BY_VALUE.has(value) ? value : "";
}

function getDayTypeConfig(dayType) {
  const config =
    DAY_TYPE_CONFIG_BY_VALUE.get(normalizeDayType(dayType)) ||
    DAY_TYPE_CONFIG_BY_VALUE.get(DEFAULT_DAY_TYPE);
  return {
    ...config,
    label: getCanonicalDayTypeLabel(config.value, normalizeDisplayLabel(config.label)),
  };
}

function isWorkedDayType(dayType) {
  return getDayTypeConfig(dayType).isWorkedDay;
}

function getTargetMinutesForDayType(dayType) {
  return isWorkedDayType(dayType) ? DAILY_TARGET_MINUTES : 0;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatDateDisplayFr(dateString) {
  if (typeof dateString !== "string" || !DATE_REGEX.test(dateString)) {
    return dateString;
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return dateString;
  }
  return parsed.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateDayMonthFr(dateString) {
  if (typeof dateString !== "string" || !DATE_REGEX.test(dateString)) {
    return "";
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return "";
  }
  return parsed.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
  });
}

function formatDateShortFr(dateString) {
  if (typeof dateString !== "string" || !DATE_REGEX.test(dateString)) {
    return "";
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return "";
  }
  return parsed.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateTimeDisplayFr(dateTimeString) {
  if (typeof dateTimeString !== "string" || !dateTimeString.trim()) {
    return "";
  }
  const [datePart, timePart = ""] = dateTimeString.trim().split(/\s+/);
  const dateLabel = formatDateShortFr(datePart);
  const timeLabel = timePart.slice(0, 5);
  if (dateLabel && timeLabel) {
    return `${dateLabel} a ${timeLabel}`;
  }
  return dateLabel || dateTimeString;
}

function formatCurrencyFromCents(amountCents) {
  const safeAmount = Number.isInteger(amountCents) ? amountCents : 0;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(safeAmount / 100);
}

function formatHourlyRateFromCents(amountCents, hoursBase) {
  const safeAmount = Number.isInteger(amountCents) ? amountCents : 0;
  const safeHoursBase = Number(hoursBase);
  if (!Number.isFinite(safeHoursBase) || safeHoursBase <= 0) {
    return "";
  }
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeAmount / 100 / safeHoursBase)} EUR/h`;
}

function parseCurrencyToCents(value) {
  if (typeof value !== "string") {
    return { valid: false, cents: null };
  }
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return { valid: true, cents: null };
  }
  const normalizedValue = trimmedValue.replace(/\s+/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedValue)) {
    return { valid: false, cents: null };
  }
  const amount = Number(normalizedValue);
  if (!Number.isFinite(amount) || amount < 0) {
    return { valid: false, cents: null };
  }
  return {
    valid: true,
    cents: Math.round(amount * 100),
  };
}

function getPayPeriodMonthForDate(dateString) {
  if (typeof dateString !== "string" || !DATE_REGEX.test(dateString)) {
    return "";
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return "";
  }
  if (day >= 15) {
    parsed.setMonth(parsed.getMonth() + 1);
  }
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}`;
}

function getCurrentMonth() {
  return getPayPeriodMonthForDate(formatDate(new Date()));
}

function normalizeMonth(month) {
  if (typeof month === "string" && MONTH_REGEX.test(month)) {
    return month;
  }
  return getCurrentMonth();
}

function normalizeClientId(value) {
  const parsedValue = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

async function getClientSelection(username, requestedClientId) {
  const clients = await db.getAllClients(username);
  if (clients.length === 0) {
    return {
      clients,
      selectedClient: null,
    };
  }

  const normalizedRequestedClientId = normalizeClientId(requestedClientId);
  const selectedClient =
    clients.find((client) => client.id === normalizedRequestedClientId) || clients[0];

  return {
    clients,
    selectedClient,
  };
}

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_REGEX.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

function isValidTime(value) {
  return typeof value === "string" && TIME_REGEX.test(value);
}

function toMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutesToHHMM(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

async function getUserSettings(username) {
  const storedSettings = await db.getSettings(username);
  return normalizeSettings(mergeSettings(DEFAULT_SETTINGS, storedSettings));
}

async function saveUserSettings(username, input) {
  const nextSettings = normalizeSettingsPatch(input);
  await db.upsertSettings(username, nextSettings);
  return getUserSettings(username);
}

async function resetUserSettings(username) {
  await db.resetSettings(username);
  return normalizeSettings(DEFAULT_SETTINGS);
}

function getOvertimeMinutes(workedMinutes) {
  return Math.max(0, workedMinutes - DAILY_TARGET_MINUTES);
}

function getRecoveryMinutes(workedMinutes) {
  return Math.max(0, DAILY_TARGET_MINUTES - workedMinutes);
}

function escapeCsvValue(value) {
  const stringValue = normalizeCsvCell(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function normalizeExportText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCsvCell(value) {
  return String(value ?? "")
    .replace(/TÃ©lÃ©travail/g, "Télétravail")
    .replace(/CongÃ©s/g, "Congés")
    .replace(/ArrÃªt/g, "Arrêt")
    .replace(/FÃ©riÃ©/g, "Férié")
    .replace(/PÃ©riode/g, "Période")
    .replace(/journÃ©e/g, "journée")
    .replace(/journÃ©es/g, "journées")
    .replace(/travaillÃ©s/g, "travaillés")
    .replace(/ArrivÃ©e/g, "Arrivée")
    .replace(/DÃ©part/g, "Départ");
}

function encodeCsvForExcel(lines) {
  const csvText = `\uFEFF${lines.join("\r\n")}`;
  return Buffer.from(csvText, "utf16le");
}

function getMonthBounds(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const startDate = new Date(year, monthNumber - 2, 15);
  const endDate = new Date(year, monthNumber - 1, 15);
  const inclusiveEndDate = new Date(year, monthNumber - 1, 14);
  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    inclusiveEndDate: formatDate(inclusiveEndDate),
  };
}

function formatPayPeriodLabelFr(startDate, endDate) {
  const startLabel = formatDateShortFr(startDate);
  const endLabel = formatDateShortFr(endDate);
  if (!startLabel && !endLabel) {
    return "";
  }
  return `Du ${startLabel} au ${endLabel}`;
}

function getWeekStartMonday(dateString) {
  if (typeof dateString !== "string" || !DATE_REGEX.test(dateString)) {
    return "";
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return "";
  }
  const dayOfWeek = parsed.getDay();
  const diffToMonday = (dayOfWeek + 6) % 7;
  parsed.setDate(parsed.getDate() - diffToMonday);
  return formatDate(parsed);
}

function getISOWeekNumber(dateString) {
  if (typeof dateString !== "string" || !DATE_REGEX.test(dateString)) {
    return null;
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  const dayOfWeek = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(parsed.getUTCFullYear(), 0, 1));
  const diffDays = Math.floor((parsed - yearStart) / 86400000) + 1;
  return Math.ceil(diffDays / 7);
}

function formatWeekSummaryLabelFr(startDate, endDate, weekNumber) {
  const startLabel = formatDateDayMonthFr(startDate);
  const endLabel = formatDateDayMonthFr(endDate);
  const rangeLabel =
    startLabel && endLabel
      ? `du ${startLabel} au ${endLabel}`
      : startLabel || endLabel || "";
  const weekLabel = Number.isInteger(weekNumber) ? `semaine ${weekNumber}` : "";
  if (rangeLabel && weekLabel) {
    return `${rangeLabel} - ${weekLabel}`;
  }
  return rangeLabel || weekLabel;
}

function getYearToDateBounds(endDateExclusive) {
  const [year] = endDateExclusive.split("-").map(Number);
  return {
    startDate: `${year}-01-01`,
    endDate: endDateExclusive,
  };
}

function getEmptyMonthData(month) {
  const normalizedMonth = normalizeMonth(month);
  const { startDate, inclusiveEndDate } = getMonthBounds(normalizedMonth);
  return {
    entries: [],
    displayEntries: [],
    payPeriodStartDate: startDate,
    payPeriodEndDate: inclusiveEndDate,
    payPeriodLabel: formatPayPeriodLabelFr(startDate, inclusiveEndDate),
    salaryAmountCents: null,
    workedDayCount: 0,
    dayTypeCounts: Object.fromEntries(DAY_TYPE_OPTIONS.map((option) => [option.value, 0])),
    yearEntryCount: 0,
    yearDayTypeCounts: Object.fromEntries(DAY_TYPE_OPTIONS.map((option) => [option.value, 0])),
    totalMinutes: 0,
    totalHHMM: "00:00",
    totalOvertimeHHMM: "00:00",
    totalRecoveredHHMM: "00:00",
  };
}

async function getMonthData(username, clientId, month) {
  if (!clientId) {
    return getEmptyMonthData(month);
  }

  const normalizedMonth = normalizeMonth(month);
  const { startDate, endDate, inclusiveEndDate } = getMonthBounds(normalizedMonth);
  const salaryAmountCents = await db.getPayPeriodSalary(username, clientId, normalizedMonth);
  const yearToDateBounds = getYearToDateBounds(endDate);
  let runningBalanceMinutes = 0;
  const baseEntries = (await db.getWorkEntriesByClient(username, clientId, startDate, endDate)).map((entry) => {
      const dayType = normalizeDayType(entry.day_type) || DEFAULT_DAY_TYPE;
      const targetMinutes = getTargetMinutesForDayType(dayType);
      const overtimeMinutes = Math.max(0, entry.worked_minutes - targetMinutes);
      const missingMinutes = Math.max(0, targetMinutes - entry.worked_minutes);
      const recoveredMinutes = Math.min(Math.max(0, runningBalanceMinutes), missingMinutes);

      runningBalanceMinutes += entry.worked_minutes - targetMinutes;

      return {
        ...entry,
        day_type: dayType,
        day_type_display: getDayTypeConfig(dayType).label,
        target_minutes: targetMinutes,
        is_worked_day: isWorkedDayType(dayType),
        week_start: getWeekStartMonday(entry.work_date),
        work_date_display: formatDateDisplayFr(entry.work_date),
        arrival_time_display: isWorkedDayType(dayType) ? entry.arrival_time : "",
        departure_time_display: isWorkedDayType(dayType) ? entry.departure_time : "",
        lunch_break_minutes_display: isWorkedDayType(dayType) ? entry.lunch_break_minutes : "",
        worked_hhmm: formatMinutesToHHMM(entry.worked_minutes),
        overtime_minutes: overtimeMinutes,
        overtime_hhmm: formatMinutesToHHMM(overtimeMinutes),
        recovered_minutes: recoveredMinutes,
        recovered_hhmm: formatMinutesToHHMM(recoveredMinutes),
        under_target: entry.worked_minutes < targetMinutes,
      };
    });
  const weekStarts = [...new Set(baseEntries.map((entry) => entry.week_start).filter(Boolean))];
  const weekClassByStart = new Map(
    weekStarts.map((weekStart, index) => [weekStart, `week-${(index % 4) + 1}`])
  );
  const entries = baseEntries.map((entry) => ({
    ...entry,
    week_color_class: weekClassByStart.get(entry.week_start) || "",
  }));
  const displayEntries = [];
  let weekTotalMinutes = 0;
  let weekRecoveredMinutes = 0;
  let weekTargetMinutes = 0;
  let weekFirstWorkDate = "";
  let weekLastWorkDate = "";

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const nextEntry = entries[index + 1];
    if (!weekFirstWorkDate) {
      weekFirstWorkDate = entry.work_date;
    }
    weekLastWorkDate = entry.work_date;
    weekTotalMinutes += entry.worked_minutes;
    weekRecoveredMinutes += entry.recovered_minutes;
    weekTargetMinutes += entry.target_minutes;
    displayEntries.push(entry);

    if (!nextEntry || nextEntry.week_start !== entry.week_start) {
      const weekOvertimeMinutes = Math.max(0, weekTotalMinutes - weekTargetMinutes);
      const weekNumber = getISOWeekNumber(entry.week_start || weekFirstWorkDate);
      displayEntries.push({
        is_week_total: true,
        week_start: entry.week_start,
        week_color_class: entry.week_color_class,
        week_total_hhmm: formatMinutesToHHMM(weekTotalMinutes),
        week_total_overtime_hhmm: formatMinutesToHHMM(weekOvertimeMinutes),
        week_total_recovered_hhmm: formatMinutesToHHMM(weekRecoveredMinutes),
        week_summary_label: formatWeekSummaryLabelFr(
          weekFirstWorkDate,
          weekLastWorkDate,
          weekNumber
        ),
      });
      weekTotalMinutes = 0;
      weekRecoveredMinutes = 0;
      weekTargetMinutes = 0;
      weekFirstWorkDate = "";
      weekLastWorkDate = "";
    }
  }

  const totalMinutes = entries.reduce((sum, entry) => sum + entry.worked_minutes, 0);
  const monthlyTargetMinutes = entries.reduce((sum, entry) => sum + entry.target_minutes, 0);
  const totalOvertimeMinutes = Math.max(0, totalMinutes - monthlyTargetMinutes);
  const totalRecoveredMinutes = entries.reduce((sum, entry) => sum + entry.recovered_minutes, 0);
  const workedDayCount = entries.reduce(
    (sum, entry) => sum + (entry.is_worked_day ? 1 : 0),
    0
  );
  const dayTypeCounts = Object.fromEntries(
    DAY_TYPE_OPTIONS.map((option) => [
      option.value,
      entries.reduce((sum, entry) => sum + (entry.day_type === option.value ? 1 : 0), 0),
    ])
  );
  const yearEntries = (
    await db.getWorkEntriesByClient(
      username,
      clientId,
      yearToDateBounds.startDate,
      yearToDateBounds.endDate
    )
  ).map((entry) => normalizeDayType(entry.day_type) || DEFAULT_DAY_TYPE);
  const yearDayTypeCounts = Object.fromEntries(
    DAY_TYPE_OPTIONS.map((option) => [
      option.value,
      yearEntries.reduce((sum, dayType) => sum + (dayType === option.value ? 1 : 0), 0),
    ])
  );
  return {
    entries,
    displayEntries,
    payPeriodStartDate: startDate,
    payPeriodEndDate: inclusiveEndDate,
    payPeriodLabel: formatPayPeriodLabelFr(startDate, inclusiveEndDate),
    salaryAmountCents,
    workedDayCount,
    dayTypeCounts,
    yearEntryCount: yearEntries.length,
    yearDayTypeCounts,
    totalMinutes,
    totalHHMM: formatMinutesToHHMM(totalMinutes),
    totalOvertimeHHMM: formatMinutesToHHMM(totalOvertimeMinutes),
    totalRecoveredHHMM: formatMinutesToHHMM(totalRecoveredMinutes),
  };
}

function formatHistoryEntry(entry) {
  const dayType = normalizeDayType(entry.day_type) || DEFAULT_DAY_TYPE;
  const targetMinutes = getTargetMinutesForDayType(dayType);
  const overtimeMinutes = Math.max(0, entry.worked_minutes - targetMinutes);
  return {
    ...entry,
    day_type: dayType,
    day_type_display: getDayTypeConfig(dayType).label,
    work_date_display: formatDateDisplayFr(entry.work_date),
    arrival_time_display: isWorkedDayType(dayType) ? entry.arrival_time : "",
    departure_time_display: isWorkedDayType(dayType) ? entry.departure_time : "",
    lunch_break_minutes_display: isWorkedDayType(dayType) ? entry.lunch_break_minutes : "",
    worked_hhmm: formatMinutesToHHMM(entry.worked_minutes),
    overtime_hhmm: formatMinutesToHHMM(overtimeMinutes),
  };
}

async function getArchivedClientHistory(username) {
  const archivedClients = await db.getArchivedClients(username);
  return Promise.all(archivedClients.map(async (client) => {
    const entries = (await db.getWorkEntriesByClient(username, client.id)).map(formatHistoryEntry);
    const totalMinutes = entries.reduce((sum, entry) => sum + entry.worked_minutes, 0);
    return {
      ...client,
      archived_at_display: formatDateTimeDisplayFr(client.archived_at),
      entries,
      entry_count: entries.length,
      total_hhmm: formatMinutesToHHMM(totalMinutes),
    };
  }));
}

async function getExportClient(username, requestedClientId) {
  const normalizedClientId = normalizeClientId(requestedClientId);
  if (normalizedClientId) {
    return await db.getClientById(username, normalizedClientId);
  }
  const { selectedClient } = await getClientSelection(username, requestedClientId);
  return selectedClient;
}

function getEntryStatusLabel(entry) {
  if (!entry.is_worked_day) {
    return entry.day_type_display;
  }
  if (entry.recovered_minutes > 0) {
    return `Recup ${entry.recovered_hhmm}`;
  }
  if (entry.under_target) {
    return "Moins de 7h";
  }
  return "OK";
}

function getCsvDayTypeLabel(dayType) {
  switch (dayType) {
    case "office":
      return "Bureau";
    case "remote":
      return "T\u00e9l\u00e9travail";
    case "leave":
      return "Cong\u00e9s";
    case "rtt":
      return "RTT";
    case "sick_leave":
      return "Arr\u00eat";
    case "holiday":
      return "F\u00e9ri\u00e9";
    default:
      return "";
  }
}

function getCsvHistoryStatusLabel(entry) {
  if (!entry.is_worked_day) {
    return getCsvDayTypeLabel(entry.day_type) || entry.day_type_display;
  }
  if (entry.recovered_minutes > 0) {
    return `Recup ${entry.recovered_hhmm}`;
  }
  if (entry.under_target) {
    return "Moins de 7h";
  }
  return "OK";
}

function buildPeriodExportLines(monthData) {
  const header = [
    "Date",
    "Type",
    "Arriv\u00e9e",
    "D\u00e9part",
    "Pause (min)",
    "Heures du jour",
    "Heures sup",
    "Heures recup",
    "Etat",
    "Commentaire",
  ];

  const lines = ["sep=;", header.map(escapeCsvValue).join(CSV_SEPARATOR)];

  for (const entry of monthData.displayEntries) {
    if (entry.is_week_total) {
      lines.push(
        [
          "Total semaine",
          "",
          "",
          "",
          "",
          entry.week_total_hhmm || "",
          entry.week_total_overtime_hhmm || "",
          entry.week_total_recovered_hhmm || "",
          "",
          entry.week_summary_label || "",
        ]
          .map(escapeCsvValue)
          .join(CSV_SEPARATOR)
      );
      continue;
    }

    lines.push(
      [
        entry.work_date_display || entry.work_date,
        getCsvDayTypeLabel(entry.day_type) || entry.day_type_display,
        entry.arrival_time_display,
        entry.departure_time_display,
        entry.lunch_break_minutes_display,
        entry.worked_hhmm,
        entry.overtime_hhmm,
        entry.recovered_minutes > 0 ? entry.recovered_hhmm : "",
        getCsvHistoryStatusLabel(entry),
        normalizeExportText(entry.comment_text),
      ]
        .map(escapeCsvValue)
        .join(CSV_SEPARATOR)
    );
  }

  lines.push("");
  lines.push(
    [escapeCsvValue("P\u00e9riode"), escapeCsvValue(monthData.payPeriodLabel || "")].join(CSV_SEPARATOR)
  );
  lines.push(
    [escapeCsvValue("Jours travaill\u00e9s"), escapeCsvValue(String(monthData.workedDayCount))].join(
      CSV_SEPARATOR
    )
  );
  lines.push("");
  lines.push([escapeCsvValue("Types de journ\u00e9e"), escapeCsvValue("Nombre")].join(CSV_SEPARATOR));
  for (const option of DAY_TYPE_OPTIONS) {
    lines.push(
      [
        escapeCsvValue(getCsvDayTypeLabel(option.value) || getCanonicalDayTypeLabel(option.value, option.label)),
        escapeCsvValue(String(monthData.dayTypeCounts[option.value] || 0)),
      ].join(CSV_SEPARATOR)
    );
  }
  lines.push("");
  lines.push(
    [escapeCsvValue("Total p\u00e9riode"), escapeCsvValue(monthData.totalHHMM)].join(CSV_SEPARATOR)
  );
  lines.push(
    [escapeCsvValue("Total heures sup"), escapeCsvValue(monthData.totalOvertimeHHMM)].join(
      CSV_SEPARATOR
    )
  );
  lines.push(
    [escapeCsvValue("Total heures recup"), escapeCsvValue(monthData.totalRecoveredHHMM)].join(
      CSV_SEPARATOR
    )
  );
  lines.push([
    escapeCsvValue("Salaire net"),
    escapeCsvValue(
      monthData.salaryAmountCents === null
        ? "Non renseigne"
        : formatCurrencyFromCents(monthData.salaryAmountCents)
    ),
  ].join(CSV_SEPARATOR));

  return lines;
}

function buildHistoryExportLines(client, entries) {
  const header = [
    "Date",
    "Type",
    "Arriv\u00e9e",
    "D\u00e9part",
    "Pause (min)",
    "Heures",
    "Heures sup",
    "Commentaire",
  ];

  const totalMinutes = entries.reduce((sum, entry) => sum + entry.worked_minutes, 0);
  const lines = ["sep=;", header.map(escapeCsvValue).join(CSV_SEPARATOR)];

  for (const entry of entries) {
    lines.push(
      [
        entry.work_date_display || entry.work_date,
        getCsvDayTypeLabel(entry.day_type) || entry.day_type_display,
        entry.arrival_time_display,
        entry.departure_time_display,
        entry.lunch_break_minutes_display,
        entry.worked_hhmm,
        entry.overtime_hhmm,
        normalizeExportText(entry.comment_text),
      ]
        .map(escapeCsvValue)
        .join(CSV_SEPARATOR)
    );
  }

  lines.push("");
  lines.push([escapeCsvValue("Client"), escapeCsvValue(client.company_name)].join(CSV_SEPARATOR));
  if (client.archived_at) {
    lines.push([
      escapeCsvValue("Archiv\u00e9 le"),
      escapeCsvValue(formatDateTimeDisplayFr(client.archived_at) || client.archived_at),
    ].join(CSV_SEPARATOR));
  }
  lines.push([
    escapeCsvValue("Nombre de journ\u00e9es"),
    escapeCsvValue(String(entries.length)),
  ].join(CSV_SEPARATOR));
  lines.push([
    escapeCsvValue("Total heures"),
    escapeCsvValue(formatMinutesToHHMM(totalMinutes)),
  ].join(CSV_SEPARATOR));

  return lines;
}

async function renderIndex(res, options = {}) {
  const username = options.username || res.locals.authUser || "";
  const userSettings = await getUserSettings(username);
  const month = normalizeMonth(options.month);
  const { clients, selectedClient } = await getClientSelection(username, options.clientId);
  const archivedClients = await getArchivedClientHistory(username);
  const {
    entries,
    displayEntries,
    payPeriodStartDate,
    payPeriodEndDate,
    payPeriodLabel,
    salaryAmountCents,
    workedDayCount,
    dayTypeCounts,
    yearEntryCount,
    yearDayTypeCounts,
    totalMinutes,
    totalHHMM,
    totalOvertimeHHMM,
    totalRecoveredHHMM,
  } = await getMonthData(username, selectedClient ? selectedClient.id : null, month);

  const defaultFormData = {
    date: formatDate(new Date()),
    dayType: DEFAULT_DAY_TYPE,
    arrivalTime: userSettings.defaultStartTime,
    departureTime: userSettings.defaultEndTime,
    lunchBreakMinutes: userSettings.defaultPause,
    commentText: "",
    originalWorkDate: "",
  };
  const editDate = isValidDate(options.editDate) ? options.editDate : "";
  const entryToEdit = editDate ? entries.find((entry) => entry.work_date === editDate) : null;
  const editFormData = entryToEdit
    ? {
        date: entryToEdit.work_date,
        dayType: entryToEdit.day_type,
        arrivalTime: entryToEdit.arrival_time,
        departureTime: entryToEdit.departure_time,
        lunchBreakMinutes: entryToEdit.lunch_break_minutes,
        commentText: entryToEdit.comment_text || "",
        originalWorkDate: entryToEdit.work_date,
      }
    : {};
  const mergedFormData = { ...defaultFormData, ...editFormData, ...(options.formData || {}) };
  const editingWorkDate = isValidDate(mergedFormData.originalWorkDate)
    ? mergedFormData.originalWorkDate
    : "";

  res.render("index", {
    clients,
    archivedClients,
    selectedClient,
    selectedMonth: month,
    defaultEntryFormData: defaultFormData,
    entries,
    displayEntries,
    payPeriodStartDate,
    payPeriodEndDate,
    payPeriodLabel,
    salaryAmountDisplay:
      salaryAmountCents === null ? "Non renseigne" : formatCurrencyFromCents(salaryAmountCents),
    hourlyRateDisplay:
      salaryAmountCents === null || totalMinutes <= 0
        ? ""
        : formatHourlyRateFromCents(salaryAmountCents, totalMinutes / 60),
    salaryAmountInput:
      typeof options.salaryAmountInput === "string"
        ? options.salaryAmountInput
        : salaryAmountCents === null
          ? ""
          : (salaryAmountCents / 100).toFixed(2),
    workedDayCount,
    dayTypeFilters: DAY_TYPE_FILTERS.map((filter) => ({
      ...filter,
      label:
        filter.value === "all"
          ? "Tous"
          : getCanonicalDayTypeLabel(filter.value, normalizeDisplayLabel(filter.label)),
      count: filter.value === "all" ? entries.length : dayTypeCounts[filter.value] || 0,
      yearCount: filter.value === "all" ? yearEntryCount : yearDayTypeCounts[filter.value] || 0,
    })),
    dayTypeCounts,
    totalMinutes,
    totalHHMM,
    totalOvertimeHHMM,
    totalRecoveredHHMM,
    userSettings,
    settingsDefaults: DEFAULT_SETTINGS,
    error: options.error || "",
    clientError: options.clientError || "",
    clientFormData: options.clientFormData || {
      company_name: "",
      contact_name: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
      company_logo: "",
    },
    showClientModal: Boolean(options.showClientModal),
    showClientInfoModal: Boolean(options.showClientInfoModal),
    formData: mergedFormData,
    dayTypeOptions: DAY_TYPE_OPTIONS.map((option) => ({
      ...option,
      label: getCanonicalDayTypeLabel(option.value, normalizeDisplayLabel(option.label)),
    })),
    showReplaceConfirmation: Boolean(options.showReplaceConfirmation),
    showSalaryEditor: Boolean(options.showSalaryEditor),
    isEditing: Boolean(editingWorkDate),
    editingWorkDate,
    authUser: res.locals.authUser || "",
    csrfToken: res.locals.csrfToken || "",
  });
}

function renderLogin(res, options = {}) {
  res.render("login", {
    error: options.error || "",
    success: options.success || "",
    formData: options.formData || { username: "" },
    csrfToken: res.locals.csrfToken || "",
  });
}

function renderRegister(res, options = {}) {
  res.render("register", {
    error: options.error || "",
    success: options.success || "",
    recoveryCode: options.recoveryCode || "",
    formData: options.formData || { username: "", recoveryCode: "" },
    csrfToken: res.locals.csrfToken || "",
  });
}

function renderForgotPassword(res, options = {}) {
  res.render("forgot-password", {
    error: options.error || "",
    success: options.success || "",
    recoveryCode: options.recoveryCode || "",
    formData: options.formData || { username: "" },
    csrfToken: res.locals.csrfToken || "",
  });
}

app.use(async (req, res, next) => {
  try {
    const session = await getSessionFromRequest(req);
    if (session) {
      req.authUser = session.username;
      req.authSessionToken = session.token;
      res.locals.authUser = session.username;
    }
    next();
  } catch (error) {
    next(error);
  }
});

app.use(requireCsrf);

function requireAuth(req, res, next) {
  if (!req.authUser) {
    return res.redirect("/login");
  }
  return next();
}

async function renderCsrfFailure(req, res) {
  const message = buildSecurityErrorMessage("Action");
  const statusCode = 403;
  if (req.path === "/login") {
    res.status(statusCode);
    renderLogin(res, {
      error: message,
      formData: { username: typeof req.body?.username === "string" ? req.body.username.trim() : "" },
    });
    return;
  }
  if (req.path === "/register") {
    res.status(statusCode);
    renderRegister(res, {
      error: message,
      formData: {
        username: typeof req.body?.username === "string" ? req.body.username.trim() : "",
        recoveryCode: normalizeRecoveryCode(req.body?.recoveryCode),
      },
    });
    return;
  }
  if (req.path === "/forgot-password") {
    res.status(statusCode);
    renderForgotPassword(res, {
      error: message,
      formData: { username: typeof req.body?.username === "string" ? req.body.username.trim() : "" },
    });
    return;
  }
  if (req.authUser) {
    res.status(statusCode);
    await renderIndex(res, {
      username: req.authUser,
      month: req.body?.selectedMonth || req.query?.month,
      clientId: req.body?.clientId || req.query?.clientId,
      editDate: req.body?.originalWorkDate || req.query?.editDate,
      error: message,
    });
    return;
  }
  return res.status(statusCode).send(message);
}

async function requireCsrf(req, res, next) {
  if (req.method !== "POST") {
    return next();
  }
  const cookieToken = getCsrfTokenFromRequest(req);
  const bodyToken = typeof req.body?._csrf === "string" ? req.body._csrf.trim() : "";
  if (!cookieToken || !bodyToken || !safeEqualString(cookieToken, bodyToken)) {
    logSecurityEvent("csrf_validation_failed", {
      path: req.path,
      ip: getRequestIp(req),
      username: req.authUser || (typeof req.body?.username === "string" ? req.body.username.trim() : ""),
    });
    await renderCsrfFailure(req, res);
    return;
  }
  return next();
}

function createRateLimitMiddleware(actionKey, actionLabel, options) {
  const { maxAttempts, windowMs } = options;
  return (req, res, next) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const rateKey = `${actionKey}:${getRequestIp(req)}:${username.toLowerCase()}`;
    const bucket = consumeRateLimitBucket(rateKey, maxAttempts, windowMs);
    if (bucket.allowed) {
      return next();
    }
    logSecurityEvent("rate_limit_reached", {
      action: actionKey,
      ip: getRequestIp(req),
      username,
      path: req.path,
    });
    const message = `Trop de tentatives pour ${actionLabel}. Réessayez dans quelques minutes.`;
    res.status(429);
    if (actionKey === "login") {
      return renderLogin(res, {
        error: message,
        formData: { username },
      });
    }
    if (actionKey === "register") {
      return renderRegister(res, {
        error: message,
        formData: {
          username,
          recoveryCode: normalizeRecoveryCode(req.body?.recoveryCode),
        },
      });
    }
    return renderForgotPassword(res, {
      error: message,
      formData: { username },
    });
  };
}

app.get("/login", (req, res) => {
  if (req.authUser) {
    return res.redirect("/");
  }
  const username = typeof req.query.username === "string" ? req.query.username.trim() : "";
  const success =
    req.query.registered === "1"
      ? "Compte cree avec succes. Vous pouvez maintenant vous connecter."
      : "";
  return renderLogin(res, {
    success,
    formData: { username },
  });
});

app.post("/login", createRateLimitMiddleware("login", "la connexion", AUTH_RATE_LIMITS.login), async (req, res) => {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!username || !password) {
    return renderLogin(res, {
      error: "Renseignez votre identifiant et votre mot de passe.",
      formData: { username },
    });
  }

  const user = await db.getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    logSecurityEvent("login_failed", {
      username,
      ip: getRequestIp(req),
      path: req.path,
    });
    return renderLogin(res, {
      error: "Connexion impossible avec les informations fournies.",
      formData: { username },
    });
  }

  const token = await createSession(username);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_MS,
  });
  setCsrfCookie(res, generateCsrfToken());

  return res.redirect("/");
});

app.get("/register", (req, res) => {
  if (req.authUser) {
    return res.redirect("/");
  }
  return renderRegister(res);
});

app.post("/register", createRateLimitMiddleware("register", "l'inscription", AUTH_RATE_LIMITS.register), async (req, res) => {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const recoveryCode = normalizeRecoveryCode(req.body.recoveryCode);

  if (!isValidUsername(username)) {
    return renderRegister(res, {
      error: "Le nom utilisateur doit contenir 3 a 32 caracteres (lettres, chiffres, . _ -).",
      formData: { username, recoveryCode },
    });
  }

  if (!isValidPassword(password)) {
    return renderRegister(res, {
      error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caracteres.`,
      formData: { username, recoveryCode },
    });
  }

  if (!isValidRecoveryCode(recoveryCode)) {
    return renderRegister(res, {
      error: "Le code de recuperation doit contenir exactement 6 chiffres.",
      formData: { username, recoveryCode },
    });
  }

  const existingUser = await db.getUserByUsername(username);
  if (existingUser) {
    logSecurityEvent("register_rejected", {
      username,
      ip: getRequestIp(req),
      path: req.path,
      reason: "existing_or_unavailable",
    });
    return renderRegister(res, {
      error: "Inscription impossible avec les informations fournies.",
      formData: { username, recoveryCode },
    });
  }

  const { saltHex, hashHex } = hashPassword(password);
  const { saltHex: recoverySaltHex, hashHex: recoveryHashHex } = hashPassword(recoveryCode);
  try {
    await db.createUser({
      username,
      password_salt: saltHex,
      password_hash: hashHex,
      recovery_code_salt: recoverySaltHex,
      recovery_code_hash: recoveryHashHex,
    });
    await db.ensureUserDatabase(username);
  } catch (error) {
    if (isDuplicateUsernameError(error)) {
      logSecurityEvent("register_rejected", {
        username,
        ip: getRequestIp(req),
        path: req.path,
        reason: "duplicate_or_unavailable",
      });
      return renderRegister(res, {
        error: "Inscription impossible avec les informations fournies.",
        formData: { username, recoveryCode },
      });
    }
    throw error;
  }
  return res.redirect(`/login?registered=1&username=${encodeURIComponent(username)}`);
});

app.get("/forgot-password", (req, res) => {
  if (req.authUser) {
    return res.redirect("/");
  }
  const username = typeof req.query.username === "string" ? req.query.username.trim() : "";
  return renderForgotPassword(res, {
    formData: { username },
  });
});

app.post("/forgot-password", createRateLimitMiddleware("forgotPassword", "la réinitialisation", AUTH_RATE_LIMITS.forgotPassword), async (req, res) => {
  if (req.authUser) {
    return res.redirect("/");
  }

  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const recoveryCode = normalizeRecoveryCode(req.body.recoveryCode);
  const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";
  const confirmPassword = typeof req.body.confirmPassword === "string" ? req.body.confirmPassword : "";
  logSecurityEvent("password_reset_requested", {
    username,
    ip: getRequestIp(req),
    path: req.path,
  });

  if (!username || !recoveryCode || !newPassword || !confirmPassword) {
    return renderForgotPassword(res, {
      error: "Tous les champs sont obligatoires.",
      formData: { username },
    });
  }

  if (!isValidPassword(newPassword)) {
    return renderForgotPassword(res, {
      error: `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caracteres.`,
      formData: { username },
    });
  }

  if (newPassword !== confirmPassword) {
    return renderForgotPassword(res, {
      error: "La confirmation du nouveau mot de passe ne correspond pas.",
      formData: { username },
    });
  }

  const user = await db.getUserByUsername(username);
  const hasRecoveryCode =
    user &&
    typeof user.recovery_code_salt === "string" &&
    user.recovery_code_salt &&
    typeof user.recovery_code_hash === "string" &&
    user.recovery_code_hash;
  if (
    !hasRecoveryCode ||
    !verifyPassword(recoveryCode, user.recovery_code_salt, user.recovery_code_hash)
  ) {
    return renderForgotPassword(res, {
      error: "Réinitialisation impossible avec les informations fournies.",
      formData: { username },
    });
  }

  const { saltHex, hashHex } = hashPassword(newPassword);
  const nextRecoveryCode = generateRecoveryCode();
  const {
    saltHex: nextRecoverySaltHex,
    hashHex: nextRecoveryHashHex,
  } = hashPassword(nextRecoveryCode);

  await db.updateUserPasswordAndRecoveryCode({
    username,
    password_salt: saltHex,
    password_hash: hashHex,
    recovery_code_salt: nextRecoverySaltHex,
    recovery_code_hash: nextRecoveryHashHex,
  });

  return renderForgotPassword(res, {
    success: "Mot de passe reinitialise. Conservez votre nouveau code de recuperation.",
    recoveryCode: nextRecoveryCode,
    formData: { username },
  });
});

app.post("/logout", async (req, res) => {
  if (req.authSessionToken) {
    await db.deleteSession(req.authSessionToken);
  }
  clearSessionCookie(res);
  setCsrfCookie(res, generateCsrfToken());
  return res.redirect("/login");
});

app.use(requireAuth);

app.get("/", async (req, res) => {
  await renderIndex(res, {
    username: req.authUser,
    month: req.query.month,
    clientId: req.query.clientId,
    editDate: req.query.editDate,
  });
});

app.get("/api/entries/by-date", async (req, res) => {
  const clientId = normalizeClientId(req.query.clientId);
  const workDate = typeof req.query.date === "string" ? req.query.date.trim() : "";

  if (!clientId || !isValidDate(workDate)) {
    return res.status(400).json({ error: "Parametres invalides." });
  }

  const client = await db.getClientById(req.authUser, clientId);
  if (!client) {
    return res.status(404).json({ error: "Client introuvable." });
  }

  const entry = await db.getWorkEntryByDate(req.authUser, client.id, workDate);
  if (!entry) {
    return res.json({ entry: null });
  }

  return res.json({
    entry: {
      workDate: entry.work_date,
      dayType: normalizeDayType(entry.day_type) || DEFAULT_DAY_TYPE,
      arrivalTime: isWorkedDayType(entry.day_type) ? entry.arrival_time || "" : "",
      departureTime: isWorkedDayType(entry.day_type) ? entry.departure_time || "" : "",
      lunchBreakMinutes:
        isWorkedDayType(entry.day_type) &&
        (Number.isInteger(entry.lunch_break_minutes) || typeof entry.lunch_break_minutes === "number")
          ? String(entry.lunch_break_minutes)
          : "",
      commentText: entry.comment_text || "",
    },
  });
});

app.get("/api/settings", async (req, res) => {
  return res.json({ settings: await getUserSettings(req.authUser) });
});

app.post("/api/settings", async (req, res) => {
  const input = req.body && typeof req.body === "object" ? req.body : {};
  const nextSettings = await saveUserSettings(req.authUser, input);
  return res.json({ settings: nextSettings });
});

app.post("/api/settings/reset", async (req, res) => {
  const nextSettings = await resetUserSettings(req.authUser);
  return res.json({ settings: nextSettings });
});

app.get("/entries/:workDate/edit", async (req, res) => {
  const workDate = req.params.workDate;
  const month = normalizeMonth(req.query.month || getPayPeriodMonthForDate(workDate));
  await renderIndex(res, {
    username: req.authUser,
    month,
    clientId: req.query.clientId,
    editDate: workDate,
  });
});

app.post("/clients", async (req, res) => {
  const month = normalizeMonth(req.body.selectedMonth);
  const clientFormData = {
    company_name: typeof req.body.company_name === "string" ? req.body.company_name.trim() : "",
    contact_name: typeof req.body.contact_name === "string" ? req.body.contact_name.trim() : "",
    email: typeof req.body.email === "string" ? req.body.email.trim() : "",
    phone: typeof req.body.phone === "string" ? req.body.phone.trim() : "",
    address: typeof req.body.address === "string" ? req.body.address.trim() : "",
    notes: typeof req.body.notes === "string" ? req.body.notes.trim() : "",
    company_logo: typeof req.body.company_logo === "string" ? req.body.company_logo.trim() : "",
  };

  if (!clientFormData.company_name) {
    return renderIndex(res, {
      username: req.authUser,
      month,
      clientError: "Le nom de l'entreprise est obligatoire.",
      clientFormData,
      showClientModal: true,
    });
  }

  const hasOversizedField = Object.values(clientFormData).some(
    (value, index) => (index === 6 ? value.length > MAX_CLIENT_LOGO_LENGTH : value.length > MAX_CLIENT_FIELD_LENGTH)
  );
  if (hasOversizedField) {
    return renderIndex(res, {
      username: req.authUser,
      month,
      clientError: `Les champs client sont trop volumineux.`,
      clientFormData,
      showClientModal: true,
    });
  }

  const client = await db.createClient(req.authUser, clientFormData);
  return res.redirect(
    `/?month=${encodeURIComponent(month)}&clientId=${encodeURIComponent(client.id)}`
  );
});

app.post("/clients/:clientId/update", async (req, res) => {
  const month = normalizeMonth(req.body.selectedMonth);
  const clientId = normalizeClientId(req.params.clientId);
  const existingClient = clientId ? await db.getClientById(req.authUser, clientId) : null;
  const clientFormData = {
    company_name: typeof req.body.company_name === "string" ? req.body.company_name.trim() : "",
    contact_name: typeof req.body.contact_name === "string" ? req.body.contact_name.trim() : "",
    email: typeof req.body.email === "string" ? req.body.email.trim() : "",
    phone: typeof req.body.phone === "string" ? req.body.phone.trim() : "",
    address: typeof req.body.address === "string" ? req.body.address.trim() : "",
    notes: typeof req.body.notes === "string" ? req.body.notes.trim() : "",
    company_logo: typeof req.body.company_logo === "string" ? req.body.company_logo.trim() : "",
  };

  if (!existingClient) {
    return res.redirect(`/?month=${encodeURIComponent(month)}`);
  }

  if (!clientFormData.company_name) {
    return renderIndex(res, {
      username: req.authUser,
      month,
      clientId: existingClient.id,
      clientError: "Le nom de l'entreprise est obligatoire.",
      showClientInfoModal: true,
    });
  }

  const hasOversizedField = Object.values(clientFormData).some(
    (value, index) => (index === 6 ? value.length > MAX_CLIENT_LOGO_LENGTH : value.length > MAX_CLIENT_FIELD_LENGTH)
  );
  if (hasOversizedField) {
    return renderIndex(res, {
      username: req.authUser,
      month,
      clientId: existingClient.id,
      clientError: `Les champs client sont trop volumineux.`,
      showClientInfoModal: true,
    });
  }

  await db.updateClient(req.authUser, existingClient.id, clientFormData);
  return res.redirect(
    `/?month=${encodeURIComponent(month)}&clientId=${encodeURIComponent(existingClient.id)}`
  );
});

app.post("/clients/:clientId/archive", async (req, res) => {
  const month = normalizeMonth(req.body.selectedMonth);
  const clientId = normalizeClientId(req.params.clientId);
  const client = clientId ? await db.getClientById(req.authUser, clientId) : null;

  if (!client) {
    return res.redirect(`/?month=${encodeURIComponent(month)}`);
  }

  await db.archiveClient(req.authUser, client.id);
  const remainingClients = await db.getAllClients(req.authUser);

  if (remainingClients.length > 0) {
    return res.redirect(
      `/?month=${encodeURIComponent(month)}&clientId=${encodeURIComponent(remainingClients[0].id)}`
    );
  }

  return res.redirect(`/?month=${encodeURIComponent(month)}`);
});

app.post("/clients/:clientId/restore", async (req, res) => {
  const month = normalizeMonth(req.body.selectedMonth);
  const clientId = normalizeClientId(req.params.clientId);
  const client = clientId ? await db.getClientById(req.authUser, clientId) : null;

  if (!client) {
    return res.redirect(`/?month=${encodeURIComponent(month)}`);
  }

  await db.restoreClient(req.authUser, client.id);
  return res.redirect(
    `/?month=${encodeURIComponent(month)}&clientId=${encodeURIComponent(client.id)}`
  );
});

app.post("/clients/:clientId/delete", async (req, res) => {
  const month = normalizeMonth(req.body.selectedMonth);
  const clientId = normalizeClientId(req.params.clientId);
  const client = clientId ? await db.getClientById(req.authUser, clientId) : null;

  if (!client) {
    return res.redirect(`/?month=${encodeURIComponent(month)}`);
  }

  await db.deleteClient(req.authUser, client.id);
  const remainingClients = await db.getAllClients(req.authUser);

  if (remainingClients.length > 0) {
    return res.redirect(
      `/?month=${encodeURIComponent(month)}&clientId=${encodeURIComponent(remainingClients[0].id)}`
    );
  }

  return res.redirect(`/?month=${encodeURIComponent(month)}`);
});

app.get("/export.xlsx", async (req, res) => {
  const month = normalizeMonth(req.query.month);
  const exportMode = req.query.mode === "history" ? "history" : "period";
  const client = await getExportClient(req.authUser, req.query.clientId);
  if (!client) {
    return res.status(400).send("Aucun client selectionne.");
  }
  const workbook =
    exportMode === "history"
      ? await buildHistoryWorkbook({
          client,
          entries: (await db.getWorkEntriesByClient(req.authUser, client.id)).map(formatHistoryEntry),
        })
      : await buildPeriodWorkbook({
          client,
          monthData: await getMonthData(req.authUser, client.id, month),
        });
  const filename = buildExportFilename(
    client.company_name,
    exportMode === "history" ? "historique" : month,
    "xlsx"
  );

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const buffer = await workbook.xlsx.writeBuffer();
  res.send(Buffer.from(buffer));
});

app.get("/export.csv", async (req, res) => {
  const search = new URLSearchParams();
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      search.set(key, String(value));
    }
  });
  return res.redirect(`/export.xlsx?${search.toString()}`);
});

app.post("/pay-period-salary", async (req, res) => {
  const month = normalizeMonth(req.body.selectedMonth);
  const clientId = normalizeClientId(req.body.clientId);
  const salaryAmountInput = typeof req.body.salaryAmount === "string" ? req.body.salaryAmount.trim() : "";
  const parsedSalary = parseCurrencyToCents(salaryAmountInput);
  const client = clientId ? await db.getClientById(req.authUser, clientId) : null;

  if (!client) {
    return renderIndex(res, {
      username: req.authUser,
      month,
      clientId,
      error: "Selectionnez un client avant d'enregistrer un salaire.",
      salaryAmountInput,
      showSalaryEditor: true,
    });
  }

  if (!parsedSalary.valid) {
    return renderIndex(res, {
      username: req.authUser,
      month,
      clientId: client.id,
      error: "Le montant du salaire doit etre un nombre positif avec deux decimales maximum.",
      salaryAmountInput,
      showSalaryEditor: true,
    });
  }

  if (parsedSalary.cents === null) {
    await db.deletePayPeriodSalary(req.authUser, client.id, month);
  } else {
    await db.upsertPayPeriodSalary(req.authUser, {
      client_id: client.id,
      pay_period_month: month,
      salary_amount_cents: parsedSalary.cents,
    });
  }

  return res.redirect(
    `/?month=${encodeURIComponent(month)}&clientId=${encodeURIComponent(client.id)}`
  );
});

app.post("/entries", async (req, res) => {
  const {
    clientId,
    date,
    dayType,
    arrivalTime,
    departureTime,
    lunchBreakMinutes,
    commentText,
    selectedMonth,
    originalWorkDate,
    confirmReplace,
  } = req.body;
  const normalizedClientId = normalizeClientId(clientId);
  const client = normalizedClientId ? await db.getClientById(req.authUser, normalizedClientId) : null;
  const normalizedComment = typeof commentText === "string" ? commentText.trim() : "";
  const safeOriginalWorkDate = isValidDate(originalWorkDate) ? originalWorkDate : "";
  const normalizedDayType = normalizeDayType(dayType) || DEFAULT_DAY_TYPE;
  const isWorkedDay = isWorkedDayType(normalizedDayType);
  const month = normalizeMonth(selectedMonth || getPayPeriodMonthForDate(date));
  const entryMonth = normalizeMonth(getPayPeriodMonthForDate(date) || month);
  const errors = [];

  if (!client) {
    errors.push("Selectionnez un client avant d'enregistrer une journée.");
  }

  if (!isValidDate(date)) {
    errors.push("La date est invalide.");
  }

  if (isWorkedDay && !isValidTime(arrivalTime)) {
    errors.push("L'heure d'arrivee est invalide (format attendu HH:MM).");
  }

  if (isWorkedDay && !isValidTime(departureTime)) {
    errors.push("L'heure de depart est invalide (format attendu HH:MM).");
  }

  const breakMinutes = isWorkedDay ? Number(lunchBreakMinutes) : 0;
  if (isWorkedDay && (!Number.isInteger(breakMinutes) || breakMinutes < 0)) {
    errors.push("La pause dejeuner doit etre un entier positif ou nul.");
  }

  if (normalizedComment.length > MAX_COMMENT_LENGTH) {
    errors.push(`Le commentaire ne doit pas depasser ${MAX_COMMENT_LENGTH} caracteres.`);
  }

  if (errors.length > 0) {
    return renderIndex(res, {
      username: req.authUser,
      month,
      clientId: normalizedClientId,
      error: errors[0],
      formData: {
        date,
        dayType: normalizedDayType,
        arrivalTime,
        departureTime,
        lunchBreakMinutes,
        commentText: normalizedComment,
        originalWorkDate: safeOriginalWorkDate,
      },
    });
  }

  let safeArrivalTime = arrivalTime;
  let safeDepartureTime = departureTime;
  let workedMinutes = 0;

  if (isWorkedDay) {
    const arrivalMinutes = toMinutes(arrivalTime);
    const departureMinutes = toMinutes(departureTime);

    if (departureMinutes <= arrivalMinutes) {
      return renderIndex(res, {
        username: req.authUser,
        month,
        clientId: client.id,
        error: "L'heure de depart doit etre apres l'heure d'arrivee.",
        formData: {
          date,
          dayType: normalizedDayType,
          arrivalTime,
          departureTime,
          lunchBreakMinutes,
          commentText: normalizedComment,
          originalWorkDate: safeOriginalWorkDate,
        },
      });
    }

    workedMinutes = departureMinutes - arrivalMinutes - breakMinutes;
    if (workedMinutes < 0) {
      return renderIndex(res, {
        username: req.authUser,
        month,
        clientId: client.id,
        error: "La pause dejeuner est trop longue pour ce creneau horaire.",
        formData: {
          date,
          dayType: normalizedDayType,
          arrivalTime,
          departureTime,
          lunchBreakMinutes,
          commentText: normalizedComment,
          originalWorkDate: safeOriginalWorkDate,
        },
      });
    }
  } else {
    safeArrivalTime = "00:00";
    safeDepartureTime = "00:00";
  }

  const isDateChange = safeOriginalWorkDate && safeOriginalWorkDate !== date;
  const existingEntryAtTargetDate = await db.getWorkEntryByDate(req.authUser, client.id, date);
  const hasConflictAtTargetDate = Boolean(existingEntryAtTargetDate) && (!safeOriginalWorkDate || isDateChange);

  if (hasConflictAtTargetDate && confirmReplace !== "1") {
    return renderIndex(res, {
      month,
      error: "Une entrée existe déjà a cette date. Confirmez si vous voulez la remplacer.",
      clientId: client.id,
      showReplaceConfirmation: true,
      formData: {
        date,
        dayType: normalizedDayType,
        arrivalTime,
        departureTime,
        lunchBreakMinutes,
        commentText: normalizedComment,
        originalWorkDate: safeOriginalWorkDate,
      },
    });
  }

  await db.upsertWorkEntry(req.authUser, {
    client_id: client.id,
    work_date: date,
    day_type: normalizedDayType,
    arrival_time: safeArrivalTime,
    departure_time: safeDepartureTime,
    lunch_break_minutes: breakMinutes,
    worked_minutes: workedMinutes,
    comment_text: normalizedComment,
  });
  if (isDateChange) {
    await db.deleteWorkEntry(req.authUser, client.id, safeOriginalWorkDate);
  }

  return res.redirect(
    `/?month=${encodeURIComponent(entryMonth)}&clientId=${encodeURIComponent(client.id)}`
  );
});

app.post("/entries/:workDate/delete", async (req, res) => {
  const workDate = req.params.workDate;
  const clientId = normalizeClientId(req.body.clientId);
  const month = normalizeMonth(req.body.selectedMonth || getPayPeriodMonthForDate(workDate));
  const client = clientId ? await db.getClientById(req.authUser, clientId) : null;

  if (client && isValidDate(workDate)) {
    await db.deleteWorkEntry(req.authUser, client.id, workDate);
  }

  if (client) {
    return res.redirect(
      `/?month=${encodeURIComponent(month)}&clientId=${encodeURIComponent(client.id)}`
    );
  }

  return res.redirect(`/?month=${encodeURIComponent(month)}`);
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send("Erreur interne du serveur.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hours app running on http://0.0.0.0:${PORT}`);
});
