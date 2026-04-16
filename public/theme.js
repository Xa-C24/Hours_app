(() => {
  const THEME_KEY = "hours_theme";
  const ENTRY_FORM_COLLAPSED_KEY = "hours_entry_form_collapsed";
  const WEEK_ROWS_COLLAPSED_BY_MONTH_KEY = "hours_week_rows_collapsed_by_month";
  const DAY_FILTER_BY_MONTH_KEY = "hours_day_filter_by_month";
  const THEMES = [
    "light",
    "dark",
    "deep-ocean-blue",
    "light-blue",
    "orange-sunset",
    "forest-green",
    "light-green",
  ];

  function normalizeTheme(theme) {
    return THEMES.includes(theme) ? theme : "light";
  }

  function applyTheme(theme, persist = true) {
    const normalizedTheme = normalizeTheme(theme);
    document.documentElement.setAttribute("data-theme", normalizedTheme);
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, normalizedTheme);
      } catch (error) {
        // Ignore storage issues (private mode, browser policies).
      }
    }
    document.querySelectorAll("[data-theme-selector]").forEach((selector) => {
      selector.value = normalizedTheme;
    });
  }

  function initThemeSelectors() {
    document.querySelectorAll("[data-theme-selector]").forEach((selector) => {
      selector.value = normalizeTheme(
        document.documentElement.getAttribute("data-theme") || "light"
      );
      selector.addEventListener("change", (event) => {
        applyTheme(event.target.value, true);
      });
    });
  }

  function readStoredCollapsedState() {
    try {
      return localStorage.getItem(ENTRY_FORM_COLLAPSED_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function persistCollapsedState(collapsed) {
    try {
      localStorage.setItem(ENTRY_FORM_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch (error) {
      // Ignore storage issues (private mode, browser policies).
    }
  }

  function setEntryFormCollapsed(section, toggleButton, form, collapsed, persist = true) {
    section.classList.toggle("is-collapsed", collapsed);
    form.hidden = collapsed;
    toggleButton.setAttribute("aria-expanded", String(!collapsed));
    const toggleLabel = collapsed ? "Ouvrir la saisie" : "Replier la saisie";
    toggleButton.setAttribute("aria-label", toggleLabel);
    toggleButton.title = toggleLabel;
    if (persist) {
      persistCollapsedState(collapsed);
    }
  }

  function initEntryFormToggle() {
    const section = document.querySelector("[data-entry-card]");
    const toggleButton = document.querySelector("[data-entry-toggle]");
    const form = document.querySelector("[data-entry-form]");
    if (!section || !toggleButton || !form) {
      return;
    }

    setEntryFormCollapsed(
      section,
      toggleButton,
      form,
      readStoredCollapsedState(),
      false
    );

    toggleButton.addEventListener("click", () => {
      const isCollapsed = section.classList.contains("is-collapsed");
      setEntryFormCollapsed(section, toggleButton, form, !isCollapsed, true);
    });
  }

  function readWeekRowsCollapsedStore() {
    try {
      const rawValue = localStorage.getItem(WEEK_ROWS_COLLAPSED_BY_MONTH_KEY);
      if (!rawValue) {
        return {};
      }
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function persistWeekRowsCollapsedStore(store) {
    try {
      localStorage.setItem(WEEK_ROWS_COLLAPSED_BY_MONTH_KEY, JSON.stringify(store));
    } catch (error) {
      // Ignore storage issues (private mode, browser policies).
    }
  }

  function readDayFilterStore() {
    try {
      const rawValue = localStorage.getItem(DAY_FILTER_BY_MONTH_KEY);
      if (!rawValue) {
        return {};
      }
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function persistDayFilterStore(store) {
    try {
      localStorage.setItem(DAY_FILTER_BY_MONTH_KEY, JSON.stringify(store));
    } catch (error) {
      // Ignore storage issues.
    }
  }

  function readDayFilter(month) {
    if (!month) {
      return "all";
    }
    const store = readDayFilterStore();
    return typeof store[month] === "string" && store[month] ? store[month] : "all";
  }

  function persistDayFilter(month, filterValue) {
    if (!month) {
      return;
    }
    const store = readDayFilterStore();
    if (filterValue && filterValue !== "all") {
      store[month] = filterValue;
    } else {
      delete store[month];
    }
    persistDayFilterStore(store);
  }

  function getSelectedMonth() {
    const monthInput = document.getElementById("month");
    if (monthInput && typeof monthInput.value === "string" && monthInput.value) {
      return monthInput.value;
    }
    const hiddenMonthInput = document.querySelector('input[name="selectedMonth"]');
    if (
      hiddenMonthInput &&
      typeof hiddenMonthInput.value === "string" &&
      hiddenMonthInput.value
    ) {
      return hiddenMonthInput.value;
    }
    return "";
  }

  function readCollapsedWeekIndexes(month) {
    if (!month) {
      return new Set();
    }
    const store = readWeekRowsCollapsedStore();
    const rawValue = store[month];
    const indexes = Array.isArray(rawValue)
      ? rawValue
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0)
      : [];
    return new Set(indexes);
  }

  function persistCollapsedWeekIndexes(month, collapsedIndexes) {
    if (!month) {
      return;
    }
    const store = readWeekRowsCollapsedStore();
    const values = Array.from(collapsedIndexes).sort((left, right) => left - right);
    if (values.length > 0) {
      store[month] = values;
    } else {
      delete store[month];
    }
    persistWeekRowsCollapsedStore(store);
  }

  function initWeekRowsToggle() {
    const tableBody = document.querySelector("tbody");
    if (!tableBody) {
      return;
    }

    const rows = Array.from(tableBody.querySelectorAll("tr"));
    if (!rows.some((row) => row.classList.contains("week-total-row"))) {
      return;
    }

    const month = getSelectedMonth();
    const collapsedWeekIndexes = readCollapsedWeekIndexes(month);
    let pendingWeekRows = [];
    let weekIndex = 0;

    rows.forEach((row) => {
      if (!row.classList.contains("week-total-row")) {
        pendingWeekRows.push(row);
        return;
      }

      const weekRows = [...pendingWeekRows];
      const currentWeekIndex = weekIndex;
      const toggleButton = row.querySelector("[data-week-toggle]");

      const setWeekCollapsed = (collapsed, persist = true) => {
        weekRows.forEach((weekRow) => {
          weekRow.hidden = collapsed;
        });
        row.classList.toggle("is-collapsed", collapsed);
        if (toggleButton) {
          toggleButton.setAttribute("aria-expanded", String(!collapsed));
          const label = collapsed ? "Ouvrir la semaine" : "Replier la semaine";
          toggleButton.setAttribute("aria-label", label);
          toggleButton.title = label;
        }
        if (persist) {
          if (collapsed) {
            collapsedWeekIndexes.add(currentWeekIndex);
          } else {
            collapsedWeekIndexes.delete(currentWeekIndex);
          }
          persistCollapsedWeekIndexes(month, collapsedWeekIndexes);
        }
      };

      setWeekCollapsed(collapsedWeekIndexes.has(currentWeekIndex), false);

      if (toggleButton) {
        toggleButton.addEventListener("click", () => {
          const isCollapsed = row.classList.contains("is-collapsed");
          setWeekCollapsed(!isCollapsed, true);
        });
      }

      pendingWeekRows = [];
      weekIndex += 1;
    });
  }

  function initDayTypeFilter() {
    const filterBar = document.querySelector("[data-day-filter-bar]");
    const dayRows = Array.from(document.querySelectorAll("[data-day-entry-row]"));
    const weekTotalRows = Array.from(document.querySelectorAll("[data-week-total-row]"));
    const emptyRow = document.querySelector("[data-filter-empty-row]");
    if (!filterBar || dayRows.length === 0) {
      return;
    }

    const filterButtons = Array.from(filterBar.querySelectorAll("[data-day-filter]"));
    const month = getSelectedMonth();

    const applyFilter = (filterValue, persist = true) => {
      const normalizedFilter = filterButtons.some(
        (button) => button.dataset.dayFilter === filterValue
      )
        ? filterValue
        : "all";

      filterButtons.forEach((button) => {
        const isActive = button.dataset.dayFilter === normalizedFilter;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });

      const visibleWeekKeys = new Set();
      let visibleDayRowCount = 0;

      dayRows.forEach((row) => {
        const rowDayType = row.dataset.dayType || "";
        const isVisible = normalizedFilter === "all" || rowDayType === normalizedFilter;
        row.classList.toggle("is-filter-hidden", !isVisible);
        if (isVisible) {
          visibleDayRowCount += 1;
          const weekKey = row.dataset.weekKey || "";
          if (weekKey) {
            visibleWeekKeys.add(weekKey);
          }
        }
      });

      weekTotalRows.forEach((row) => {
        const weekKey = row.dataset.weekKey || "";
        const isVisible = normalizedFilter === "all" || visibleWeekKeys.has(weekKey);
        row.classList.toggle("is-filter-hidden", !isVisible);
      });

      if (emptyRow) {
        emptyRow.hidden = visibleDayRowCount !== 0;
      }

      if (persist) {
        persistDayFilter(month, normalizedFilter);
      }
    };

    const initialFilter = readDayFilter(month);
    applyFilter(initialFilter, false);

    filterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        applyFilter(button.dataset.dayFilter || "all", true);
      });
    });
  }

  function initAuthPremiumEffects() {
    if (!document.body.classList.contains("auth-premium-page")) {
      return;
    }

    const card = document.querySelector(".login-card-premium");
    if (card) {
      card.addEventListener("pointermove", (event) => {
        const bounds = card.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) * 100;
        const y = ((event.clientY - bounds.top) / bounds.height) * 100;
        card.style.setProperty("--pointer-x", `${x}%`);
        card.style.setProperty("--pointer-y", `${y}%`);
      });

      card.addEventListener("pointerleave", () => {
        card.style.removeProperty("--pointer-x");
        card.style.removeProperty("--pointer-y");
      });
    }

    document.querySelectorAll("[data-ripple]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          return;
        }

        element.classList.remove("is-pressed");
        void element.offsetWidth;
        element.classList.add("is-pressed");
        window.setTimeout(() => element.classList.remove("is-pressed"), 260);

        const bounds = element.getBoundingClientRect();
        const dot = document.createElement("span");
        dot.className = "ripple-dot";
        dot.style.left = `${event.clientX - bounds.left}px`;
        dot.style.top = `${event.clientY - bounds.top}px`;
        element.appendChild(dot);
        window.setTimeout(() => dot.remove(), 650);
      });
    });
  }

  function initHomePremiumEffects() {
    if (!document.body.classList.contains("home-premium-page")) {
      return;
    }

    document
      .querySelectorAll(".page-header-premium, .premium-surface")
      .forEach((surface) => {
        surface.addEventListener("pointermove", (event) => {
          const bounds = surface.getBoundingClientRect();
          const x = ((event.clientX - bounds.left) / bounds.width) * 100;
          const y = ((event.clientY - bounds.top) / bounds.height) * 100;
          surface.style.setProperty("--pointer-x", `${x}%`);
          surface.style.setProperty("--pointer-y", `${y}%`);
        });

        surface.addEventListener("pointerleave", () => {
          surface.style.removeProperty("--pointer-x");
          surface.style.removeProperty("--pointer-y");
        });
      });

    document.querySelectorAll(".home-premium-page [data-ripple]").forEach((element) => {
      element.addEventListener("pointerdown", (event) => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          return;
        }

        element.classList.remove("is-pressed");
        void element.offsetWidth;
        element.classList.add("is-pressed");
        window.setTimeout(() => element.classList.remove("is-pressed"), 260);

        const bounds = element.getBoundingClientRect();
        const dot = document.createElement("span");
        dot.className = "ripple-dot";
        dot.style.left = `${event.clientX - bounds.left}px`;
        dot.style.top = `${event.clientY - bounds.top}px`;
        element.appendChild(dot);
        window.setTimeout(() => dot.remove(), 650);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    let storedTheme = "light";
    try {
      storedTheme = localStorage.getItem(THEME_KEY) || "light";
    } catch (error) {
      storedTheme = "light";
    }
    applyTheme(
      document.documentElement.getAttribute("data-theme") || storedTheme,
      false
    );
    initThemeSelectors();
    initEntryFormToggle();
    initWeekRowsToggle();
    initDayTypeFilter();
    initAuthPremiumEffects();
    initHomePremiumEffects();
  });
})();
