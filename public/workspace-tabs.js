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

  function buildDayDetailsMarkup(isoDate) {
    const entry = entriesByDate.get(isoDate) || null;
    if (!entry) {
      return `
        <div class="day-details-empty">
          <strong>Aucune entrée pour ce jour</strong>
          <p>Vous pouvez créer une journée à cette date depuis l’onglet de saisie.</p>
          <div class="form-actions">
            <button type="button" data-day-details-create="${escapeHtml(isoDate)}">Créer une journée</button>
          </div>
        </div>
      `;
    }

    const timingLabel =
      entry.arrival_time_display && entry.departure_time_display
        ? `${escapeHtml(entry.arrival_time_display)} → ${escapeHtml(entry.departure_time_display)}`
        : "Aucun horaire";
    const pauseLabel =
      entry.lunch_break_minutes_display !== ""
        ? `${escapeHtml(entry.lunch_break_minutes_display)} min`
        : "Aucune";
    const commentBlock = entry.comment_text
      ? `
        <div class="day-details-comment">
          <span class="history-entry-metric-label">Commentaire</span>
          <p>${escapeHtml(entry.comment_text)}</p>
        </div>
      `
      : "";

    return `
      <div class="day-details-grid">
        <div class="history-entry-metric">
          <span class="history-entry-metric-label">Date</span>
          <strong>${escapeHtml(entry.work_date_display || entry.work_date)}</strong>
        </div>
        <div class="history-entry-metric">
          <span class="history-entry-metric-label">Type</span>
          <strong>${escapeHtml(entry.day_type_display)}</strong>
        </div>
        <div class="history-entry-metric">
          <span class="history-entry-metric-label">Horaire</span>
          <strong>${timingLabel}</strong>
        </div>
        <div class="history-entry-metric">
          <span class="history-entry-metric-label">Pause</span>
          <strong>${pauseLabel}</strong>
        </div>
        <div class="history-entry-metric">
          <span class="history-entry-metric-label">Durée travaillée</span>
          <strong>${escapeHtml(entry.worked_hhmm || "00:00")}</strong>
        </div>
      </div>
      ${commentBlock}
      <div class="day-details-actions row-actions">
        <a
          class="button-link secondary-link btn-secondary"
          href="/entries/${encodeURIComponent(entry.work_date)}/edit?month=${encodeURIComponent(bootstrap.selectedMonth || "")}&clientId=${encodeURIComponent(bootstrap.selectedClientId || "")}"
        >
          Modifier
        </a>
        <form
          action="/entries/${encodeURIComponent(entry.work_date)}/delete"
          method="post"
          onsubmit="return confirm('Supprimer cette journee ?');"
        >
          <input type="hidden" name="_csrf" value="${escapeHtml(bootstrap.csrfToken || "")}" />
          <input type="hidden" name="selectedMonth" value="${escapeHtml(bootstrap.selectedMonth || "")}" />
          <input type="hidden" name="clientId" value="${escapeHtml(bootstrap.selectedClientId || "")}" />
          <button type="submit" class="danger">Supprimer</button>
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
    dayDetailsModal.hidden = false;
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
