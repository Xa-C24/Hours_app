(() => {
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
                onclick="return confirm('Supprimer cette journee ?');"
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

  syncLayoutMode();
  if (typeof desktopQuery.addEventListener === "function") {
    desktopQuery.addEventListener("change", syncLayoutMode);
  } else if (typeof desktopQuery.addListener === "function") {
    desktopQuery.addListener(syncLayoutMode);
  }
})();
