const express = require("express");
const { transition } = require("../public/work-timer");

function dateInZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function recoverLegacy(value, now) {
  if (!value || !Number.isSafeInteger(value.start) || value.start < 0 || value.start > now ||
      !Number.isSafeInteger(value.pauseMs) || value.pauseMs < 0 ||
      !(value.end === null || (Number.isSafeInteger(value.end) && value.end >= value.start && value.end <= now)) ||
      !(value.pausedAt === null || (Number.isSafeInteger(value.pausedAt) && value.pausedAt >= value.start && value.pausedAt <= now)) ||
      (value.end !== null && value.pausedAt !== null) || value.pauseMs > (value.end ?? value.pausedAt ?? now) - value.start) return null;
  return { start: value.start, end: value.end, pausedAt: value.pausedAt, pauseMs: value.pauseMs };
}

function createWorkTimerRouter(db, clock = Date.now) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.authUser) return res.status(401).json({ error: "Session expirée. Reconnectez-vous." });
    next();
  });
  const response = record => ({ ...record, serverNow: clock() });
  router.get("/", async (req, res) => res.json(response(await db.getWorkTimer(req.authUser))));
  router.post("/", async (req, res) => {
    const { action, version, clientId, date, timeZone } = req.body || {};
    if (!["play", "pause", "stop", "recover"].includes(action) || !Number.isSafeInteger(version) || version < 0 ||
        typeof clientId !== "string" || !/^[1-9]\d*$/.test(clientId) || !Number.isSafeInteger(Number(clientId)) ||
        typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Action de chronomètre invalide." });
    }
    const client = await db.getClientById(req.authUser, Number(clientId));
    if (!client) return res.status(404).json({ error: "Client inaccessible." });
    const record = await db.getWorkTimer(req.authUser);
    const conflict = async () => res.status(409).json({ ...response(await db.getWorkTimer(req.authUser)), error: "Le suivi a changé dans une autre fenêtre. Vérifiez son état avant de réessayer." });
    if (record.version !== version) return conflict();
    const now = clock();
    let next;
    if (action === "recover" || (action === "play" && (!record.state || record.state.end !== null))) {
      let today;
      try {
        if (typeof timeZone !== "string" || timeZone.length > 100) throw new Error();
        today = dateInZone(now, timeZone);
      } catch (_) { return res.status(400).json({ error: "Fuseau horaire invalide." }); }
      if (action === "recover") {
        if (record.state) return conflict();
        next = recoverLegacy(req.body.legacy, now);
        if (!next || dateInZone(next.start, timeZone) !== date) return res.status(400).json({ error: "Ancien suivi invalide." });
      } else {
        if (date !== today || client.archived_at) return res.status(400).json({ error: "Démarrez sur la date du jour et un client actif." });
        next = transition(null, "play", now);
      }
      next = { ...next, clientId, date, timeZone };
    } else {
      if (!record.state || record.state.clientId !== clientId || record.state.date !== date || record.state.end !== null) return conflict();
      next = transition(record.state, action, now);
      if (next === record.state) return res.json(response(record));
    }
    const saved = await db.saveWorkTimer(req.authUser, version, next);
    if (!saved) return conflict();
    return res.json(response(saved));
  });
  router.use((error, req, res, next) => {
    res.status(503).json({ error: "Suivi temporairement indisponible. Vérifiez son état avant de réessayer." });
  });
  return router;
}

module.exports = { createWorkTimerRouter, recoverLegacy, dateInZone };
