(function () {
  const localDate = value => {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const time = (value, timeZone) => timeZone
    ? new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value)
    : new Date(value).toTimeString().slice(0, 5);
  function transition(state, action, now) {
    if (!state) return action === "play" ? { start: now, pausedAt: null, pauseMs: 0, end: null } : null;
    if (state.end !== null || now < state.start || (state.pausedAt !== null && now < state.pausedAt)) return state;
    if (action === "pause" && state.pausedAt === null) return { ...state, pausedAt: now };
    if (action === "play" && state.pausedAt !== null) return { ...state, pauseMs: state.pauseMs + now - state.pausedAt, pausedAt: null };
    if (action === "stop") return { ...state, end: now, pauseMs: state.pauseMs + (state.pausedAt === null ? 0 : now - state.pausedAt), pausedAt: null };
    return state;
  }
  function totals(state, now) {
    const end = state.end ?? now;
    const pause = state.pauseMs + (state.pausedAt === null ? 0 : end - state.pausedAt);
    return { workedMs: Math.max(0, end - state.start - pause), pauseMinutes: Math.floor(pause / 60000) };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { transition, totals, localDate };
  if (typeof document === "undefined") return;
  const form = document.querySelector("[data-entry-form]");
  if (!form) return;
  const panel = form.querySelector("[data-work-timer]");
  if (!panel) return;
  const field = name => form.elements.namedItem(name);
  const key = `hours:timer:v1:${form.dataset.timerUser}`;
  const status = panel.querySelector("[data-timer-status]");
  const buttons = [...panel.querySelectorAll("[data-timer-action]")];
  const recoveryButton = panel.querySelector("[data-timer-recover]");
  let state = null;
  let legacy = null;
  let version = 0;
  let ready = false;
  let busy = false;
  let networkError = "";
  let serverOffset = 0;
  const serverTime = () => Date.now() + serverOffset;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let csrfToken = "";
  try { csrfToken = JSON.parse(document.getElementById("hours-settings-bootstrap")?.textContent || "{}").csrfToken || ""; } catch (_) {}
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (saved && Number.isFinite(saved.start) && Number.isFinite(saved.pauseMs) && saved.pauseMs >= 0 &&
        (saved.end === null || Number.isFinite(saved.end)) && (saved.pausedAt === null || Number.isFinite(saved.pausedAt)) &&
        typeof saved.clientId === "string" && typeof saved.date === "string") legacy = saved;
  } catch (_) {}
  const matches = () => state && state.clientId === field("clientId").value && state.date === field("date").value;
  const active = () => state && state.end === null;
  async function request(action, context) {
    if (busy) return false;
    busy = true;
    render();
    try {
      const response = await window.fetch("/work-timer", {
        method: action ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        ...(action ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          _csrf: csrfToken, action, version, clientId: field("clientId").value,
          date: field("date").value, timeZone, ...context,
        }) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json();
      if (response.ok || response.status === 409) {
        if (!Number.isSafeInteger(payload.version) || !Number.isFinite(payload.serverNow)) throw new Error();
        state = payload.state;
        version = payload.version;
        serverOffset = payload.serverNow - Date.now();
        ready = true;
      }
      if (!response.ok) {
        networkError = payload.error || "Action non confirmée. Actualisez le suivi avant de réessayer.";
        return false;
      }
      networkError = "";
      return true;
    } catch (_) {
      networkError = "Connexion indisponible : action non confirmée. Le suivi serveur est conservé ; reconnectez-vous avant de réessayer.";
      return false;
    } finally {
      busy = false;
      render();
    }
  }
  function manual(show) {
    form.classList.toggle("timer-manual", show);
    panel.querySelector("[data-timer-manual]").setAttribute("aria-expanded", String(show));
  }
  function render() {
    const supported = window.hoursDayTypes.workedFraction(field("dayType").value) === 1;
    const today = field("date").value === localDate(Date.now());
    const own = matches();
    const running = active();
    buttons[0].disabled = !supported || !today || (running && (!own || state.pausedAt === null));
    buttons[1].disabled = !own || !running || state.pausedAt !== null;
    buttons[2].disabled = !own || !running || !supported;
    if (!ready || busy || form.querySelector("[data-entry-submit-button]").disabled) buttons.forEach(button => { button.disabled = true; });
    if (recoveryButton) {
      recoveryButton.hidden = !ready || Boolean(state) || !legacy;
      recoveryButton.disabled = busy;
    }
    panel.querySelector("[data-timer-play-label]").textContent = own && running && state.pausedAt !== null ? "Reprendre" : "Démarrer";
    const seconds = own ? Math.floor(totals(state, serverTime()).workedMs / 1000) : 0;
    panel.querySelector("[data-timer-clock]").textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, "0")).join(":");
    status.textContent = running && !own ? `Un suivi est en cours pour le client ${state.clientId}, le ${state.date}. Revenez sur cette journée pour le terminer.` :
      !supported ? "Utilisez la saisie manuelle pour les absences et demi-journées." :
      own ? (running ? (state.pausedAt === null ? "Travail en cours" : "En pause — reprendre avec ▶") : "Chronomètre arrêté. Vérifiez que la journée est enregistrée ; les horaires peuvent être récupérés en saisie manuelle.") :
      today ? "Prêt à démarrer" : "Le suivi est disponible pour aujourd’hui. Utilisez la saisie manuelle pour une autre date.";
    if (!ready) status.textContent = "Chargement du suivi serveur…";
    if (networkError) status.textContent = networkError;
    if (!supported || !today) manual(true);
  }
  function fill() {
    const values = { arrivalTime: time(state.start, state.timeZone), departureTime: time(state.end, state.timeZone), lunchBreakMinutes: String(totals(state, state.end).pauseMinutes) };
    Object.entries(values).forEach(([name, value]) => {
      field(name).value = value;
      field(name).dispatchEvent(new Event("input", { bubbles: true }));
      field(name).dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  buttons.forEach(button => button.addEventListener("click", async () => {
    if (busy || !ready || button.disabled) return;
    const action = button.dataset.timerAction;
    if (action === "play" && !active()) {
      if ((state || legacy) && !window.confirm("Démarrer un nouveau suivi ? Vérifiez que les horaires du suivi précédent ont été enregistrés ou récupérés.")) return;
    }
    if (!await request(action)) return;
    if (action === "stop" && matches()) {
      fill();
      manual(true);
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: state.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(state.end);
      const endedDate = ["year", "month", "day"].map(type => parts.find(part => part.type === type).value).join("-");
      if (endedDate !== state.date || time(state.end, state.timeZone) <= time(state.start, state.timeZone)) {
        networkError = "Suivi arrêté et conservé. Corrigez les horaires : arrivée et départ doivent être le même jour, à une minute d’écart au minimum.";
        render();
        return;
      }
      form.requestSubmit();
    }
  }));
  panel.querySelector("[data-timer-manual]").addEventListener("click", async () => {
    if (busy || !ready) return;
    if (active() && matches()) {
      if (!window.confirm("Arrêter le suivi et passer en correction manuelle ? Vérifiez les horaires et les pauses avant d’enregistrer.")) return;
      if (!await request("stop") || !matches()) return;
      fill();
      manual(true);
      render();
      return;
    }
    if (matches() && state.end !== null && !form.classList.contains("timer-manual")) {
      if (window.confirm("Récupérer les horaires du dernier suivi ? Les horaires actuellement affichés seront remplacés, sans enregistrer la journée.")) fill();
    }
    manual(!form.classList.contains("timer-manual"));
  });
  form.addEventListener("submit", event => {
    if (!ready || busy || (active() && matches())) {
      event.preventDefault();
      event.stopImmediatePropagation();
      status.textContent = !ready || busy ? "Attendez la synchronisation du chronomètre avant d’enregistrer." : "Terminez le suivi avec ⏹ avant d’enregistrer la journée.";
    }
  }, true);
  form.addEventListener("change", render);
  panel.hidden = false;
  form.classList.add("timer-enabled");
  manual(form.dataset.isEditing === "1");
  render();
  if (recoveryButton) recoveryButton.addEventListener("click", async () => {
    if (!legacy || busy || state) return;
    if (!window.confirm("Récupérer l’ancien suivi de cet onglet sur le serveur ?")) return;
    if (await request("recover", { legacy, clientId: legacy.clientId, date: legacy.date })) {
      legacy = null;
      try { sessionStorage.removeItem(key); } catch (_) {}
      render();
    }
  });
  request();
  window.addEventListener("focus", () => request());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) request(); });
  setInterval(() => { if (!document.hidden) request(); }, 5000);
  setInterval(render, 1000);
})();
