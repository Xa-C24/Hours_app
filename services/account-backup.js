const crypto = require("node:crypto");
const { normalizeSettings, SETTING_KEYS } = require("../settings");
const { options, workedFraction } = require("../public/day-types");
const fields = {
  clients: ["id", "company_name", "contact_name", "email", "phone", "address", "notes", "company_logo", "archived_at", "created_at"],
  work_entries: ["client_id", "work_date", "day_type", "arrival_time", "departure_time", "lunch_break_minutes", "worked_minutes", "comment_text", "created_at", "updated_at"],
  pay_period_salaries: ["client_id", "pay_period_month", "salary_amount_cents", "created_at", "updated_at"],
};
const ownerKey = user => crypto.createHash("sha256").update(user).digest("hex");
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
const digest = data => crypto.createHash("sha256").update(JSON.stringify(stable(data))).digest("hex");
const fail = message => { const e = new Error(message); e.status = 400; throw e; };
const dateValid = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
function validateBackup(file, username) {
  if (!file || file.format !== "timehours-account" || file.version !== 1 || file.owner !== ownerKey(username)) fail("Ce fichier n’est pas une sauvegarde de ce compte.");
  const data = file.data;
  if (!data || !data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) fail("Réglages invalides.");
  for (const [table, columns] of Object.entries(fields)) {
    if (!Array.isArray(data[table]) || data[table].length > 100000) fail("Volume ou format de sauvegarde invalide.");
    for (const row of data[table]) {
      if (!row || typeof row !== "object" || Object.keys(row).some(key => !columns.includes(key))) fail("Champs de sauvegarde invalides.");
      for (const column of columns) {
        const v = row[column];
        if (["id", "client_id", "salary_amount_cents", "lunch_break_minutes", "worked_minutes"].includes(column)) {
          if (!Number.isSafeInteger(v) || v < (column.endsWith("id") ? 1 : 0)) fail("Valeur numérique invalide.");
        } else if (column === "archived_at" && v === null) continue;
        else if (typeof v !== "string" || v.length > (column === "company_logo" ? 2000000 : 10000)) fail("Texte de sauvegarde invalide.");
        if (column.endsWith("_at") && v !== null && !Number.isFinite(Date.parse(v))) fail("Horodatage invalide.");
      }
    }
  }
  const ids = new Set(data.clients.map(c => c.id));
  if (ids.size !== data.clients.length) fail("Clients dupliqués.");
  for (const c of data.clients) {
    if (!c.company_name.trim()) fail("Nom de client vide.");
    if (c.company_logo && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(c.company_logo)) fail("Logo invalide.");
  }
  const days = new Set();
  for (const row of data.work_entries) {
    const key = `${row.client_id}:${row.work_date}`;
    if (!ids.has(row.client_id) || !dateValid(row.work_date) || days.has(key) || !options.some(o => o.value === row.day_type)) fail("Journée invalide ou dupliquée.");
    days.add(key);
    if (workedFraction(row.day_type) > 0) {
      if (![row.arrival_time,row.departure_time].every(v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v))) fail("Horaire invalide.");
      const mins = v => Number(v.slice(0,2))*60+Number(v.slice(3));
      const duration = mins(row.departure_time)-mins(row.arrival_time);
      if (duration <= 0 || duration-row.lunch_break_minutes !== row.worked_minutes || (workedFraction(row.day_type) === 0.5 && row.lunch_break_minutes !== 0)) fail("Durée incohérente.");
    } else if (row.worked_minutes !== 0 || row.lunch_break_minutes !== 0 || !["", "00:00"].includes(row.arrival_time) || !["", "00:00"].includes(row.departure_time)) fail("Absence incohérente.");
  }
  const salaries = new Set();
  for (const row of data.pay_period_salaries) {
    const key = `${row.client_id}:${row.pay_period_month}`;
    if (!ids.has(row.client_id) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.pay_period_month) || salaries.has(key)) fail("Salaire invalide ou dupliqué.");
    salaries.add(key);
  }
  if (Object.keys(data.settings).some(key => !SETTING_KEYS.includes(key))) fail("Réglage inconnu.");
  return { clients:[...data.clients].sort((a,b)=>a.id-b.id),
    work_entries:data.work_entries.map(row=>workedFraction(row.day_type) ? row : {...row,arrival_time:"00:00",departure_time:"00:00"}).sort((a,b)=>a.client_id-b.client_id || a.work_date.localeCompare(b.work_date)),
    pay_period_salaries:[...data.pay_period_salaries].sort((a,b)=>a.client_id-b.client_id || a.pay_period_month.localeCompare(b.pay_period_month)),
    settings: normalizeSettings(data.settings) };
}
function summary(data) {
  const dates = data.work_entries.map(e=>e.work_date).sort();
  return { clients: data.clients.length, archivedClients: data.clients.filter(c=>c.archived_at).length,
    entries: dates.length, salaries: data.pay_period_salaries.length, firstDate: dates[0] || null, lastDate: dates.at(-1) || null };
}
function envelope(username, data) { return { format:"timehours-account", version:1, owner:ownerKey(username), createdAt:new Date().toISOString(), data }; }
function canonicalRow(row) {
  return Object.fromEntries(Object.entries(row).map(([k,v])=>[k, v instanceof Date ? (k === "work_date" ? v.toISOString().slice(0,10) : v.toISOString()) : ["id","client_id","salary_amount_cents","lunch_break_minutes","worked_minutes"].includes(k) ? Number(v) : v]));
}
function verifyRestored(after, data, ids) {
  for (const [table, columns] of Object.entries(fields)) {
    const project = (row, remap) => columns.map(key => {
      const value = remap && (key === "id" || key === "client_id") ? ids.get(row[key]) : row[key];
      return key.endsWith("_at") && value ? new Date(value).toISOString() : value;
    });
    if (JSON.stringify(after[table].map(row=>project(row,false))) !== JSON.stringify(data[table].map(row=>project(row,true)))) throw new Error("La vérification de restauration a échoué.");
  }
  const settings = obj => Object.entries(obj).sort(([a],[b])=>a.localeCompare(b));
  if (digest(settings(after.settings)) !== digest(settings(data.settings))) throw new Error("Vérification des réglages échouée.");
}
module.exports = { fields, digest, ownerKey, validateBackup, summary, envelope, canonicalRow, verifyRestored };
