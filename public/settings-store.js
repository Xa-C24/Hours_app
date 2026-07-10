(() => {
  const bootstrapElement = document.getElementById("hours-settings-bootstrap");
  if (!bootstrapElement) {
    return;
  }

  const ACCENT_PALETTE = {
    amber: { primary: "#b7833c", hover: "#97692f", focus: "rgba(183, 131, 60, 0.2)" },
    steel: { primary: "#355b84", hover: "#274a71", focus: "rgba(53, 91, 132, 0.18)" },
    sage: { primary: "#5f7d68", hover: "#47614f", focus: "rgba(95, 125, 104, 0.2)" },
    coral: { primary: "#c86a5a", hover: "#a85144", focus: "rgba(200, 106, 90, 0.2)" },
  };

  function readBootstrap() {
    try {
      return JSON.parse(bootstrapElement.textContent || "{}");
    } catch (error) {
      return {};
    }
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function formatMinutes(minutes) {
    const safeMinutes = Math.max(0, Number(minutes) || 0);
    const hours = Math.floor(safeMinutes / 60);
    const remainder = safeMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function parseMinutes(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.round(value);
    }
    if (typeof value !== "string") {
      return fallback;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    if (/^\d{2}:\d{2}$/.test(trimmed)) {
      const [hours, minutes] = trimmed.split(":").map(Number);
      return hours * 60 + minutes;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  }

  function parseIsoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatIsoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function addDays(date, amount) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + amount);
    return nextDate;
  }

  function getWeekStart(date, firstDayOfWeek) {
    const offset = firstDayOfWeek === "sunday"
      ? date.getDay()
      : (date.getDay() + 6) % 7;
    return addDays(date, -offset);
  }

  function buildStateLabel(entry, isoDate, todayIso) {
    if (entry) {
      if (entry.is_worked_day) {
        return {
          tone: entry.under_target ? "partial" : "complete",
          emoji: entry.under_target ? "🟡" : "🟢",
          label: entry.day_type_display || "Journée",
          meta: entry.worked_hhmm || "",
        };
      }
      if (entry.day_type === "sick_leave") {
        return { tone: "sick", emoji: "🟣", label: entry.day_type_display || "Arrêt", meta: "" };
      }
      return { tone: "leave", emoji: "🔵", label: entry.day_type_display || "Absence", meta: "" };
    }
    const parsedDate = parseIsoDate(isoDate);
    if (parsedDate && (parsedDate.getDay() === 0 || parsedDate.getDay() === 6)) {
      return { tone: "weekend", emoji: "⚫", label: "Week-end", meta: "" };
    }
    if (todayIso && isoDate < todayIso) {
      return { tone: "missing", emoji: "🔴", label: "Aucune saisie", meta: "" };
    }
    return { tone: "empty", emoji: "⚪", label: "À venir", meta: "" };
  }

  const bootstrap = readBootstrap();
  const state = {
    csrfToken: typeof bootstrap.csrfToken === "string" ? bootstrap.csrfToken : "",
    settings: deepClone(bootstrap.settings || {}),
    entries: Array.isArray(bootstrap.entries) ? bootstrap.entries : [],
    isEditing: Boolean(bootstrap.isEditing),
    listeners: new Set(),
  };

  const root = document.documentElement;

  function getSelectedDate() {
    const dateInput = document.getElementById("date");
    if (dateInput && typeof dateInput.value === "string" && dateInput.value) {
      return dateInput.value;
    }
    return typeof bootstrap.selectedDate === "string" ? bootstrap.selectedDate : "";
  }

  function applyAccentColor(accentKey) {
    const accent = ACCENT_PALETTE[accentKey] || ACCENT_PALETTE.amber;
    root.style.setProperty("--primary", accent.primary);
    root.style.setProperty("--primary-hover", accent.hover);
    root.style.setProperty("--focus-ring", accent.focus);
    root.dataset.accentColor = accentKey;
  }

  function applyAnimations(mode) {
    root.dataset.animations = mode;
    if (mode === "off") {
      root.style.setProperty("--motion-fast", "0ms");
      root.style.setProperty("--motion-medium", "0ms");
      root.style.setProperty("--motion-lift", "0px");
      return;
    }
    if (mode === "reduced") {
      root.style.setProperty("--motion-fast", "80ms");
      root.style.setProperty("--motion-medium", "100ms");
      root.style.setProperty("--motion-lift", "-1px");
      return;
    }
    root.style.setProperty("--motion-fast", "160ms");
    root.style.setProperty("--motion-medium", "180ms");
    root.style.setProperty("--motion-lift", "-2px");
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("hours_theme", theme);
    } catch (error) {
      // Ignore browser storage restrictions.
    }
  }

  function syncControls() {
    document.querySelectorAll("[data-setting-key]").forEach((element) => {
      const key = element.dataset.settingKey || "";
      const subkey = element.dataset.settingSubkey || "";
      if (key === "notifications" && subkey && element instanceof HTMLInputElement) {
        element.checked = Boolean(state.settings.notifications && state.settings.notifications[subkey]);
        return;
      }
      if (key === "compactMode" && element instanceof HTMLSelectElement) {
        element.value = state.settings.compactMode ? "true" : "false";
        return;
      }
      if (key === "dailyGoal" && element instanceof HTMLInputElement) {
        element.value = formatMinutes(state.settings.dailyGoal);
        return;
      }
      if (key === "defaultPause" && element instanceof HTMLInputElement) {
        element.value = String(state.settings.defaultPause);
        return;
      }
      if ("value" in element && state.settings[key] !== undefined) {
        element.value = String(state.settings[key]);
      }
    });
  }

  function updateEntryDefaults(previousSettings) {
    if (state.isEditing) {
      return;
    }
    const arrivalInput = document.getElementById("arrivalTime");
    const departureInput = document.getElementById("departureTime");
    const breakInput = document.getElementById("lunchBreakMinutes");
    if (!(arrivalInput && departureInput && breakInput)) {
      return;
    }

    const previousStart = previousSettings ? previousSettings.defaultStartTime : "";
    const previousEnd = previousSettings ? previousSettings.defaultEndTime : "";
    const previousPause = previousSettings ? String(previousSettings.defaultPause) : "";

    if (!arrivalInput.value || arrivalInput.value === previousStart) {
      arrivalInput.value = state.settings.defaultStartTime;
    }
    if (!departureInput.value || departureInput.value === previousEnd) {
      departureInput.value = state.settings.defaultEndTime;
    }
    if (!breakInput.value || breakInput.value === previousPause) {
      breakInput.value = String(state.settings.defaultPause);
    }
  }

  function setText(selector, value) {
    const element = document.querySelector(`[data-settings-cockpit="${selector}"]`);
    if (element) {
      element.textContent = value;
    }
  }

  function updateCockpit() {
    const selectedDate = getSelectedDate();
    const todayEntry = state.entries.find((entry) => entry.work_date === selectedDate) || null;
    const dailyGoal = Math.max(0, Number(state.settings.dailyGoal || 0));
    const todayWorkedMinutes = todayEntry ? Number(todayEntry.worked_minutes || 0) : 0;
    const todayProgress = dailyGoal > 0 ? Math.max(0, Math.min(100, Math.round((todayWorkedMinutes / dailyGoal) * 100))) : 0;
    const todayRemainingMinutes = Math.max(0, dailyGoal - todayWorkedMinutes);
    setText("todayWorked", todayEntry ? todayEntry.worked_hhmm || "00:00" : "00:00");
    setText("todayProgress", `${todayProgress}%`);
    setText("todayTarget", formatMinutes(dailyGoal));
    setText("todayRemaining", formatMinutes(todayRemainingMinutes));
    setText(
      "todayMeta",
      todayWorkedMinutes >= dailyGoal
        ? "Objectif atteint ou dépassé"
        : `${todayRemainingMinutes} min restantes pour l'objectif`
    );

    const selectedDateObject = parseIsoDate(selectedDate);
    const weekStart = selectedDateObject ? getWeekStart(selectedDateObject, state.settings.firstDayOfWeek) : null;
    const weekEnd = weekStart ? addDays(weekStart, 6) : null;
    const weekEntries = weekStart && weekEnd
      ? state.entries.filter((entry) => entry.work_date >= formatIsoDate(weekStart) && entry.work_date <= formatIsoDate(weekEnd))
      : [];
    const weekWorkedMinutes = weekEntries.reduce((sum, entry) => sum + Number(entry.worked_minutes || 0), 0);
    const weekWorkedDays = weekEntries.reduce((sum, entry) => sum + (entry.is_worked_day ? 1 : 0), 0);
    const weekTargetMinutes = weekWorkedDays * dailyGoal;
    const weekBalanceMinutes = weekWorkedMinutes - weekTargetMinutes;
    const weekBalanceHHMM = formatMinutes(Math.abs(weekBalanceMinutes));
    setText("weekTotal", formatMinutes(weekWorkedMinutes));
    setText(
      "weekBalance",
      weekBalanceMinutes > 0
        ? `En avance de ${weekBalanceHHMM}`
        : weekBalanceMinutes < 0
          ? `En retrait de ${weekBalanceHHMM}`
          : "Semaine exactement à l'objectif"
    );

    const monthWorkedMinutes = state.entries.reduce((sum, entry) => sum + Number(entry.worked_minutes || 0), 0);
    const monthWorkedDays = state.entries.reduce((sum, entry) => sum + (entry.is_worked_day ? 1 : 0), 0);
    const monthTargetMinutes = monthWorkedDays * dailyGoal;
    const monthRemainingMinutes = Math.max(0, monthTargetMinutes - monthWorkedMinutes);
    const monthProgress = monthTargetMinutes > 0
      ? Math.max(0, Math.min(100, Math.round((monthWorkedMinutes / monthTargetMinutes) * 100)))
      : 0;
    setText("monthTarget", formatMinutes(monthTargetMinutes));
    setText("monthProgress", `${monthProgress}%`);
    setText("monthRemaining", formatMinutes(monthRemainingMinutes));

    const progressRing = document.querySelector("[data-cockpit-progress]");
    if (progressRing) {
      progressRing.dataset.cockpitProgress = String(todayProgress);
      progressRing.style.setProperty("--cockpit-progress-angle", `${(todayProgress / 100) * 360}deg`);
    }
    const monthProgressBar = document.querySelector("[data-cockpit-month-progress]");
    if (monthProgressBar) {
      monthProgressBar.dataset.cockpitMonthProgress = String(monthProgress);
      monthProgressBar.style.width = `${monthProgress}%`;
    }
  }

  function applyCalendarFilter() {
    const activeButton = document.querySelector("[data-day-filter][aria-pressed='true']");
    const filterValue = activeButton ? activeButton.dataset.dayFilter || "all" : "all";
    const cards = Array.from(document.querySelectorAll("[data-calendar-day]"));
    const emptyMessage = document.querySelector("[data-calendar-empty]");
    let visibleCount = 0;
    cards.forEach((card) => {
      const dayType = card.dataset.dayType || "";
      const isVisible = filterValue === "all" || dayType === filterValue;
      card.classList.toggle("is-filter-hidden", !isVisible);
      if (isVisible) {
        visibleCount += 1;
      }
    });
    if (emptyMessage) {
      emptyMessage.hidden = visibleCount !== 0;
    }
  }

  function syncSelectedCalendarCard() {
    const selectedDate = getSelectedDate();
    document.querySelectorAll("[data-calendar-day]").forEach((card) => {
      const isSelected = card.dataset.date === selectedDate;
      card.classList.toggle("is-selected", isSelected);
      card.setAttribute("aria-pressed", String(isSelected));
    });
  }

  function renderCalendar() {
    const board = document.querySelector("[data-calendar-board]");
    if (!board) {
      return;
    }
    const startDate = parseIsoDate(bootstrap.payPeriodStartDate);
    const endDate = parseIsoDate(bootstrap.payPeriodEndDate);
    if (!startDate || !endDate) {
      return;
    }

    const todayIso = formatIsoDate(new Date());
    const selectedDate = getSelectedDate();
    const firstDay = state.settings.firstDayOfWeek === "sunday" ? "sunday" : "monday";
    const weekdayLabels = firstDay === "sunday"
      ? ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"]
      : ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

    const gridStart = getWeekStart(startDate, firstDay);
    const gridEnd = addDays(getWeekStart(endDate, firstDay), 6);
    const entryMap = new Map(state.entries.map((entry) => [entry.work_date, entry]));

    let weekdaysHtml = '<div class="calendar-weekdays" aria-hidden="true">';
    weekdayLabels.forEach((label) => {
      weekdaysHtml += `<span>${label}</span>`;
    });
    weekdaysHtml += "</div>";

    let gridHtml = '<div class="calendar-grid">';
    for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor = addDays(cursor, 1)) {
      const isoDate = formatIsoDate(cursor);
      const isInPeriod = cursor >= startDate && cursor <= endDate;
      if (!isInPeriod) {
        gridHtml += `<div class="calendar-day-filler" aria-hidden="true"><span>${cursor.getDate()}</span></div>`;
        continue;
      }
      const entry = entryMap.get(isoDate) || null;
      const stateLabel = buildStateLabel(entry, isoDate, todayIso);
      const isToday = isoDate === todayIso;
      const isSelected = isoDate === selectedDate;
      const dateLabel = cursor.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      });
      const durationLabel = entry ? entry.worked_hhmm || "" : "";
      const weekdayShort = cursor.toLocaleDateString("fr-FR", { weekday: "short" });
      gridHtml += `
        <button
          type="button"
          class="calendar-day-card is-${stateLabel.tone}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}"
          data-calendar-day
          data-date="${isoDate}"
          data-day-type="${entry ? entry.day_type || "" : (stateLabel.tone === "weekend" ? "weekend" : "empty")}"
          data-state-tone="${stateLabel.tone}"
          aria-pressed="${isSelected ? "true" : "false"}"
          aria-label="${dateLabel} - ${stateLabel.label}${durationLabel ? ` - ${durationLabel}` : ""}"
        >
          <div class="calendar-day-card-head">
            <span class="calendar-day-weekday">${weekdayShort}</span>
            <span class="calendar-day-number">${cursor.getDate()}</span>
          </div>
          <div class="calendar-day-card-body">
            <strong class="calendar-day-duration">${durationLabel || " "}</strong>
            <span class="calendar-day-state">
              <span aria-hidden="true">${stateLabel.emoji}</span>
              <span>${stateLabel.meta || stateLabel.label}</span>
            </span>
          </div>
          <div class="calendar-day-preview" role="tooltip">
            <strong>${dateLabel}</strong>
            <span>${stateLabel.label}</span>
            ${durationLabel ? `<span>${durationLabel}</span>` : ""}
          </div>
        </button>
      `;
    }
    gridHtml += "</div>";
    board.innerHTML = `${weekdaysHtml}${gridHtml}`;
    syncSelectedCalendarCard();
    applyCalendarFilter();
  }

  function notify() {
    window.dispatchEvent(
      new CustomEvent("hours:settings-changed", {
        detail: {
          settings: deepClone(state.settings),
        },
      })
    );
    state.listeners.forEach((listener) => listener(deepClone(state.settings)));
  }

  function applySettings(nextSettings, previousSettings = null) {
    const previous = previousSettings || deepClone(state.settings);
    state.settings = deepClone(nextSettings);
    applyTheme(state.settings.theme);
    applyAccentColor(state.settings.accentColor);
    applyAnimations(state.settings.animations);
    root.dataset.compact = state.settings.compactMode ? "true" : "false";
    syncControls();
    updateEntryDefaults(previous);
    updateCockpit();
    renderCalendar();
    notify();
  }

  async function persistSettings(payload, reset = false) {
    const response = await fetch(reset ? "/api/settings/reset" : "/api/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reset ? { _csrf: state.csrfToken } : { ...payload, _csrf: state.csrfToken }),
    });
    if (!response.ok) {
      throw new Error(`Unable to persist settings: ${response.status}`);
    }
    const data = await response.json();
    return data && data.settings ? data.settings : state.settings;
  }

  async function savePatch(patch) {
    const optimisticSettings = { ...state.settings, ...patch };
    if (patch.notifications) {
      optimisticSettings.notifications = patch.notifications;
    }
    if (patch.onboarding) {
      optimisticSettings.onboarding = patch.onboarding;
    }
    applySettings(optimisticSettings, state.settings);
    const persistedSettings = await persistSettings(patch, false);
    applySettings(persistedSettings, optimisticSettings);
    return deepClone(state.settings);
  }

  async function resetSettings() {
    const persistedSettings = await persistSettings({}, true);
    applySettings(persistedSettings, state.settings);
    return deepClone(state.settings);
  }

  function buildPatchFromControl(element) {
    const key = element.dataset.settingKey || "";
    const subkey = element.dataset.settingSubkey || "";
    if (!key) {
      return null;
    }
    if (key === "notifications" && subkey && element instanceof HTMLInputElement) {
      return {
        notifications: {
          ...(state.settings.notifications || {}),
          [subkey]: element.checked,
        },
      };
    }
    if (key === "dailyGoal" && element instanceof HTMLInputElement) {
      return { dailyGoal: parseMinutes(element.value, state.settings.dailyGoal) };
    }
    if (key === "defaultPause" && element instanceof HTMLInputElement) {
      return { defaultPause: parseMinutes(element.value, state.settings.defaultPause) };
    }
    if (key === "compactMode" && element instanceof HTMLSelectElement) {
      return { compactMode: element.value === "true" };
    }
    if ("value" in element) {
      return { [key]: element.value };
    }
    return null;
  }

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches("[data-setting-key]")) {
      return;
    }
    const patch = buildPatchFromControl(target);
    if (!patch) {
      return;
    }
    const optimisticSettings = { ...state.settings, ...patch };
    if (patch.notifications) {
      optimisticSettings.notifications = patch.notifications;
    }
    try {
      await savePatch(patch);
    } catch (error) {
      console.error(error);
    }
  });

  document.addEventListener("click", async (event) => {
    const resetButton = event.target instanceof HTMLElement ? event.target.closest("[data-settings-reset]") : null;
    if (resetButton) {
      try {
        await resetSettings();
      } catch (error) {
        console.error(error);
      }
      return;
    }

    const calendarCard = event.target instanceof HTMLElement ? event.target.closest("[data-calendar-day]") : null;
    if (!calendarCard) {
      return;
    }
    const dateInput = document.getElementById("date");
    if (!dateInput) {
      return;
    }
    const nextDate = calendarCard.dataset.date || "";
    if (!nextDate) {
      return;
    }
    dateInput.value = nextDate;
    dateInput.dispatchEvent(new Event("input", { bubbles: true }));
    dateInput.dispatchEvent(new Event("change", { bubbles: true }));
    syncSelectedCalendarCard();
    updateCockpit();
  });

  document.querySelectorAll("[data-day-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      window.requestAnimationFrame(applyCalendarFilter);
    });
  });

  const dateInput = document.getElementById("date");
  if (dateInput) {
    dateInput.addEventListener("input", () => {
      syncSelectedCalendarCard();
      updateCockpit();
    });
    dateInput.addEventListener("change", () => {
      syncSelectedCalendarCard();
      updateCockpit();
    });
  }

  window.hoursSettingsStore = {
    getSettings() {
      return deepClone(state.settings);
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    apply(settings) {
      applySettings(settings, state.settings);
    },
    async savePatch(patch) {
      return savePatch(patch);
    },
    async reset() {
      return resetSettings();
    },
  };

  applySettings(state.settings);
})();
