(() => {
  const FLASH_STORAGE_KEY = "hours_toast_flash";
  const MAX_VISIBLE_TOASTS = 3;
  const DEFAULT_DURATION = 3200;
  const MAX_DURATION = 12000;
  const MIN_DURATION = 1200;
  const TYPE_TO_ROLE = {
    success: "status",
    info: "status",
    warning: "alert",
    error: "alert",
  };

  function normalizeToastInput(input = {}) {
    const type = ["success", "error", "warning", "info"].includes(input.type) ? input.type : "info";
    const message = typeof input.message === "string" ? input.message.trim() : "";
    const durationValue = Number(input.duration);
    const duration = Number.isFinite(durationValue)
      ? Math.max(MIN_DURATION, Math.min(MAX_DURATION, durationValue))
      : DEFAULT_DURATION;
    const dismissible = input.dismissible !== false;
    return {
      type,
      message,
      duration,
      dismissible,
      role: TYPE_TO_ROLE[type] || "status",
    };
  }

  function createToastQueue(limit = MAX_VISIBLE_TOASTS) {
    const entries = [];
    return {
      push(value) {
        entries.push(value);
        while (entries.length > limit) {
          const removed = entries.shift();
          if (removed && typeof removed.dispose === "function") {
            removed.dispose();
          }
        }
        return entries.length;
      },
      remove(value) {
        const index = entries.indexOf(value);
        if (index >= 0) {
          entries.splice(index, 1);
        }
      },
      size() {
        return entries.length;
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      FLASH_STORAGE_KEY,
      MAX_VISIBLE_TOASTS,
      normalizeToastInput,
      createToastQueue,
    };
  }

  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  const queue = createToastQueue(MAX_VISIBLE_TOASTS);

  function readFlashToast() {
    try {
      const rawValue = window.sessionStorage.getItem(FLASH_STORAGE_KEY);
      if (!rawValue) {
        return null;
      }
      window.sessionStorage.removeItem(FLASH_STORAGE_KEY);
      const parsed = JSON.parse(rawValue);
      if (!parsed || Date.now() - Number(parsed.createdAt || 0) > 15000) {
        return null;
      }
      return normalizeToastInput(parsed);
    } catch (error) {
      return null;
    }
  }

  function storeFlashToast(input) {
    const toast = normalizeToastInput(input);
    if (!toast.message) {
      return;
    }
    try {
      window.sessionStorage.setItem(
        FLASH_STORAGE_KEY,
        JSON.stringify({
          ...toast,
          createdAt: Date.now(),
        })
      );
    } catch (error) {
      // Ignore storage issues.
    }
  }

  function ensureViewport() {
    let viewport = document.querySelector("[data-toast-viewport]");
    if (viewport instanceof HTMLElement) {
      return viewport;
    }

    viewport = document.createElement("section");
    viewport.className = "toast-viewport";
    viewport.dataset.toastViewport = "true";
    viewport.setAttribute("aria-label", "Notifications");
    document.body.appendChild(viewport);
    return viewport;
  }

  function removeToast(toast, timeoutId) {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    queue.remove(toast);
    toast.classList.remove("is-visible");
    toast.classList.add("is-leaving");
    window.setTimeout(() => {
      toast.remove();
    }, 180);
  }

  function showToast(input) {
    const toast = normalizeToastInput(input);
    if (!toast.message) {
      return null;
    }

    const viewport = ensureViewport();
    const element = document.createElement("article");
    element.className = `toast-item is-${toast.type}`;
    element.setAttribute("role", toast.role);
    element.setAttribute("aria-live", toast.role === "alert" ? "assertive" : "polite");
    element.innerHTML = `
      <div class="toast-content">
        <p class="toast-message"></p>
      </div>
      ${toast.dismissible ? '<button type="button" class="toast-close" aria-label="Fermer la notification">×</button>' : ""}
    `;
    const message = element.querySelector(".toast-message");
    if (message) {
      message.textContent = toast.message;
    }

    let timeoutId = window.setTimeout(() => {
      removeToast(element, timeoutId);
    }, toast.duration);

    const closeButton = element.querySelector(".toast-close");
    if (closeButton instanceof HTMLButtonElement) {
      closeButton.addEventListener("click", () => {
        removeToast(element, timeoutId);
      });
    }

    const entry = {
      dispose() {
        removeToast(element, timeoutId);
      },
    };

    queue.push(entry);
    viewport.appendChild(element);
    window.requestAnimationFrame(() => {
      element.classList.add("is-visible");
    });
    return element;
  }

  window.showToast = showToast;
  window.storeToastFlash = storeFlashToast;
  window.addEventListener("app:toast", (event) => {
    const detail = event instanceof CustomEvent ? event.detail : null;
    if (detail) {
      showToast(detail);
    }
  });

  const flashToast = readFlashToast();
  if (flashToast) {
    showToast(flashToast);
  }
})();
