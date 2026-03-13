(() => {
  const THEME_KEY = "hours_theme";
  const ENTRY_FORM_COLLAPSED_KEY = "hours_entry_form_collapsed";
  const WEEK_ROWS_COLLAPSED_BY_MONTH_KEY = "hours_week_rows_collapsed_by_month";
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
  });
})();
