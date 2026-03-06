(() => {
  const THEME_KEY = "hours_theme";
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
  });
})();
