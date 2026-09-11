const { workedFraction } = require("../public/day-types");

async function validateAndPrepareWorkEntry(input, dependencies) {
  const {
    username,
    clientId,
    workDate,
    originalWorkDate,
    dayType,
    arrivalTime,
    departureTime,
    lunchBreakMinutes,
    commentText,
  } = input;
  const {
    defaultDayType,
    getClientById,
    isValidDate,
    isValidTime,
    isWorkedDayType,
    maxCommentLength,
    normalizeClientId,
    normalizeDayType,
    toMinutes,
  } = dependencies;

  const normalizedClientId = normalizeClientId(clientId);
  const client = normalizedClientId ? await getClientById(username, normalizedClientId) : null;
  const normalizedComment = typeof commentText === "string" ? commentText.trim() : "";
  const safeOriginalWorkDate = isValidDate(originalWorkDate) ? originalWorkDate : "";
  const normalizedDayType = normalizeDayType(dayType) || defaultDayType;
  const isWorkedDay = isWorkedDayType(normalizedDayType);
  const errors = [];
  if (dayType && !normalizeDayType(dayType)) errors.push("Le type de journée est invalide.");

  if (!client) errors.push("Selectionnez un client avant d'enregistrer une journée.");
  if (!isValidDate(workDate)) errors.push("La date est invalide.");
  if (isWorkedDay && !isValidTime(arrivalTime)) errors.push("L'heure d'arrivee est invalide (format attendu HH:MM).");
  if (isWorkedDay && !isValidTime(departureTime)) errors.push("L'heure de depart est invalide (format attendu HH:MM).");

  const breakMinutes = isWorkedDay && workedFraction(normalizedDayType) !== 0.5 ? Number(lunchBreakMinutes) : 0;
  if (isWorkedDay && (!Number.isInteger(breakMinutes) || breakMinutes < 0)) {
    errors.push("La pause dejeuner doit etre un entier positif ou nul.");
  }
  if (normalizedComment.length > maxCommentLength) {
    errors.push(`Le commentaire ne doit pas depasser ${maxCommentLength} caracteres.`);
  }
  if (errors.length) return { ok: false, message: errors[0], normalizedClientId, client: null, formData: { workDate, dayType: normalizedDayType, arrivalTime, departureTime, lunchBreakMinutes, commentText: normalizedComment, originalWorkDate: safeOriginalWorkDate } };

  let workedMinutes = 0;
  let safeArrivalTime = arrivalTime;
  let safeDepartureTime = departureTime;
  if (isWorkedDay) {
    const arrivalMinutes = toMinutes(arrivalTime);
    const departureMinutes = toMinutes(departureTime);
    if (departureMinutes <= arrivalMinutes) return { ok: false, message: "L'heure de depart doit etre apres l'heure d'arrivee.", normalizedClientId, client, formData: { workDate, dayType: normalizedDayType, arrivalTime, departureTime, lunchBreakMinutes, commentText: normalizedComment, originalWorkDate: safeOriginalWorkDate } };
    workedMinutes = departureMinutes - arrivalMinutes - breakMinutes;
    if (workedMinutes < 0) return { ok: false, message: "La pause dejeuner est trop longue pour ce creneau horaire.", normalizedClientId, client, formData: { workDate, dayType: normalizedDayType, arrivalTime, departureTime, lunchBreakMinutes, commentText: normalizedComment, originalWorkDate: safeOriginalWorkDate } };
  } else {
    safeArrivalTime = "";
    safeDepartureTime = "";
  }
  return { ok: true, client, normalizedClientId, originalWorkDate: safeOriginalWorkDate, entry: { client_id: client.id, work_date: workDate, day_type: normalizedDayType, arrival_time: safeArrivalTime, departure_time: safeDepartureTime, lunch_break_minutes: breakMinutes, worked_minutes: workedMinutes, comment_text: normalizedComment } };
}

module.exports = { validateAndPrepareWorkEntry };
