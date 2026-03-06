const path = require("path");
const crypto = require("crypto");
const express = require("express");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3002;
const DAILY_TARGET_MINUTES = 7 * 60;
const SESSION_COOKIE_NAME = "hours_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_COMMENT_LENGTH = 1000;
const CSV_SEPARATOR = ";";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const sessions = new Map();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

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
    cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || "";
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    username,
    expiresAt: Date.now() + SESSION_DURATION_MS,
  });
  return token;
}

function getSessionFromRequest(req) {
  const token = getSessionTokenFromRequest(req);
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_DURATION_MS;
  sessions.set(token, session);
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

function hashPassword(password, saltHex = crypto.randomBytes(16).toString("hex")) {
  const hashHex = crypto.scryptSync(password, saltHex, 64).toString("hex");
  return { saltHex, hashHex };
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

function isDuplicateUsernameError(error) {
  return Boolean(
    error &&
      typeof error.message === "string" &&
      error.message.includes("UNIQUE constraint failed: users.username")
  );
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

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

function normalizeMonth(month) {
  if (typeof month === "string" && MONTH_REGEX.test(month)) {
    return month;
  }
  return getCurrentMonth();
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

function getOvertimeMinutes(workedMinutes) {
  return Math.max(0, workedMinutes - DAILY_TARGET_MINUTES);
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function normalizeExportText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getMonthBounds(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const nextYear = monthNumber === 12 ? year + 1 : year;
  return {
    startDate: `${year}-${pad2(monthNumber)}-01`,
    endDate: `${nextYear}-${pad2(nextMonth)}-01`,
  };
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

function getMonthData(username, month) {
  const normalizedMonth = normalizeMonth(month);
  const { startDate, endDate } = getMonthBounds(normalizedMonth);
  const baseEntries = db.getEntriesForMonth(username, startDate, endDate).map((entry) => ({
    ...entry,
    week_start: getWeekStartMonday(entry.work_date),
    work_date_display: formatDateDisplayFr(entry.work_date),
    worked_hhmm: formatMinutesToHHMM(entry.worked_minutes),
    overtime_minutes: getOvertimeMinutes(entry.worked_minutes),
    overtime_hhmm: formatMinutesToHHMM(getOvertimeMinutes(entry.worked_minutes)),
    under_target: entry.worked_minutes < DAILY_TARGET_MINUTES,
  }));
  const weekStarts = [...new Set(baseEntries.map((entry) => entry.week_start).filter(Boolean))];
  const weekClassByStart = new Map(
    weekStarts.map((weekStart, index) => [weekStart, `week-${(index % 4) + 1}`])
  );
  const entries = baseEntries.map((entry) => ({
    ...entry,
    week_color_class: weekClassByStart.get(entry.week_start) || "",
  }));

  const totalMinutes = entries.reduce((sum, entry) => sum + entry.worked_minutes, 0);
  const monthlyTargetMinutes = entries.length * DAILY_TARGET_MINUTES;
  const totalOvertimeMinutes = Math.max(0, totalMinutes - monthlyTargetMinutes);
  return {
    entries,
    totalHHMM: formatMinutesToHHMM(totalMinutes),
    totalOvertimeHHMM: formatMinutesToHHMM(totalOvertimeMinutes),
  };
}

function renderIndex(res, options = {}) {
  const username = options.username || res.locals.authUser || "";
  const month = normalizeMonth(options.month);
  const { entries, totalHHMM, totalOvertimeHHMM } = getMonthData(username, month);

  const defaultFormData = {
    date: formatDate(new Date()),
    arrivalTime: "09:00",
    departureTime: "17:00",
    lunchBreakMinutes: 60,
    commentText: "",
    originalWorkDate: "",
  };
  const editDate = isValidDate(options.editDate) ? options.editDate : "";
  const entryToEdit = editDate ? entries.find((entry) => entry.work_date === editDate) : null;
  const editFormData = entryToEdit
    ? {
        date: entryToEdit.work_date,
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
    selectedMonth: month,
    entries,
    totalHHMM,
    totalOvertimeHHMM,
    error: options.error || "",
    formData: mergedFormData,
    isEditing: Boolean(editingWorkDate),
    editingWorkDate,
    authUser: res.locals.authUser || "",
  });
}

function renderLogin(res, options = {}) {
  res.render("login", {
    error: options.error || "",
    success: options.success || "",
    formData: options.formData || { username: "" },
  });
}

function renderRegister(res, options = {}) {
  res.render("register", {
    error: options.error || "",
    formData: options.formData || { username: "" },
  });
}

app.use((req, res, next) => {
  const session = getSessionFromRequest(req);
  if (session) {
    req.authUser = session.username;
    req.authSessionToken = session.token;
    res.locals.authUser = session.username;
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.authUser) {
    return res.redirect("/login");
  }
  return next();
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

app.post("/login", (req, res) => {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!username || !password) {
    return renderLogin(res, {
      error: "Nom d'utilisateur et mot de passe obligatoires.",
      formData: { username },
    });
  }

  const user = db.getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return renderLogin(res, {
      error: "Identifiants invalides.",
      formData: { username },
    });
  }

  const token = createSession(username);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_MS,
  });

  return res.redirect("/");
});

app.get("/register", (req, res) => {
  if (req.authUser) {
    return res.redirect("/");
  }
  return renderRegister(res);
});

app.post("/register", (req, res) => {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!isValidUsername(username)) {
    return renderRegister(res, {
      error: "Le nom utilisateur doit contenir 3 a 32 caracteres (lettres, chiffres, . _ -).",
      formData: { username },
    });
  }

  if (!isValidPassword(password)) {
    return renderRegister(res, {
      error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caracteres.`,
      formData: { username },
    });
  }

  const existingUser = db.getUserByUsername(username);
  if (existingUser) {
    return renderRegister(res, {
      error: "Ce nom utilisateur existe deja.",
      formData: { username },
    });
  }

  const { saltHex, hashHex } = hashPassword(password);
  try {
    db.createUser({
      username,
      password_salt: saltHex,
      password_hash: hashHex,
    });
    db.ensureUserDatabase(username);
  } catch (error) {
    if (isDuplicateUsernameError(error)) {
      return renderRegister(res, {
        error: "Ce nom utilisateur existe deja.",
        formData: { username },
      });
    }
    throw error;
  }
  return res.redirect(`/login?registered=1&username=${encodeURIComponent(username)}`);
});

app.post("/logout", (req, res) => {
  if (req.authSessionToken) {
    sessions.delete(req.authSessionToken);
  }
  clearSessionCookie(res);
  return res.redirect("/login");
});

app.use(requireAuth);

app.get("/", (req, res) => {
  renderIndex(res, { username: req.authUser, month: req.query.month, editDate: req.query.editDate });
});

app.get("/entries/:workDate/edit", (req, res) => {
  const workDate = req.params.workDate;
  const month = normalizeMonth(
    req.query.month || (isValidDate(workDate) ? workDate.slice(0, 7) : "")
  );
  renderIndex(res, { username: req.authUser, month, editDate: workDate });
});

app.get("/export.csv", (req, res) => {
  const month = normalizeMonth(req.query.month);
  const { entries, totalHHMM, totalOvertimeHHMM } = getMonthData(req.authUser, month);

  const header = [
    "date",
    "arrival_time",
    "departure_time",
    "lunch_break_minutes",
    "comment_text",
    "worked_hhmm",
    "overtime_hhmm",
    "status",
  ];

  const lines = ["sep=;", header.map(escapeCsvValue).join(CSV_SEPARATOR)];

  for (const entry of entries) {
    lines.push(
      [
        entry.work_date,
        entry.arrival_time,
        entry.departure_time,
        entry.lunch_break_minutes,
        normalizeExportText(entry.comment_text),
        entry.worked_hhmm,
        entry.overtime_hhmm,
        entry.under_target ? "moins_de_7h" : "ok",
      ]
        .map(escapeCsvValue)
        .join(CSV_SEPARATOR)
    );
  }

  lines.push("");
  lines.push([escapeCsvValue("total_month"), escapeCsvValue(totalHHMM)].join(CSV_SEPARATOR));
  lines.push([escapeCsvValue("total_overtime"), escapeCsvValue(totalOvertimeHHMM)].join(CSV_SEPARATOR));

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="hours-${month}.csv"`);
  const csvText = `\uFEFF${lines.join("\r\n")}`;
  res.send(csvText);
});

app.post("/entries", (req, res) => {
  const {
    date,
    arrivalTime,
    departureTime,
    lunchBreakMinutes,
    commentText,
    selectedMonth,
    originalWorkDate,
  } = req.body;
  const normalizedComment = typeof commentText === "string" ? commentText.trim() : "";
  const safeOriginalWorkDate = isValidDate(originalWorkDate) ? originalWorkDate : "";
  const month = normalizeMonth(selectedMonth || (typeof date === "string" ? date.slice(0, 7) : ""));
  const errors = [];

  if (!isValidDate(date)) {
    errors.push("La date est invalide.");
  }

  if (!isValidTime(arrivalTime)) {
    errors.push("L'heure d'arrivee est invalide (format attendu HH:MM).");
  }

  if (!isValidTime(departureTime)) {
    errors.push("L'heure de depart est invalide (format attendu HH:MM).");
  }

  const breakMinutes = Number(lunchBreakMinutes);
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 480) {
    errors.push("La pause dejeuner doit etre un entier entre 0 et 480.");
  }

  if (normalizedComment.length > MAX_COMMENT_LENGTH) {
    errors.push(`Le commentaire ne doit pas depasser ${MAX_COMMENT_LENGTH} caracteres.`);
  }

  if (errors.length > 0) {
    return renderIndex(res, {
      month,
      error: errors[0],
      formData: {
        date,
        arrivalTime,
        departureTime,
        lunchBreakMinutes,
        commentText: normalizedComment,
        originalWorkDate: safeOriginalWorkDate,
      },
    });
  }

  const arrivalMinutes = toMinutes(arrivalTime);
  const departureMinutes = toMinutes(departureTime);

  if (departureMinutes <= arrivalMinutes) {
    return renderIndex(res, {
      month,
      error: "L'heure de depart doit etre apres l'heure d'arrivee.",
      formData: {
        date,
        arrivalTime,
        departureTime,
        lunchBreakMinutes,
        commentText: normalizedComment,
        originalWorkDate: safeOriginalWorkDate,
      },
    });
  }

  const workedMinutes = departureMinutes - arrivalMinutes - breakMinutes;
  if (workedMinutes < 0) {
    return renderIndex(res, {
      month,
      error: "La pause dejeuner est trop longue pour ce creneau horaire.",
      formData: {
        date,
        arrivalTime,
        departureTime,
        lunchBreakMinutes,
        commentText: normalizedComment,
        originalWorkDate: safeOriginalWorkDate,
      },
    });
  }

  db.upsertEntry(req.authUser, {
    work_date: date,
    arrival_time: arrivalTime,
    departure_time: departureTime,
    lunch_break_minutes: breakMinutes,
    worked_minutes: workedMinutes,
    comment_text: normalizedComment,
  });
  if (safeOriginalWorkDate && safeOriginalWorkDate !== date) {
    db.deleteEntry(req.authUser, safeOriginalWorkDate);
  }

  return res.redirect(`/?month=${encodeURIComponent(month)}`);
});

app.post("/entries/:workDate/delete", (req, res) => {
  const workDate = req.params.workDate;
  const month = normalizeMonth(
    req.body.selectedMonth || (typeof workDate === "string" ? workDate.slice(0, 7) : "")
  );

  if (isValidDate(workDate)) {
    db.deleteEntry(req.authUser, workDate);
  }

  return res.redirect(`/?month=${encodeURIComponent(month)}`);
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send("Erreur interne du serveur.");
});

app.listen(PORT, () => {
  console.log(`Hours app running on http://localhost:${PORT}`);
});
