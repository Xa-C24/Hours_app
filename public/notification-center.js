(() => {
  const READ_STORAGE_PREFIX = "hours:notifications:read";
  const TOAST_STORAGE_PREFIX = "hours:notifications:toast";
  const RECENT_DRAFT_WINDOW_DAYS = 3;

  function formatIsoDate(date) {
    return [
      String(date.getFullYear()).padStart(4, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function parseIsoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function formatMinutesAsHHMM(minutes) {
    const safeMinutes = Math.max(0, Number(minutes) || 0);
    const hours = Math.floor(safeMinutes / 60);
    const remainder = safeMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function createScopedStorageKey(prefix, username, clientId) {
    return `${prefix}:${String(username || "anonymous").trim()}:${String(clientId || "").trim()}`;
  }

  function getDayLabel(isoDate) {
    const parsed = parseIsoDate(isoDate);
    if (!parsed) {
      return isoDate;
    }
    return parsed.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  function getWeekdayIndex(isoDate) {
    const parsed = parseIsoDate(isoDate);
    return parsed ? parsed.getDay() : null;
  }

  function isPastExpectedWorkday(isoDate, todayIso) {
    const day = getWeekdayIndex(isoDate);
    return Boolean(day !== null && day !== 0 && day !== 6 && isoDate < todayIso);
  }

  function isWorkedDayRecord(record) {
    if (typeof record?.is_worked_day === "boolean") {
      return record.is_worked_day;
    }
    const dayType = String(record?.day_type || record?.dayType || "").trim();
    return dayType === "office" || dayType === "remote";
  }

  function timeToMinutes(value) {
    if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      return null;
    }
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function isIncompleteWorkRecord(record) {
    if (!isWorkedDayRecord(record)) {
      return false;
    }
    const arrival = String(record.arrival_time ?? record.arrivalTime ?? "").trim();
    const departure = String(record.departure_time ?? record.departureTime ?? "").trim();
    if (Boolean(arrival) !== Boolean(departure)) {
      return true;
    }
    if (!arrival && !departure) {
      return false;
    }
    const arrivalMinutes = timeToMinutes(arrival);
    const departureMinutes = timeToMinutes(departure);
    if (arrivalMinutes === null || departureMinutes === null || departureMinutes <= arrivalMinutes) {
      return true;
    }
    const pause = Number(record.lunch_break_minutes ?? record.lunchBreakMinutes ?? 0);
    const expectedWorkedMinutes = departureMinutes - arrivalMinutes - (Number.isFinite(pause) ? pause : 0);
    if (expectedWorkedMinutes < 0) {
      return true;
    }
    const workedMinutes = Number(record.worked_minutes);
    return Number.isFinite(workedMinutes) && Math.abs(workedMinutes - expectedWorkedMinutes) > 1;
  }

  function getWeekStart(date) {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return weekStart;
  }

  function collectDrafts(storage, username, clientId, todayIso) {
    const drafts = [];
    const todayDate = parseIsoDate(todayIso);
    if (!storage || !todayDate) {
      return drafts;
    }
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith("hours:draft:")) {
        continue;
      }
      try {
        const rawValue = storage.getItem(key);
        if (!rawValue) {
          continue;
        }
        const draft = JSON.parse(rawValue);
        if (String(draft.clientId || "").trim() !== String(clientId || "").trim()) {
          continue;
        }
        const workDate = String(draft.workDate || "").trim();
        const draftDate = parseIsoDate(workDate);
        if (!draftDate) {
          continue;
        }
        const dayDiff = Math.floor((todayDate - draftDate) / 86400000);
        if (dayDiff < 0 || dayDiff > RECENT_DRAFT_WINDOW_DAYS) {
          continue;
        }
        drafts.push(draft);
      } catch (error) {
        // Ignore malformed local drafts.
      }
    }
    return drafts.sort((left, right) => String(right.workDate || "").localeCompare(String(left.workDate || "")));
  }

  function buildNotifications({ entries = [], settings = {}, todayIso, payPeriodStartDate = "", payPeriodEndDate = "", drafts = [] }) {
    const notifications = [];
    const entriesByDate = new Map(entries.map((entry) => [entry.work_date, entry]));
    const notificationsSettings = settings.notifications || {};
    const dailyGoal = Math.max(0, Number(settings.dailyGoal || 0));

    if (notificationsSettings.missingEntry && payPeriodStartDate && payPeriodEndDate && todayIso) {
      const startDate = parseIsoDate(payPeriodStartDate);
      const endDate = parseIsoDate(payPeriodEndDate);
      const todayDate = parseIsoDate(todayIso);
      if (startDate && endDate && todayDate) {
        const effectiveEnd = endDate < todayDate ? endDate : todayDate;
        for (let cursor = new Date(effectiveEnd); cursor >= startDate; cursor.setDate(cursor.getDate() - 1)) {
          const isoDate = formatIsoDate(cursor);
          if (!isPastExpectedWorkday(isoDate, todayIso) || entriesByDate.has(isoDate)) {
            continue;
          }
          notifications.push({
            id: `missing-entry:${isoDate}`,
            type: "warning",
            title: "Journée oubliée",
            message: `Aucune saisie pour ${getDayLabel(isoDate)}.`,
            category: "missingEntry",
            date: isoDate,
            important: true,
          });
          break;
        }
      }
    }

    if (notificationsSettings.incompleteEntry && todayIso) {
      const incompleteEntry = entries
        .filter((entry) => entry.work_date && entry.work_date < todayIso && isIncompleteWorkRecord(entry))
        .sort((left, right) => String(right.work_date).localeCompare(String(left.work_date)))[0];
      if (incompleteEntry) {
        notifications.push({
          id: `incomplete-entry:${incompleteEntry.work_date}`,
          type: "warning",
          title: "Journée incomplète",
          message: `Les horaires de ${getDayLabel(incompleteEntry.work_date)} sont incomplets ou incohérents.`,
          category: "incompleteEntry",
          date: incompleteEntry.work_date,
          important: true,
        });
      }
    }

    let weekTargetMinutes = 0;
    let elapsedWeekTargetMinutes = 0;
    let weekWorkedMinutes = 0;
    if (todayIso) {
      const weekday = getWeekdayIndex(todayIso);
      const todayDate = parseIsoDate(todayIso);
      if (weekday !== null && todayDate) {
        const weekStart = getWeekStart(todayDate);
        const weekFriday = new Date(weekStart);
        weekFriday.setDate(weekStart.getDate() + 4);
        const periodStart = parseIsoDate(payPeriodStartDate);
        const periodEnd = parseIsoDate(payPeriodEndDate);
        for (let cursor = new Date(weekStart); cursor <= weekFriday; cursor.setDate(cursor.getDate() + 1)) {
          const isoDate = formatIsoDate(cursor);
          if ((periodStart && cursor < periodStart) || (periodEnd && cursor > periodEnd)) {
            continue;
          }
          const entry = entriesByDate.get(isoDate);
          if (!entry || isWorkedDayRecord(entry)) {
            weekTargetMinutes += dailyGoal;
            if (cursor <= todayDate) {
              elapsedWeekTargetMinutes += dailyGoal;
            }
          }
        }
        weekWorkedMinutes = entries
          .filter((entry) => entry.work_date >= formatIsoDate(weekStart) && entry.work_date <= formatIsoDate(weekFriday))
          .reduce((sum, entry) => sum + Number(entry.worked_minutes || 0), 0);

        if (notificationsSettings.weeklyRisk && weekday === 5 && weekTargetMinutes > weekWorkedMinutes) {
          const remainingMinutes = weekTargetMinutes - weekWorkedMinutes;
          notifications.push({
            id: `weekly-risk:${todayIso}`,
            type: "warning",
            title: "Objectif hebdomadaire en risque",
            message: `Il manque ${formatMinutesAsHHMM(remainingMinutes)} pour atteindre l'objectif de la semaine.`,
            category: "weeklyRisk",
            date: todayIso,
            important: true,
          });
        }

        const weeklyOvertimeMinutes = Math.max(0, weekWorkedMinutes - elapsedWeekTargetMinutes);
        const threshold = Math.max(15, Number(notificationsSettings.weeklyOvertimeThreshold || 0));
        if (notificationsSettings.weeklyOvertime && weeklyOvertimeMinutes >= threshold) {
          notifications.push({
            id: `weekly-overtime:${formatIsoDate(weekStart)}`,
            type: "info",
            title: "Seuil d'heures supplémentaires atteint",
            message: `${formatMinutesAsHHMM(weeklyOvertimeMinutes)} d'heures supplémentaires cette semaine.`,
            category: "weeklyOvertime",
            date: todayIso,
            important: true,
          });
        }
      }
    }

    const incompleteDraftDates = new Set();
    if (notificationsSettings.incompleteEntry) {
      drafts.filter(isIncompleteWorkRecord).forEach((draft) => {
        const draftDate = String(draft.workDate || "").trim();
        incompleteDraftDates.add(draftDate);
        notifications.push({
          id: `incomplete-draft:${draftDate}`,
          type: "warning",
          title: "Journée incomplète",
          message: `Le brouillon de ${getDayLabel(draftDate)} contient des horaires incomplets ou incohérents.`,
          category: "incompleteEntry",
          date: draftDate,
          important: draftDate === todayIso,
        });
      });
    }

    if (notificationsSettings.unsavedDraft) drafts.forEach((draft) => {
      const draftDate = String(draft.workDate || "").trim();
      if (incompleteDraftDates.has(draftDate)) {
        return;
      }
      notifications.push({
        id: `draft:${draftDate}`,
        type: "info",
        title: "Brouillon non enregistre",
        message: `Un brouillon local est disponible pour ${getDayLabel(draftDate)}.`,
        category: "draft",
        date: draftDate,
        important: draftDate === todayIso,
      });
    });

    if (notificationsSettings.periodEnding && todayIso && payPeriodStartDate && payPeriodEndDate) {
      const startDate = parseIsoDate(payPeriodStartDate);
      const endDate = parseIsoDate(payPeriodEndDate);
      const todayDate = parseIsoDate(todayIso);
      if (startDate && endDate && todayDate) {
        const daysUntilEnd = Math.floor((endDate - todayDate) / 86400000);
        if (daysUntilEnd >= 0 && daysUntilEnd <= 2) {
          let pendingCount = 0;
          const latestPastDay = new Date(todayDate);
          latestPastDay.setDate(latestPastDay.getDate() - 1);
          for (let cursor = new Date(startDate); cursor <= latestPastDay && cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
            const isoDate = formatIsoDate(cursor);
            if (!isPastExpectedWorkday(isoDate, todayIso)) {
              continue;
            }
            const entry = entriesByDate.get(isoDate);
            if (!entry || isIncompleteWorkRecord(entry)) {
              pendingCount += 1;
            }
          }
          if (pendingCount > 0) {
            notifications.push({
              id: `period-ending:${payPeriodEndDate}`,
              type: "warning",
              title: "Fin de période proche",
              message: `${pendingCount} journée${pendingCount > 1 ? "s" : ""} à compléter avant le ${getDayLabel(payPeriodEndDate)}.`,
              category: "periodEnding",
              date: todayIso,
              important: true,
            });
          }
        }
      }
    }

    return notifications.sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  }

  function createReadStateStore(storage, username, clientId) {
    const key = createScopedStorageKey(READ_STORAGE_PREFIX, username, clientId);
    return {
      get() {
        try {
          const raw = storage.getItem(key);
          const parsed = raw ? JSON.parse(raw) : [];
          return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
          return [];
        }
      },
      set(ids) {
        storage.setItem(key, JSON.stringify(Array.isArray(ids) ? ids : []));
      },
    };
  }

  function createToastHistoryStore(storage, username, clientId) {
    const key = createScopedStorageKey(TOAST_STORAGE_PREFIX, username, clientId);
    return {
      get() {
        try {
          const raw = storage.getItem(key);
          const parsed = raw ? JSON.parse(raw) : [];
          return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
          return [];
        }
      },
      set(ids) {
        storage.setItem(key, JSON.stringify(Array.isArray(ids) ? ids : []));
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      READ_STORAGE_PREFIX,
      TOAST_STORAGE_PREFIX,
      RECENT_DRAFT_WINDOW_DAYS,
      createScopedStorageKey,
      isPastExpectedWorkday,
      collectDrafts,
      buildNotifications,
      createReadStateStore,
      createToastHistoryStore,
    };
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  window.hoursNotificationCenter = {
    collectDrafts,
    buildNotifications,
    createReadStateStore,
    createToastHistoryStore,
  };

  const bootstrapElement = document.getElementById("hours-settings-bootstrap");
  const menu = document.querySelector("[data-notifications-menu]");
  const badge = document.querySelector("[data-notifications-badge]");
  const list = document.querySelector("[data-notifications-list]");
  const empty = document.querySelector("[data-notifications-empty]");
  const readAllButton = document.querySelector("[data-notifications-read-all]");
  const trigger = menu ? menu.querySelector("summary") : null;

  if (!bootstrapElement || !(menu instanceof HTMLElement) || !(badge instanceof HTMLElement) || !(list instanceof HTMLElement) || !(empty instanceof HTMLElement) || !(readAllButton instanceof HTMLElement) || !(trigger instanceof HTMLElement)) {
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
  const username = menu.dataset.notificationsUser || "anonymous";
  const clientId = menu.dataset.notificationsClient || "";
  const readStateStore = createReadStateStore(window.localStorage, username, clientId);
  const toastHistoryStore = createToastHistoryStore(window.localStorage, username, clientId);
  const state = {
    settings: bootstrap.settings || {},
    entries: Array.isArray(bootstrap.entries) ? bootstrap.entries : [],
    payPeriodStartDate: bootstrap.payPeriodStartDate || "",
    payPeriodEndDate: bootstrap.payPeriodEndDate || "",
    todayIso: formatIsoDate(new Date()),
    notifications: [],
    readIds: readStateStore.get(),
    toastedIds: toastHistoryStore.get(),
  };

  function computeNotifications() {
    const drafts = collectDrafts(window.localStorage, username, clientId, state.todayIso);
    state.notifications = buildNotifications({
      entries: state.entries,
      settings: state.settings,
      todayIso: state.todayIso,
      payPeriodStartDate: state.payPeriodStartDate,
      payPeriodEndDate: state.payPeriodEndDate,
      drafts,
    });
  }

  function isRead(notificationId) {
    return state.readIds.includes(notificationId);
  }

  function persistReadIds() {
    readStateStore.set(state.readIds);
  }

  function persistToastedIds() {
    toastHistoryStore.set(state.toastedIds);
  }

  function setReadState(notificationId, read) {
    if (!notificationId || isRead(notificationId) === read) {
      return;
    }
    state.readIds = read
      ? [...state.readIds, notificationId]
      : state.readIds.filter((readId) => readId !== notificationId);
    persistReadIds();
    render();
  }

  function markAllAsRead() {
    state.readIds = state.notifications.map((notification) => notification.id);
    persistReadIds();
    render();
  }

  function render() {
    const unreadCount = state.notifications.filter((notification) => !isRead(notification.id)).length;
    badge.textContent = String(unreadCount);
    badge.hidden = unreadCount === 0;
    readAllButton.hidden = unreadCount === 0;
    list.innerHTML = "";
    empty.hidden = state.notifications.length !== 0;
    if (state.notifications.length === 0) {
      return;
    }

    state.notifications.forEach((notification) => {
      const item = document.createElement("article");
      const read = isRead(notification.id);
      item.className = `notification-item is-${notification.type}${read ? " is-read" : ""}`;
      item.innerHTML = `
        <div class="notification-item-copy">
          <strong>${notification.title}</strong>
          <p>${notification.message}</p>
        </div>
        <label class="notification-item-check" title="Cocher cette notification comme traitée">
          <input type="checkbox" data-notification-id="${notification.id}" ${read ? "checked" : ""} aria-label="Notification traitée" />
        </label>
      `;
      list.appendChild(item);
    });
  }

  function maybeToastImportantNotifications() {
    const nextNotification = state.notifications.find(
      (notification) => notification.important && !isRead(notification.id) && !state.toastedIds.includes(notification.id)
    );
    if (!nextNotification || typeof window.showToast !== "function") {
      return;
    }
    window.showToast({
      type: nextNotification.type === "warning" ? "warning" : "info",
      message: nextNotification.message,
      duration: 4200,
    });
    state.toastedIds = [...state.toastedIds, nextNotification.id];
    persistToastedIds();
  }

  function refresh() {
    computeNotifications();
    render();
    maybeToastImportantNotifications();
  }

  list.addEventListener("change", (event) => {
    const checkbox = event.target instanceof HTMLInputElement ? event.target.closest("[data-notification-id]") : null;
    if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== "checkbox") {
      return;
    }
    setReadState(checkbox.dataset.notificationId || "", checkbox.checked);
  });

  readAllButton.addEventListener("click", () => {
    markAllAsRead();
  });

  menu.addEventListener("toggle", () => {
    if (menu.open) {
      refresh();
    }
  });

  window.addEventListener("hours:settings-changed", (event) => {
    const nextSettings = event instanceof CustomEvent && event.detail ? event.detail.settings : null;
    if (nextSettings) {
      state.settings = nextSettings;
      refresh();
    }
  });

  window.addEventListener("hours:drafts-changed", refresh);
  window.addEventListener("app:entry-saved", refresh);

  refresh();
})();
