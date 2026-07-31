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

  function formatOvertimeLabel(minutes) {
    const safeMinutes = Math.max(0, Number(minutes) || 0);
    if (!safeMinutes) {
      return "";
    }
    const hours = Math.floor(safeMinutes / 60);
    const remainder = safeMinutes % 60;
    return hours > 0 ? `${hours}h${String(remainder).padStart(2, "0")}` : `${remainder}mn`;
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

  function formatCalendarTimeCompact(timeValue) {
    if (typeof timeValue !== "string" || !/^\d{2}:\d{2}$/.test(timeValue)) {
      return "";
    }
    const [hours, minutes] = timeValue.split(":");
    return `${Number(hours)}h${minutes}`;
  }

  function escapeCalendarHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeHtmlAttribute(value) {
    return escapeCalendarHtml(value).replace(/\r?\n/g, "&#10;");
  }

  function formatCalendarWorkSlot(entry) {
    if (!entry || !entry.is_worked_day) {
      return { text: "", html: "" };
    }
    const startLabel = formatCalendarTimeCompact(entry.arrival_time_display);
    const endLabel = formatCalendarTimeCompact(entry.departure_time_display);
    const pauseValue = Number(entry.lunch_break_minutes_display);
    const overtimeValue = Number(entry.overtime_minutes || 0);
    const pauseText = Number.isFinite(pauseValue) ? ` pause ${pauseValue}mn` : "";
    const overtimeText = overtimeValue > 0 ? ` +${overtimeValue} min sup` : "";
    const pauseHtml = Number.isFinite(pauseValue)
      ? `<span class="calendar-break-line"><span class="calendar-break-badge" aria-hidden="true">⏸</span><span class="calendar-break-value">${pauseValue}mn</span></span>`
      : "";
    const overtimeHtml = overtimeValue > 0
      ? `<span class="calendar-overtime-inline">+${escapeCalendarHtml(String(overtimeValue))} min sup</span>`
      : "";
    if (!startLabel || !endLabel) {
      const fallback = entry.worked_hhmm || "";
      return {
        text: `${fallback}${overtimeText}`,
        html: `${escapeCalendarHtml(fallback)}${overtimeHtml}`,
      };
    }
    return {
      text: `${startLabel}-${endLabel}${pauseText}${overtimeText}`,
      html: `<span class="calendar-work-slot">${escapeCalendarHtml(startLabel)}-${escapeCalendarHtml(endLabel)}</span>${pauseHtml}${overtimeHtml}`,
    };
  }

  function buildCalendarTooltipText({ dateLabel, entry, stateLabel, fallbackCompanyNameValue }) {
    const lines = [dateLabel];
    if (entry && entry.is_worked_day) {
      lines.push(`${entry.arrival_time_display || ""} -> ${entry.departure_time_display || ""}`);
      lines.push(`Pause ${entry.lunch_break_minutes_display ?? ""} min`);
      if (Number(entry.overtime_minutes || 0) > 0) {
        lines.push(`Heures sup +${Number(entry.overtime_minutes || 0)} min`);
      }
    } else {
      lines.push(stateLabel);
    }
    if (fallbackCompanyNameValue) {
      lines.push(fallbackCompanyNameValue);
    }
    if (entry && typeof entry.comment_text === "string" && entry.comment_text.trim()) {
      lines.push(entry.comment_text.trim());
    }
    return lines.filter(Boolean).join("\n");
  }

  let calendarHoverTooltip = null;
  let activeCalendarHoverCard = null;
  let calendarHoverTooltipFrame = 0;
  let lastPointerClientX = -1;
  let lastPointerClientY = -1;

  function ensureCalendarHoverTooltip() {
    if (calendarHoverTooltip) {
      return calendarHoverTooltip;
    }
    const tooltip = document.createElement("div");
    tooltip.className = "calendar-hover-tooltip";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    calendarHoverTooltip = tooltip;
    return tooltip;
  }

  function setCalendarHoverTooltipPosition(clientX, clientY) {
    const tooltip = ensureCalendarHoverTooltip();
    const offset = 16;
    const rect = tooltip.getBoundingClientRect();
    let left = clientX + offset;
    let top = clientY + offset;
    if (left + rect.width > window.innerWidth - 12) {
      left = clientX - rect.width - offset;
    }
    if (top + rect.height > window.innerHeight - 12) {
      top = clientY - rect.height - offset;
    }
    tooltip.style.left = `${Math.max(12, left)}px`;
    tooltip.style.top = `${Math.max(12, top)}px`;
  }

  function showCalendarHoverTooltip(text, anchor) {
    if (typeof text !== "string" || !text.trim()) {
      return;
    }
    const tooltip = ensureCalendarHoverTooltip();
    tooltip.innerHTML = "";
    text.split(/\r?\n/).filter(Boolean).forEach((line, index) => {
      const row = document.createElement(index === 0 ? "strong" : "span");
      row.textContent = line;
      tooltip.appendChild(row);
    });
    tooltip.hidden = false;
    tooltip.dataset.visible = "true";
    ensureCalendarHoverTooltipWatcher();
    if (anchor instanceof MouseEvent) {
      setCalendarHoverTooltipPosition(anchor.clientX, anchor.clientY);
      return;
    }
    if (anchor instanceof HTMLElement) {
      const rect = anchor.getBoundingClientRect();
      setCalendarHoverTooltipPosition(rect.right, rect.top + rect.height / 2);
    }
  }

  function hideCalendarHoverTooltip() {
    activeCalendarHoverCard = null;
    if (calendarHoverTooltipFrame) {
      window.cancelAnimationFrame(calendarHoverTooltipFrame);
      calendarHoverTooltipFrame = 0;
    }
    if (!calendarHoverTooltip) {
      return;
    }
    calendarHoverTooltip.hidden = true;
    calendarHoverTooltip.dataset.visible = "false";
  }

  function ensureCalendarHoverTooltipWatcher() {
    if (calendarHoverTooltipFrame) {
      return;
    }
    const tick = () => {
      const hoveredElement =
        lastPointerClientX >= 0 && lastPointerClientY >= 0
          ? document.elementFromPoint(lastPointerClientX, lastPointerClientY)
          : null;
      const hoveredCalendarCard =
        hoveredElement instanceof HTMLElement
          ? hoveredElement.closest("[data-calendar-day]")
          : null;
      if (
        !activeCalendarHoverCard ||
        !activeCalendarHoverCard.isConnected ||
        (document.activeElement !== activeCalendarHoverCard && hoveredCalendarCard !== activeCalendarHoverCard)
      ) {
        hideCalendarHoverTooltip();
        return;
      }
      calendarHoverTooltipFrame = window.requestAnimationFrame(tick);
    };
    calendarHoverTooltipFrame = window.requestAnimationFrame(tick);
  }

  function bindCalendarHoverTooltips() {
    const payPeriodCard = document.querySelector("[data-pay-period-card]");
    if (payPeriodCard instanceof HTMLElement && payPeriodCard.dataset.tooltipScopeBound !== "true") {
      payPeriodCard.dataset.tooltipScopeBound = "true";
      payPeriodCard.addEventListener("mouseleave", () => {
        hideCalendarHoverTooltip();
      });
      payPeriodCard.addEventListener("pointerleave", () => {
        hideCalendarHoverTooltip();
      });
    }
    document.querySelectorAll("[data-calendar-day]").forEach((card) => {
      if (!(card instanceof HTMLElement) || card.dataset.tooltipBound === "true") {
        return;
      }
      card.dataset.tooltipBound = "true";
      const tooltipText = card.dataset.hoverTooltip || "";
      if (!tooltipText.trim()) {
        return;
      }
      card.addEventListener("mouseenter", (event) => {
        activeCalendarHoverCard = card;
        showCalendarHoverTooltip(tooltipText, event);
      });
      card.addEventListener("mousemove", (event) => {
        activeCalendarHoverCard = card;
        showCalendarHoverTooltip(tooltipText, event);
      });
      card.addEventListener("pointerenter", (event) => {
        activeCalendarHoverCard = card;
        showCalendarHoverTooltip(tooltipText, event);
      });
      card.addEventListener("mouseleave", () => {
        hideCalendarHoverTooltip();
      });
      card.addEventListener("pointerleave", () => {
        hideCalendarHoverTooltip();
      });
      card.addEventListener("focus", () => {
        activeCalendarHoverCard = card;
        showCalendarHoverTooltip(tooltipText, card);
      });
      card.addEventListener("blur", () => {
        hideCalendarHoverTooltip();
      });
    });
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
          meta: Number(entry.overtime_minutes || 0) > 0
            ? `${formatMinutes(entry.target_minutes || 0)} + ${formatOvertimeLabel(entry.overtime_minutes)} sup`
            : (entry.worked_hhmm || ""),
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
  const fallbackCompanyName =
    typeof bootstrap.fallbackCompanyName === "string" ? bootstrap.fallbackCompanyName.trim() : "";

  const root = document.documentElement;

  function getEffectiveProfileName() {
    return state.settings.profileName || bootstrap.authUser || "Votre espace";
  }

  function getEffectiveCompanyName() {
    return state.settings.companyName || fallbackCompanyName;
  }

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

  function applyFontSize(mode) {
    root.dataset.fontSize = mode;
    if (mode === "compact") {
      root.style.fontSize = "15px";
      return;
    }
    if (mode === "large") {
      root.style.fontSize = "17px";
      return;
    }
    root.style.fontSize = "16px";
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("hours_theme", theme);
    } catch (error) {
      // Ignore browser storage restrictions.
    }
  }

  function syncProfileSurface() {
    const effectiveProfileName = getEffectiveProfileName();
    const effectiveCompanyName = getEffectiveCompanyName();
    const effectiveRole = state.settings.profileRole || "";
    const effectiveEmail = state.settings.profileEmail || "";
    const avatarArt = document.querySelector("[data-settings-avatar-art]");
    const summaryTarget = document.querySelector("[data-settings-profile-summary]");
    const photoStatusTarget = document.querySelector("[data-settings-photo-status]");
    const photoFieldTarget = document.querySelector("[data-settings-photo-field]");
    const securityUserTarget = document.querySelector("[data-settings-security-user]");
    const securityEmailTarget = document.querySelector("[data-settings-security-email]");
    const cockpitProfileNameTarget = document.querySelector("[data-settings-cockpit-profile-name]");
    const cockpitCompanyTarget = document.querySelector("[data-settings-cockpit-company]");
    const cockpitProfileMedia = document.querySelector("[data-cockpit-profile-media]");

    document.querySelectorAll("[data-settings-profile-name]").forEach((target) => {
      target.textContent = effectiveProfileName;
    });

    if (summaryTarget) {
      const summaryParts = [effectiveCompanyName, effectiveRole].filter(Boolean);
      summaryTarget.textContent = summaryParts.length
        ? summaryParts.join(" · ")
        : "Préparez votre photo, votre signature visuelle et les métadonnées visibles dans l'application.";
    }

    if (photoStatusTarget) {
      photoStatusTarget.textContent = state.settings.profilePhoto ? "Photo enregistrée" : "Aucune photo importée";
    }
    if (photoFieldTarget instanceof HTMLInputElement) {
      photoFieldTarget.value = state.settings.profilePhoto ? "Photo importée" : "Aucune photo importée";
    }
    if (securityUserTarget) {
      securityUserTarget.textContent = effectiveProfileName;
    }
    if (securityEmailTarget) {
      securityEmailTarget.textContent = effectiveEmail || "Non renseignée";
    }
    if (cockpitProfileNameTarget) {
      cockpitProfileNameTarget.textContent = effectiveProfileName ? `Bonjour ${effectiveProfileName}` : "Bonjour";
    }
    if (cockpitCompanyTarget) {
      const payPeriodLabel = bootstrap.payPeriodLabel || bootstrap.selectedMonth || "";
      cockpitCompanyTarget.textContent = [effectiveCompanyName, payPeriodLabel].filter(Boolean).join(" · ");
    }

    if (!(avatarArt instanceof HTMLElement)) {
      if (cockpitProfileMedia instanceof HTMLElement) {
        cockpitProfileMedia.classList.toggle("has-image", Boolean(state.settings.profilePhoto));
        cockpitProfileMedia.innerHTML = state.settings.profilePhoto
          ? `<img src="${state.settings.profilePhoto}" alt="Photo de profil">`
          : `<span>${(effectiveProfileName || effectiveCompanyName || "H").slice(0, 1).toUpperCase()}</span>`;
      }
      return;
    }

    if (state.settings.profilePhoto) {
      avatarArt.innerHTML = `<img src="${state.settings.profilePhoto}" alt="">`;
      avatarArt.classList.add("has-image");
      if (cockpitProfileMedia instanceof HTMLElement) {
        cockpitProfileMedia.classList.add("has-image");
        cockpitProfileMedia.innerHTML = `<img src="${state.settings.profilePhoto}" alt="Photo de profil">`;
      }
      return;
    }

    avatarArt.classList.remove("has-image");
    if (cockpitProfileMedia instanceof HTMLElement) {
      cockpitProfileMedia.classList.remove("has-image");
    }
    const avatarStyle = state.settings.avatarStyle || "monogram";
    if (avatarStyle === "illustration") {
      avatarArt.textContent = "🙂";
      if (cockpitProfileMedia instanceof HTMLElement) {
        cockpitProfileMedia.innerHTML = "<span>🙂</span>";
      }
      return;
    }
    if (avatarStyle === "logo") {
      avatarArt.textContent = (effectiveCompanyName || effectiveProfileName).slice(0, 1).toUpperCase() || "H";
      if (cockpitProfileMedia instanceof HTMLElement) {
        cockpitProfileMedia.innerHTML = `<span>${(effectiveCompanyName || effectiveProfileName).slice(0, 1).toUpperCase() || "H"}</span>`;
      }
      return;
    }
    avatarArt.textContent = effectiveProfileName.slice(0, 1).toUpperCase() || "H";
    if (cockpitProfileMedia instanceof HTMLElement) {
      cockpitProfileMedia.innerHTML = `<span>${effectiveProfileName.slice(0, 1).toUpperCase() || "H"}</span>`;
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
    syncCustomSelectUi();
  }

  function ensureCustomSelects() {
    document.querySelectorAll("select.form-select, .theme-picker select").forEach((select) => {
      if (!(select instanceof HTMLSelectElement)) {
        return;
      }
      if (select.multiple || select.hidden || select.dataset.nativeSelect === "true") {
        return;
      }
      if (select.parentElement && select.parentElement.classList.contains("app-custom-select")) {
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "app-custom-select";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "app-custom-select-trigger";
      trigger.setAttribute("data-custom-select-trigger", "");
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      trigger.innerHTML = '<span data-custom-select-label></span><span class="app-custom-select-caret" aria-hidden="true">▾</span>';

      const menu = document.createElement("div");
      menu.className = "app-custom-select-menu";
      menu.setAttribute("data-custom-select-menu", "");
      menu.setAttribute("role", "listbox");
      menu.hidden = true;

      Array.from(select.options).forEach((option) => {
        const optionButton = document.createElement("button");
        optionButton.type = "button";
        optionButton.className = "app-custom-select-option";
        optionButton.setAttribute("data-custom-select-option", "");
        optionButton.setAttribute("data-value", option.value);
        optionButton.setAttribute("role", "option");
        optionButton.textContent = option.textContent || "";
        menu.appendChild(optionButton);
      });

      select.parentNode.insertBefore(wrapper, select);
      wrapper.appendChild(select);
      wrapper.appendChild(trigger);
      wrapper.appendChild(menu);
      select.hidden = true;
      select.classList.add("app-custom-select-native");
    });
  }

  function syncCustomSelectUi() {
    document.querySelectorAll(".app-custom-select").forEach((wrapper) => {
      const select = wrapper.querySelector("select");
      const label = wrapper.querySelector("[data-custom-select-label]");
      if (!(select instanceof HTMLSelectElement) || !(label instanceof HTMLElement)) {
        return;
      }
      const selectedOption = select.options[select.selectedIndex];
      label.textContent = selectedOption ? selectedOption.textContent || "" : "";
      wrapper.querySelectorAll("[data-custom-select-option]").forEach((optionButton) => {
        if (!(optionButton instanceof HTMLButtonElement)) {
          return;
        }
        const isActive = optionButton.dataset.value === String(select.value);
        optionButton.classList.toggle("is-active", isActive);
        optionButton.setAttribute("aria-selected", String(isActive));
      });
    });
  }

  function closeCustomSelects() {
    document.querySelectorAll("[data-custom-select-menu]").forEach((menu) => {
      if (menu instanceof HTMLElement) {
        menu.hidden = true;
      }
    });
    document.querySelectorAll("[data-custom-select-trigger]").forEach((trigger) => {
      if (trigger instanceof HTMLElement) {
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  async function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error || new Error("read_failed"));
      reader.readAsDataURL(file);
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
      const durationLabel = formatCalendarWorkSlot(entry);
      const weekdayShort = cursor.toLocaleDateString("fr-FR", { weekday: "short" });
      const tooltipText = buildCalendarTooltipText({
        dateLabel,
        entry,
        stateLabel: stateLabel.label,
        fallbackCompanyNameValue: getEffectiveCompanyName(),
      });
      const commentHtml =
        entry && typeof entry.comment_text === "string" && entry.comment_text.trim()
          ? `<span class="calendar-day-preview-comment">${escapeCalendarHtml(entry.comment_text.trim())}</span>`
          : "";
      const companyName = getEffectiveCompanyName();
      const companyHtml = companyName
        ? `<span>${escapeCalendarHtml(companyName)}</span>`
        : "";
      const previewPrimaryHtml =
        entry && entry.is_worked_day
          ? `
            <span>${escapeCalendarHtml(entry.arrival_time_display || "")} → ${escapeCalendarHtml(entry.departure_time_display || "")}</span>
            <span>Pause ${escapeCalendarHtml(entry.lunch_break_minutes_display ?? "")} min</span>
            ${Number(entry.overtime_minutes || 0) > 0 ? `<span class="calendar-overtime-chip">+${escapeCalendarHtml(String(Number(entry.overtime_minutes || 0)))} min sup</span>` : ""}
          `
          : `<span>${escapeCalendarHtml(stateLabel.label)}</span>`;
      gridHtml += `
        <button
          type="button"
          class="calendar-day-card is-${stateLabel.tone}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}"
          data-calendar-day
          data-date="${isoDate}"
          data-day-type="${entry ? entry.day_type || "" : (stateLabel.tone === "weekend" ? "weekend" : "empty")}"
          data-state-tone="${stateLabel.tone}"
          aria-pressed="${isSelected ? "true" : "false"}"
          data-hover-tooltip="${escapeHtmlAttribute(tooltipText)}"
          aria-label="${dateLabel} - ${stateLabel.label}${durationLabel.text ? ` - ${durationLabel.text}` : ""}"
        >
          <div class="calendar-day-card-head">
            <span class="calendar-day-weekday">${weekdayShort}</span>
            <span class="calendar-day-number">${cursor.getDate()}</span>
          </div>
          <div class="calendar-day-card-body">
            <strong class="calendar-day-duration">${durationLabel.html || " "}</strong>
            <span class="calendar-day-state">
              <span aria-hidden="true">${stateLabel.emoji}</span>
              <span>${stateLabel.meta || stateLabel.label}</span>
            </span>
          </div>
          <div class="calendar-day-preview" role="tooltip">
            <strong>${dateLabel}</strong>
            ${previewPrimaryHtml}
            ${companyHtml}
            ${commentHtml}
          </div>
        </button>
      `;
    }
    gridHtml += "</div>";
    board.innerHTML = `${weekdaysHtml}${gridHtml}`;
    syncSelectedCalendarCard();
    applyCalendarFilter();
    bindCalendarHoverTooltips();
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
    applyFontSize(state.settings.fontSize || "comfort");
    root.dataset.compact = state.settings.compactMode ? "true" : "false";
    syncControls();
    syncProfileSurface();
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

    const photoTrigger = event.target instanceof HTMLElement ? event.target.closest("[data-settings-photo-trigger]") : null;
    if (photoTrigger) {
      const uploadInput = document.querySelector('[data-settings-upload="profilePhoto"]');
      if (uploadInput instanceof HTMLInputElement) {
        uploadInput.click();
      }
      return;
    }

    const settingsAction = event.target instanceof HTMLElement ? event.target.closest("[data-settings-action]") : null;
    if (settingsAction) {
      const action = settingsAction.dataset.settingsAction || "";
      if (action === "help-bug") {
        const helpSearch = document.querySelector("[data-settings-help-search]");
        if (helpSearch instanceof HTMLInputElement) {
          helpSearch.value = "bug";
          helpSearch.dispatchEvent(new Event("input", { bubbles: true }));
          helpSearch.scrollIntoView({ behavior: "smooth", block: "center" });
          window.setTimeout(() => helpSearch.focus(), 120);
        }
        return;
      }
      if (action === "toggle-roadmap") {
        const roadmapCard = document.querySelector("[data-settings-roadmap]");
        if (roadmapCard instanceof HTMLElement) {
          roadmapCard.hidden = !roadmapCard.hidden;
          if (!roadmapCard.hidden) {
            roadmapCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }
        return;
      }
    }

    const customSelectTrigger = event.target instanceof HTMLElement ? event.target.closest("[data-custom-select-trigger]") : null;
    if (customSelectTrigger) {
      const wrapper = customSelectTrigger.closest(".app-custom-select");
      const menu = wrapper ? wrapper.querySelector("[data-custom-select-menu]") : null;
      if (wrapper instanceof HTMLElement && menu instanceof HTMLElement) {
        const willOpen = menu.hidden;
        closeCustomSelects();
        menu.hidden = !willOpen;
        customSelectTrigger.setAttribute("aria-expanded", String(willOpen));
      }
      return;
    }

    const customSelectOption = event.target instanceof HTMLElement ? event.target.closest("[data-custom-select-option]") : null;
    if (customSelectOption) {
      const wrapper = customSelectOption.closest(".app-custom-select");
      const genericSelect = wrapper ? wrapper.querySelector("select") : null;
      const genericTrigger = wrapper ? wrapper.querySelector("[data-custom-select-trigger]") : null;
      const genericMenu = wrapper ? wrapper.querySelector("[data-custom-select-menu]") : null;
      if (genericSelect instanceof HTMLSelectElement) {
        genericSelect.value = customSelectOption.dataset.value || genericSelect.value;
        genericSelect.dispatchEvent(new Event("input", { bubbles: true }));
        genericSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (genericMenu instanceof HTMLElement) {
        genericMenu.hidden = true;
      }
      if (genericTrigger instanceof HTMLElement) {
        genericTrigger.setAttribute("aria-expanded", "false");
      }
      syncCustomSelectUi();
      return;
    }

    if (!(event.target instanceof HTMLElement) || !event.target.closest(".app-custom-select")) {
      closeCustomSelects();
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

  document.addEventListener("change", async (event) => {
    const uploadInput = event.target instanceof HTMLElement ? event.target.closest("[data-settings-upload]") : null;
    if (!(uploadInput instanceof HTMLInputElement)) {
      return;
    }
    const file = uploadInput.files && uploadInput.files[0] ? uploadInput.files[0] : null;
    const key = uploadInput.dataset.settingsUpload || "";
    if (!file || !key) {
      return;
    }
    if (file.size > 1_500_000) {
      window.alert("Image trop lourde. Choisissez un fichier inférieur à 1,5 MB.");
      uploadInput.value = "";
      return;
    }
    try {
      const dataUrl = await readImageAsDataUrl(file);
      await savePatch({ [key]: dataUrl });
    } catch (error) {
      console.error(error);
    } finally {
      uploadInput.value = "";
    }
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

  bindCalendarHoverTooltips();

  document.addEventListener("mousemove", (event) => {
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;
    const withinPayPeriodCard = event.target instanceof HTMLElement
      ? event.target.closest("[data-pay-period-card]")
      : null;
    if (!withinPayPeriodCard) {
      hideCalendarHoverTooltip();
      return;
    }
    const hoveredCard = event.target instanceof HTMLElement ? event.target.closest("[data-calendar-day]") : null;
    if (!hoveredCard) {
      hideCalendarHoverTooltip();
    }
  });

  document.addEventListener("pointermove", (event) => {
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;
    const hoveredCard = event.target instanceof HTMLElement ? event.target.closest("[data-calendar-day]") : null;
    if (!hoveredCard || hoveredCard !== activeCalendarHoverCard) {
      const withinPayPeriodCard = event.target instanceof HTMLElement
        ? event.target.closest("[data-pay-period-card]")
        : null;
      if (!withinPayPeriodCard || !hoveredCard) {
        hideCalendarHoverTooltip();
      }
    }
  });

  document.addEventListener("scroll", () => {
    hideCalendarHoverTooltip();
  }, true);

  document.addEventListener("wheel", () => {
    hideCalendarHoverTooltip();
  }, { passive: true });

  document.addEventListener("mouseout", (event) => {
    const nextTarget = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
    if (!nextTarget || !nextTarget.closest("[data-calendar-day]")) {
      hideCalendarHoverTooltip();
    }
  });

  document.addEventListener("mouseleave", () => {
    hideCalendarHoverTooltip();
  });

  document.addEventListener("pointerdown", () => {
    hideCalendarHoverTooltip();
  });

  window.addEventListener("blur", () => {
    hideCalendarHoverTooltip();
  });

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
    refreshCustomSelects() {
      ensureCustomSelects();
      syncCustomSelectUi();
    },
  };

  ensureCustomSelects();
  applySettings(state.settings);
})();
