(() => {
  function createMonthCacheKey(clientId, monthValue) {
    return `${String(clientId || "").trim()}:${String(monthValue || "").trim()}`;
  }

  function createMonthCacheStore(initialEntries = []) {
    const store = new Map(initialEntries);
    return {
      has(clientId, monthValue) {
        return store.has(createMonthCacheKey(clientId, monthValue));
      },
      get(clientId, monthValue) {
        return store.get(createMonthCacheKey(clientId, monthValue)) || null;
      },
      set(clientId, monthValue, payload) {
        store.set(createMonthCacheKey(clientId, monthValue), payload);
        return payload;
      },
      key(clientId, monthValue) {
        return createMonthCacheKey(clientId, monthValue);
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      createMonthCacheKey,
      createMonthCacheStore,
    };
  }

  if (typeof document === "undefined") {
    return;
  }

  const bootstrapElement = document.getElementById("hours-settings-bootstrap");
  if (!bootstrapElement) {
    return;
  }

  function readBootstrap() {
    try {
      return JSON.parse(bootstrapElement.textContent || "{}");
    } catch (error) {
      return {};
    }
  }

  const bootstrap = readBootstrap();
  const emitToast = (detail) => {
    if (typeof window.showToast === "function") {
      window.showToast(detail);
    }
  };
  const desktopQuery = window.matchMedia("(min-width: 1051px)");
  const workspaceTabs = Array.from(document.querySelectorAll("[data-workspace-tab]"));
  const workspacePanels = Array.from(document.querySelectorAll("[data-workspace-panel]"));
  const entryViewButton = document.querySelector('[data-mobile-nav-button][data-target-view="entry"]');
  const calendarViewButton = document.querySelector('[data-mobile-nav-button][data-target-view="calendar"]');
  const archiveViewButton = document.querySelector('[data-mobile-nav-button][data-target-view="history"]');
  const dayDetailsModal = document.querySelector("[data-day-details-modal]");
  const dayDetailsContent = document.querySelector("[data-day-details-content]");
  const closeDayDetailsButtons = Array.from(document.querySelectorAll("[data-close-day-details-modal]"));
  const entriesByDate = new Map((bootstrap.entries || []).map((entry) => [entry.work_date, entry]));
  const desktopDefaultPanel = "calendar";
  const DAY_TYPE_OPTIONS = [
    { value: "office", label: "Bureau", isWorkedDay: true },
    { value: "remote", label: "Teletravail", isWorkedDay: true },
    { value: "leave", label: "Conges", isWorkedDay: false },
    { value: "rtt", label: "RTT", isWorkedDay: false },
    { value: "sick_leave", label: "Arret", isWorkedDay: false },
    { value: "holiday", label: "Ferie", isWorkedDay: false },
  ];
  const WORKED_DAY_TYPES = new Set(
    DAY_TYPE_OPTIONS.filter((option) => option.isWorkedDay).map((option) => option.value)
  );
  let desktopActivePanel = desktopDefaultPanel;
  let lastFocusedElement = null;

  function activateMobileView(viewButton) {
    if (viewButton) {
      viewButton.click();
    }
  }

  function setDesktopPanel(targetKey, { focusSelector = "" } = {}) {
    desktopActivePanel = targetKey;
    workspaceTabs.forEach((button) => {
      const isActive = button.dataset.workspaceTarget === targetKey;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    if (desktopQuery.matches) {
      workspacePanels.forEach((panel) => {
        const panelKey = panel.dataset.workspacePanel || "";
        const shouldShow =
          panelKey === "entry" ||
          panelKey === "calendar" ||
          (panelKey === "history" && targetKey === "history");
        panel.hidden = !shouldShow;
        panel.classList.toggle("is-workspace-active", shouldShow);
      });
      if (focusSelector) {
        const target = document.querySelector(focusSelector);
        if (target && typeof target.focus === "function") {
          window.setTimeout(() => target.focus(), 30);
        }
      }
      return;
    }

    workspacePanels.forEach((panel) => {
      const panelKey = panel.dataset.workspacePanel || "";
      const shouldShow = panelKey === targetKey;
      panel.hidden = !shouldShow;
      panel.classList.toggle("is-workspace-active", shouldShow);
    });
    if (focusSelector) {
      const target = document.querySelector(focusSelector);
      if (target && typeof target.focus === "function") {
        window.setTimeout(() => target.focus(), 30);
      }
    }
  }

  function syncLayoutMode() {
    if (!desktopQuery.matches) {
      workspacePanels.forEach((panel) => {
        panel.hidden = false;
        panel.classList.remove("is-workspace-active");
      });
      return;
    }
    setDesktopPanel(desktopActivePanel || desktopDefaultPanel);
  }

  function openEntryForDate(isoDate) {
    const dateInput = document.getElementById("date");
    if (desktopQuery.matches) {
      setDesktopPanel("entry", { focusSelector: "#date" });
    } else {
      activateMobileView(entryViewButton);
    }
    if (dateInput && isoDate) {
      dateInput.value = isoDate;
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closeDayDetailsModal();
  }

  function syncEntryDateInput(isoDate) {
    const dateInput = document.getElementById("date");
    if (!dateInput || !isoDate) {
      return;
    }
    dateInput.value = isoDate;
    dateInput.dispatchEvent(new Event("input", { bubbles: true }));
    dateInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function buildDayTypeOptionsMarkup(selectedValue) {
    return DAY_TYPE_OPTIONS.map((option) => {
      const isSelected = option.value === selectedValue;
      return `<option value="${escapeHtml(option.value)}"${isSelected ? " selected" : ""}>${escapeHtml(option.label)}</option>`;
    }).join("");
  }

  function syncDayDetailsWorkedFields(scope = dayDetailsContent) {
    if (!(scope instanceof HTMLElement)) {
      return;
    }
    const dayTypeSelect = scope.querySelector("[data-day-details-day-type]");
    if (!(dayTypeSelect instanceof HTMLSelectElement)) {
      return;
    }
    const isWorkedDay = WORKED_DAY_TYPES.has(dayTypeSelect.value);
    scope.querySelectorAll("[data-day-details-worked-field]").forEach((field) => {
      if (!(field instanceof HTMLInputElement)) {
        return;
      }
      field.disabled = !isWorkedDay;
      field.required = isWorkedDay;
      if (!isWorkedDay) {
        field.value = field.type === "number" ? "0" : "00:00";
      }
      const formField = field.closest(".form-field");
      if (formField instanceof HTMLElement) {
        formField.classList.toggle("is-disabled", !isWorkedDay);
      }
    });
  }

  function buildDayDetailsMarkup(isoDate) {
    const entry = entriesByDate.get(isoDate) || null;
    if (!entry) {
      return `
        <div class="day-details-empty">
          <strong>Aucune entree pour ce jour</strong>
          <p>Vous pouvez créer une journée a cette date depuis l'onglet de saisie.</p>
          <div class="form-actions">
            <button type="button" data-day-details-create="${escapeHtml(isoDate)}">Créer une journée</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="day-details-shell">
        <form class="day-details-form entry-form" action="/entries" method="post">
          <input type="hidden" name="_csrf" value="${escapeHtml(bootstrap.csrfToken || "")}" />
          <input type="hidden" name="clientId" value="${escapeHtml(bootstrap.selectedClientId || "")}" />
          <input type="hidden" name="selectedMonth" value="${escapeHtml(bootstrap.selectedMonth || "")}" />
          <input type="hidden" name="originalWorkDate" value="${escapeHtml(entry.work_date)}" />

          <div class="day-details-grid">
            <div class="field form-field">
              <label class="form-label" for="dayDetailsDate">Date</label>
              <input class="form-input" id="dayDetailsDate" name="date" type="date" required value="${escapeHtml(entry.work_date)}" />
            </div>

            <div class="field form-field">
              <label class="form-label" for="dayDetailsType">Type</label>
              <select class="form-select" id="dayDetailsType" name="dayType" required data-day-details-day-type>
                ${buildDayTypeOptionsMarkup(entry.day_type || "office")}
              </select>
            </div>

            <div class="field form-field">
              <label class="form-label" for="dayDetailsArrival">Heure d'arrivee</label>
              <input
                class="form-input"
                id="dayDetailsArrival"
                name="arrivalTime"
                type="time"
                value="${escapeHtml(entry.arrival_time_display || "00:00")}"
                data-day-details-worked-field
              />
            </div>

            <div class="field form-field">
              <label class="form-label" for="dayDetailsDeparture">Heure de depart</label>
              <input
                class="form-input"
                id="dayDetailsDeparture"
                name="departureTime"
                type="time"
                value="${escapeHtml(entry.departure_time_display || "00:00")}"
                data-day-details-worked-field
              />
            </div>

            <div class="field form-field">
              <label class="form-label" for="dayDetailsPause">Pause dejeuner (minutes)</label>
              <input
                class="form-input"
                id="dayDetailsPause"
                name="lunchBreakMinutes"
                type="number"
                min="0"
                value="${escapeHtml(String(entry.lunch_break_minutes_display ?? 0))}"
                data-day-details-worked-field
              />
            </div>

            <div class="history-entry-metric">
              <span class="history-entry-metric-label">Duree travaillee</span>
              <strong>${escapeHtml(entry.worked_hhmm || "00:00")}</strong>
            </div>
          </div>

          <div class="field form-field field-comment day-details-comment">
            <label class="form-label" for="dayDetailsComment">Commentaire</label>
            <textarea class="form-textarea" id="dayDetailsComment" name="commentText" rows="4">${escapeHtml(entry.comment_text || "")}</textarea>
          </div>

          <div class="day-details-actions-row">
            <div class="day-details-actions day-details-actions-inline row-actions">
              <button type="submit" class="btn-primary day-details-action-button">Modifier</button>
            </div>
            <div class="day-details-actions day-details-actions-inline row-actions">
              <button
                type="submit"
                class="danger day-details-action-button"
                formaction="/entries/${encodeURIComponent(entry.work_date)}/delete"
                formmethod="post"
                formnovalidate
                onclick="return confirm('Supprimer cette journée ?');"
              >
                Supprimer
              </button>
            </div>
          </div>
        </form>
      </div>
    `;
  }

  function openDayDetailsModal(isoDate) {
    if (!dayDetailsModal || !dayDetailsContent || !isoDate) {
      return;
    }
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dayDetailsContent.innerHTML = buildDayDetailsMarkup(isoDate);
    if (
      window.hoursSettingsStore &&
      typeof window.hoursSettingsStore.refreshCustomSelects === "function"
    ) {
      window.hoursSettingsStore.refreshCustomSelects();
    }
    dayDetailsModal.hidden = false;
    syncDayDetailsWorkedFields();
    const focusTarget = dayDetailsContent.querySelector("button, a, input, select, textarea");
    if (focusTarget && typeof focusTarget.focus === "function") {
      window.setTimeout(() => focusTarget.focus(), 30);
    }
  }

  function closeDayDetailsModal() {
    if (!dayDetailsModal || dayDetailsModal.hidden) {
      return;
    }
    dayDetailsModal.hidden = true;
    dayDetailsContent.innerHTML = "";
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  workspaceTabs.forEach((button) => {
    button.addEventListener("click", () => {
      if (!desktopQuery.matches) {
        return;
      }
      const targetKey = button.dataset.workspaceTarget || desktopDefaultPanel;
      setDesktopPanel(targetKey);
      if (targetKey === "entry") {
        document.getElementById("date")?.focus();
      }
      if (targetKey === "calendar") {
        document.getElementById("month")?.focus();
      }
    });
  });

  document.querySelectorAll("[data-dashboard-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!desktopQuery.matches) {
        return;
      }
      const action = button.dataset.dashboardAction || "";
      if (action === "entry") {
        setDesktopPanel("entry", { focusSelector: "#date" });
      }
      if (action === "calendar") {
        setDesktopPanel("calendar", { focusSelector: "#month" });
      }
      if (action === "history") {
        setDesktopPanel("history");
      }
    });
  });

  document.addEventListener("click", (event) => {
    const calendarCard = event.target instanceof HTMLElement ? event.target.closest("[data-calendar-day]") : null;
    if (calendarCard) {
      openDayDetailsModal(calendarCard.dataset.date || "");
      return;
    }

    const createButton = event.target instanceof HTMLElement ? event.target.closest("[data-day-details-create]") : null;
    if (createButton) {
      openEntryForDate(createButton.dataset.dayDetailsCreate || "");
      return;
    }
  });

  document.addEventListener("change", (event) => {
    const dayTypeSelect = event.target instanceof HTMLElement ? event.target.closest("[data-day-details-day-type]") : null;
    if (dayTypeSelect) {
      syncDayDetailsWorkedFields();
    }
  });

  closeDayDetailsButtons.forEach((button) => {
    button.addEventListener("click", closeDayDetailsModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDayDetailsModal();
    }
  });

  (() => {
    const mobileCalendar = document.querySelector("[data-mobile-calendar]");
    const mobileCalendarGrid = document.querySelector("[data-mobile-calendar-grid]");
    const mobileCalendarWeekdays = document.querySelector("[data-mobile-calendar-weekdays]");
    const mobileCalendarDetails = document.querySelector("[data-mobile-calendar-details]");
    const mobileCalendarFeedback = document.querySelector("[data-mobile-calendar-feedback]");
    const monthInput = document.getElementById("month");
    const monthLabel = document.querySelector("[data-mobile-calendar-label]");
    const periodLabel = document.querySelector("[data-mobile-calendar-period]");
    const exportLinks = Array.from(document.querySelectorAll('.month-form a[href^="/export."]'));
    const compactQuery = window.matchMedia("(max-width: 1050px)");

    if (
      !(mobileCalendar instanceof HTMLElement) ||
      !(mobileCalendarGrid instanceof HTMLElement) ||
      !(mobileCalendarWeekdays instanceof HTMLElement) ||
      !(mobileCalendarDetails instanceof HTMLElement)
    ) {
      return;
    }

    const firstDayOfWeek = bootstrap.settings && bootstrap.settings.firstDayOfWeek === "sunday" ? "sunday" : "monday";
    const weekdayShortLabels =
      firstDayOfWeek === "sunday"
        ? ["D", "L", "M", "M", "J", "V", "S"]
        : ["L", "M", "M", "J", "V", "S", "D"];
    const activeClientId = String(bootstrap.selectedClientId || "").trim();
    const monthCache = createMonthCacheStore();
    const todayIso = toIsoDate(new Date());
    const loadedMonth = /^\d{4}-\d{2}$/.test(bootstrap.selectedMonth || "") ? bootstrap.selectedMonth : todayIso.slice(0, 7);
    const initialSelectedDate = parseIsoDate(bootstrap.selectedDate || "") ? bootstrap.selectedDate : todayIso;

    if (bootstrap.initialMonthData && activeClientId && loadedMonth) {
      monthCache.set(activeClientId, loadedMonth, bootstrap.initialMonthData);
    }

    function parseIsoDate(isoDate) {
      if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        return null;
      }
      const [year, month, day] = isoDate.split("-").map(Number);
      const parsed = new Date(year, month - 1, day);
      if (
        Number.isNaN(parsed.getTime()) ||
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
      ) {
        return null;
      }
      return parsed;
    }

    function toIsoDate(date) {
      return [
        String(date.getFullYear()).padStart(4, "0"),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
    }

    function clampDateToMonth(isoDate, monthValue) {
      const targetDate = parseIsoDate(isoDate) || parseIsoDate(`${monthValue}-01`) || new Date();
      const [year, month] = monthValue.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      const safeDay = Math.min(targetDate.getDate(), lastDay);
      return toIsoDate(new Date(year, month - 1, safeDay));
    }

    const state = {
      activeMonth: loadedMonth,
      selectedDate:
        initialSelectedDate.slice(0, 7) === loadedMonth
          ? initialSelectedDate
          : clampDateToMonth(initialSelectedDate, loadedMonth),
      isLoading: false,
      errorMessage: "",
      pendingRequestKey: "",
    };

    function shiftMonth(monthValue, delta) {
      const [year, month] = String(monthValue || "").split("-").map(Number);
      const shifted = new Date(year, (month || 1) - 1 + delta, 1);
      return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
    }

    function shiftDay(isoDate, delta) {
      const sourceDate = parseIsoDate(isoDate) || new Date();
      const shifted = new Date(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate() + delta);
      return toIsoDate(shifted);
    }

    function getMonthLabel(monthValue) {
      const parsed = parseIsoDate(`${monthValue}-01`) || new Date();
      return parsed.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    }

    function getDateLabel(isoDate) {
      const parsed = parseIsoDate(isoDate) || new Date();
      return parsed.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }

    function syncMonthInput(monthValue) {
      if (!(monthInput instanceof HTMLInputElement)) {
        return;
      }
      monthInput.value = monthValue;
    }

    function syncExportLinks(monthValue) {
      exportLinks.forEach((link) => {
        if (!(link instanceof HTMLAnchorElement)) {
          return;
        }
        link.href = link.href.replace(/month=\d{4}-\d{2}/, `month=${monthValue}`);
      });
    }

    function getCurrentMonthData() {
      return monthCache.get(activeClientId, state.activeMonth) || null;
    }

    function showFeedback(message, { isError = false, showRetry = false } = {}) {
      if (!(mobileCalendarFeedback instanceof HTMLElement)) {
        return;
      }
      if (!message) {
        mobileCalendarFeedback.hidden = true;
        mobileCalendarFeedback.classList.remove("is-error");
        mobileCalendarFeedback.innerHTML = "";
        return;
      }
      mobileCalendarFeedback.hidden = false;
      mobileCalendarFeedback.classList.toggle("is-error", isError);
      mobileCalendarFeedback.innerHTML = `
        <span>${escapeHtml(message)}</span>
        ${showRetry ? '<button type="button" class="button-link button-neutral" data-mobile-calendar-retry>Reessayer</button>' : ""}
      `;
    }

    async function fetchMonthData(monthValue) {
      const requestKey = monthCache.key(activeClientId, monthValue);
      state.pendingRequestKey = requestKey;
      state.isLoading = true;
      state.errorMessage = "";
      showFeedback("Chargement...");
      try {
        const response = await fetch(
          `/api/entries/month?clientId=${encodeURIComponent(activeClientId)}&month=${encodeURIComponent(monthValue)}`,
          {
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
            },
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" && payload.error ? payload.error : "Chargement impossible.");
        }
        monthCache.set(activeClientId, monthValue, payload);
        if (state.pendingRequestKey === requestKey) {
          showFeedback("");
        }
        return payload;
      } catch (error) {
        if (state.pendingRequestKey === requestKey) {
          state.errorMessage = error instanceof Error && error.message ? error.message : "Chargement impossible.";
          showFeedback("Erreur de chargement.", { isError: true, showRetry: true });
          emitToast({
            type: "error",
            message: "Erreur de chargement du calendrier",
          });
        }
        throw error;
      } finally {
        if (state.pendingRequestKey === requestKey) {
          state.isLoading = false;
        }
      }
    }

    async function ensureMonthLoaded(monthValue) {
      const cached = monthCache.get(activeClientId, monthValue);
      if (cached) {
        return cached;
      }
      return fetchMonthData(monthValue);
    }

    function getEntryForDate(isoDate) {
      const monthData = getCurrentMonthData();
      if (!monthData || !Array.isArray(monthData.entries)) {
        return null;
      }
      return monthData.entries.find((entry) => entry.work_date === isoDate) || null;
    }

    function getStateForDate(isoDate) {
      const entry = getEntryForDate(isoDate);
      const currentDate = parseIsoDate(isoDate) || new Date();
      const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;
      let tone = "empty";
      let label = "Aucune saisie";

      if (entry) {
        if (entry.is_worked_day) {
          tone = entry.under_target ? "partial" : "complete";
          label = entry.under_target ? "Journée partielle" : "Journée complete";
        } else if (entry.day_type === "sick_leave") {
          tone = "sick";
          label = entry.day_type_display || "Maladie";
        } else if (entry.day_type === "leave" || entry.day_type === "rtt" || entry.day_type === "holiday") {
          tone = "leave";
          label = entry.day_type_display || "Absence";
        } else {
          tone = "neutral";
          label = entry.day_type_display || "Aucune saisie";
        }
      } else if (isWeekend) {
        tone = "weekend";
        label = "Week-end";
      } else if (isoDate < todayIso) {
        tone = "missing";
        label = "Journée oubliée";
      }

      return { entry, tone, label };
    }

    function buildWeekdays() {
      mobileCalendarWeekdays.innerHTML = weekdayShortLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("");
    }

    function renderDetails() {
      const selectedDate = state.selectedDate;
      const { entry, label } = getStateForDate(selectedDate);
      const dateLabel = getDateLabel(selectedDate);
      const detailActions = `
        <div class="mobile-calendar-details-actions">
          <button type="button" class="button-link button-neutral" data-mobile-calendar-day-shift="-1">&lsaquo; Jour precedent</button>
          <button type="button" class="button-link button-neutral" data-mobile-calendar-go-today>Aujourd'hui</button>
          <button type="button" class="button-link button-neutral" data-mobile-calendar-day-shift="1">Jour suivant &rsaquo;</button>
        </div>
      `;

      if (!entry) {
        mobileCalendarDetails.innerHTML = `
          <div class="mobile-calendar-details-head">
            <strong>${escapeHtml(dateLabel)}</strong>
            <span>${escapeHtml(label)}</span>
          </div>
          <div class="mobile-calendar-details-empty">
            <strong>Aucune entree pour ce jour</strong>
            <p>Vous pouvez creer une journée a cette date depuis la saisie.</p>
          </div>
          <div class="form-actions">
            <button type="button" data-mobile-calendar-create="${escapeHtml(selectedDate)}">Creer une journée</button>
          </div>
          ${detailActions}
        `;
        return;
      }

      const commentMarkup = entry.comment_text
        ? `
          <div class="mobile-calendar-details-comment">
            <strong>Commentaire</strong>
            <p>${escapeHtml(entry.comment_text)}</p>
          </div>
        `
        : "";

      mobileCalendarDetails.innerHTML = `
        <div class="mobile-calendar-details-head">
          <strong>${escapeHtml(dateLabel)}</strong>
          <span>${escapeHtml(entry.day_type_display || label)}</span>
        </div>
        <div class="mobile-calendar-details-grid">
          <article class="mobile-calendar-detail-item">
            <span>Type</span>
            <strong>${escapeHtml(entry.day_type_display || "-")}</strong>
          </article>
          <article class="mobile-calendar-detail-item">
            <span>Duree</span>
            <strong>${escapeHtml(entry.worked_hhmm || "00:00")}</strong>
          </article>
          <article class="mobile-calendar-detail-item">
            <span>Arrivee</span>
            <strong>${escapeHtml(entry.arrival_time_display || "-")}</strong>
          </article>
          <article class="mobile-calendar-detail-item">
            <span>Depart</span>
            <strong>${escapeHtml(entry.departure_time_display || "-")}</strong>
          </article>
          <article class="mobile-calendar-detail-item">
            <span>Pause</span>
            <strong>${escapeHtml(String(entry.lunch_break_minutes_display ?? "-"))}${entry.lunch_break_minutes_display !== "" ? " min" : ""}</strong>
          </article>
          <article class="mobile-calendar-detail-item">
            <span>Etat</span>
            <strong>${escapeHtml(label)}</strong>
          </article>
        </div>
        ${commentMarkup}
        ${detailActions}
      `;
    }

    function renderMonth() {
      const monthValue = state.activeMonth;
      const monthData = getCurrentMonthData();
      const [year, month] = monthValue.split("-").map(Number);
      const firstOfMonth = new Date(year, month - 1, 1);
      const dayOffset = firstDayOfWeek === "sunday" ? firstOfMonth.getDay() : (firstOfMonth.getDay() + 6) % 7;
      const gridStart = new Date(year, month - 1, 1 - dayOffset);
      const cells = [];

      for (let index = 0; index < 42; index += 1) {
        const currentDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
        const isoDate = toIsoDate(currentDate);
        const isCurrentMonth = currentDate.getMonth() === month - 1;

        if (!isCurrentMonth) {
          cells.push(`
            <div class="mobile-calendar-day-filler" aria-hidden="true">
              <span>${currentDate.getDate()}</span>
            </div>
          `);
          continue;
        }

        const { tone, label } = getStateForDate(isoDate);
        const isToday = isoDate === todayIso;
        const isSelected = isoDate === state.selectedDate;
        const ariaLabel = `${getDateLabel(isoDate)} - ${label}`;

        cells.push(`
          <button
            type="button"
            class="mobile-calendar-day is-${escapeHtml(tone)}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}"
            data-mobile-calendar-day="${escapeHtml(isoDate)}"
            aria-pressed="${String(isSelected)}"
            aria-label="${escapeHtml(ariaLabel)}"
          >
            <span class="mobile-calendar-day-number">${currentDate.getDate()}</span>
            <span class="mobile-calendar-day-indicator" aria-hidden="true"></span>
          </button>
        `);
      }

      if (monthLabel) {
        monthLabel.textContent = getMonthLabel(monthValue);
      }
      if (periodLabel) {
        periodLabel.textContent = monthData && monthData.payPeriodLabel ? monthData.payPeriodLabel : (monthValue === loadedMonth ? (bootstrap.payPeriodLabel || "Periode active") : "Vue locale");
      }

      mobileCalendarGrid.innerHTML = cells.join("");
      renderDetails();
    }

    async function setSelectedDate(nextDate, { syncInput = true } = {}) {
      const parsedDate = parseIsoDate(nextDate);
      if (!parsedDate) {
        return;
      }
      const nextIsoDate = toIsoDate(parsedDate);
      const nextMonth = nextIsoDate.slice(0, 7);
      await ensureMonthLoaded(nextMonth);
      state.selectedDate = nextIsoDate;
      state.activeMonth = nextMonth;
      syncMonthInput(state.activeMonth);
      syncExportLinks(state.activeMonth);
      if (syncInput) {
        syncEntryDateInput(state.selectedDate);
      }
      showFeedback("");
      renderMonth();
    }

    async function setActiveMonth(nextMonth, { preferredDate = state.selectedDate } = {}) {
      if (!/^\d{4}-\d{2}$/.test(nextMonth || "")) {
        return;
      }
      await ensureMonthLoaded(nextMonth);
      state.activeMonth = nextMonth;
      state.selectedDate = clampDateToMonth(preferredDate, nextMonth);
      syncMonthInput(state.activeMonth);
      syncExportLinks(state.activeMonth);
      syncEntryDateInput(state.selectedDate);
      showFeedback("");
      renderMonth();
    }

    function syncResponsiveCalendar() {
      const isCompact = compactQuery.matches;
      mobileCalendar.hidden = !isCompact;
      if (!isCompact) {
        return;
      }
      buildWeekdays();
      renderMonth();
    }

    document.addEventListener("click", async (event) => {
      const mobileDayButton = event.target instanceof HTMLElement ? event.target.closest("[data-mobile-calendar-day]") : null;
      if (mobileDayButton) {
        await setSelectedDate(mobileDayButton.dataset.mobileCalendarDay || "");
        return;
      }

      const monthNavButton = event.target instanceof HTMLElement ? event.target.closest("[data-mobile-calendar-nav]") : null;
      if (monthNavButton) {
        const delta = monthNavButton.dataset.mobileCalendarNav === "prev" ? -1 : 1;
        try {
          await setActiveMonth(shiftMonth(state.activeMonth, delta));
        } catch (error) {
          // Preserve current month on failure.
        }
        return;
      }

      const todayButton = event.target instanceof HTMLElement ? event.target.closest("[data-mobile-calendar-today], [data-mobile-calendar-go-today]") : null;
      if (todayButton) {
        try {
          await setSelectedDate(todayIso);
        } catch (error) {
          // Preserve current state on failure.
        }
        return;
      }

      const retryButton = event.target instanceof HTMLElement ? event.target.closest("[data-mobile-calendar-retry]") : null;
      if (retryButton) {
        try {
          await ensureMonthLoaded(state.activeMonth);
          showFeedback("");
          renderMonth();
        } catch (error) {
          // Keep visible error state.
        }
        return;
      }

      const dayShiftButton = event.target instanceof HTMLElement ? event.target.closest("[data-mobile-calendar-day-shift]") : null;
      if (dayShiftButton) {
        const delta = Number(dayShiftButton.dataset.mobileCalendarDayShift || 0);
        if (!Number.isFinite(delta) || delta === 0) {
          return;
        }
        try {
          await setSelectedDate(shiftDay(state.selectedDate, delta));
        } catch (error) {
          // Preserve current state on failure.
        }
        return;
      }

      const createButton = event.target instanceof HTMLElement ? event.target.closest("[data-mobile-calendar-create]") : null;
      if (createButton) {
        openEntryForDate(createButton.dataset.mobileCalendarCreate || "");
      }
    });

    if (monthInput instanceof HTMLInputElement) {
      monthInput.addEventListener("change", async () => {
        if (!compactQuery.matches) {
          return;
        }
        if (!/^\d{4}-\d{2}$/.test(monthInput.value || "")) {
          return;
        }
        try {
          await setActiveMonth(monthInput.value, { preferredDate: state.selectedDate });
        } catch (error) {
          // Preserve current state on failure.
        }
      });
    }

    if (typeof compactQuery.addEventListener === "function") {
      compactQuery.addEventListener("change", syncResponsiveCalendar);
    } else if (typeof compactQuery.addListener === "function") {
      compactQuery.addListener(syncResponsiveCalendar);
    }

    syncResponsiveCalendar();
  })();

  syncLayoutMode();
  if (typeof desktopQuery.addEventListener === "function") {
    desktopQuery.addEventListener("change", syncLayoutMode);
  } else if (typeof desktopQuery.addListener === "function") {
    desktopQuery.addListener(syncLayoutMode);
  }
})();
