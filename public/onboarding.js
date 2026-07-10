(() => {
  const root = document.querySelector("[data-onboarding]");
  const settingsStore = window.hoursSettingsStore;
  const bootstrapElement = document.getElementById("hours-settings-bootstrap");
  if (!root || !settingsStore || !bootstrapElement) {
    return;
  }

  function readBootstrap() {
    try {
      return JSON.parse(bootstrapElement.textContent || "{}");
    } catch (error) {
      return {};
    }
  }

  function formatMinutes(totalMinutes) {
    const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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
      return (hours * 60) + minutes;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  const bootstrap = readBootstrap();
  const state = {
    step: 1,
    isOpen: false,
    saveTimer: null,
  };

  const steps = Array.from(root.querySelectorAll("[data-onboarding-step]"));
  const progressLabel = root.querySelector("[data-onboarding-progress-label]");
  const progressFill = root.querySelector("[data-onboarding-progress-fill]");
  const prevButton = root.querySelector("[data-onboarding-prev]");
  const nextButton = root.querySelector("[data-onboarding-next]");
  const finishButton = root.querySelector("[data-onboarding-finish]");
  const secondaryButton = root.querySelector("[data-onboarding-secondary]");
  const topSkipButton = root.querySelector("[data-onboarding-skip]");
  const actionButtons = Array.from(root.querySelectorAll("[data-onboarding-action]"));
  const livePreview = root.querySelector("[data-onboarding-live-preview]");

  const fieldMap = {
    profileName: root.querySelector('[data-onboarding-field="profileName"]'),
    companyName: root.querySelector('[data-onboarding-field="companyName"]'),
    contractType: root.querySelector('[data-onboarding-field="contractType"]'),
    firstDayOfWeek: root.querySelector('[data-onboarding-field="firstDayOfWeek"]'),
    dailyGoal: root.querySelector('[data-onboarding-field="dailyGoal"]'),
    defaultStartTime: root.querySelector('[data-onboarding-field="defaultStartTime"]'),
    defaultEndTime: root.querySelector('[data-onboarding-field="defaultEndTime"]'),
    defaultPause: root.querySelector('[data-onboarding-field="defaultPause"]'),
    accentColor: root.querySelector('[data-onboarding-field="accentColor"]'),
    theme: root.querySelector('[data-onboarding-field="theme"]'),
    animations: root.querySelector('[data-onboarding-field="animations"]'),
  };

  const previewMap = {
    profilePhoto: root.querySelector('[data-onboarding-preview="profilePhoto"]'),
    companyLogo: root.querySelector('[data-onboarding-preview="companyLogo"]'),
  };

  function getSettings() {
    return settingsStore.getSettings();
  }

  function setPreview(target, value, fallbackLabel) {
    if (!target) {
      return;
    }
    if (!value) {
      target.textContent = fallbackLabel;
      return;
    }
    target.innerHTML = `<img src="${value}" alt="">`;
  }

  function syncFieldsFromSettings(settings = getSettings()) {
    const effectiveProfileName = settings.profileName || bootstrap.authUser || "";
    const effectiveCompanyName = settings.companyName || bootstrap.fallbackCompanyName || "";

    if (fieldMap.profileName) {
      fieldMap.profileName.value = effectiveProfileName;
    }
    if (fieldMap.companyName) {
      fieldMap.companyName.value = effectiveCompanyName;
    }
    if (fieldMap.contractType) {
      fieldMap.contractType.value = settings.contractType || "35h";
    }
    if (fieldMap.firstDayOfWeek) {
      fieldMap.firstDayOfWeek.value = settings.firstDayOfWeek || "monday";
    }
    if (fieldMap.dailyGoal) {
      fieldMap.dailyGoal.value = formatMinutes(settings.dailyGoal);
    }
    if (fieldMap.defaultStartTime) {
      fieldMap.defaultStartTime.value = settings.defaultStartTime || "09:00";
    }
    if (fieldMap.defaultEndTime) {
      fieldMap.defaultEndTime.value = settings.defaultEndTime || "17:00";
    }
    if (fieldMap.defaultPause) {
      fieldMap.defaultPause.value = String(settings.defaultPause || 0);
    }
    if (fieldMap.accentColor) {
      fieldMap.accentColor.value = settings.accentColor || "amber";
    }
    if (fieldMap.theme) {
      fieldMap.theme.value = settings.theme === "dark" ? "dark" : "light";
    }
    if (fieldMap.animations) {
      fieldMap.animations.value = settings.animations || "subtle";
    }

    setPreview(previewMap.profilePhoto, settings.profilePhoto || "", "Aperçu");
    setPreview(previewMap.companyLogo, settings.companyLogo || "", "Aperçu");
    updateLivePreview();
  }

  function updateLivePreview() {
    if (!livePreview) {
      return;
    }
    const settings = getSettings();
    livePreview.textContent = `${settings.defaultStartTime} → ${settings.defaultEndTime} avec ${settings.defaultPause} min de pause`;
  }

  function open() {
    root.hidden = false;
    document.body.classList.add("has-onboarding");
    state.isOpen = true;
    render();
  }

  function close() {
    root.hidden = true;
    document.body.classList.remove("has-onboarding");
    state.isOpen = false;
  }

  function render() {
    steps.forEach((stepElement) => {
      const isActive = Number(stepElement.dataset.onboardingStep || 0) === state.step;
      stepElement.hidden = !isActive;
    });
    if (progressLabel) {
      progressLabel.textContent = `Étape ${state.step} sur 6`;
    }
    if (progressFill) {
      progressFill.style.width = `${(state.step / 6) * 100}%`;
    }
    if (prevButton) {
      prevButton.hidden = state.step === 1;
    }
    if (nextButton) {
      nextButton.hidden = state.step >= 6;
      nextButton.textContent = state.step === 1 ? "Commencer" : "Continuer";
    }
    if (secondaryButton) {
      secondaryButton.textContent = state.step === 1 ? "Passer" : "Passer complètement";
      secondaryButton.hidden = state.step === 6;
    }
    if (topSkipButton) {
      topSkipButton.hidden = state.step === 6;
    }
    if (finishButton) {
      finishButton.hidden = state.step !== 6;
    }
    actionButtons.forEach((button) => {
      button.hidden = state.step !== 6;
    });
  }

  async function persistOnboarding(patch) {
    const settings = getSettings();
    const onboarding = {
      ...(settings.onboarding || {}),
      ...patch,
    };
    await settingsStore.savePatch({ onboarding });
  }

  async function goToStep(nextStep) {
    state.step = Math.max(1, Math.min(6, nextStep));
    render();
    await persistOnboarding({
      status: "in_progress",
      currentStep: state.step,
      completedAt: "",
      skippedAt: "",
    });
  }

  async function skipOnboarding() {
    await settingsStore.savePatch({
      onboarding: {
        status: "skipped",
        currentStep: 6,
        completedAt: "",
        skippedAt: nowIso(),
      },
    });
    close();
  }

  async function completeOnboarding() {
    await settingsStore.savePatch({
      onboarding: {
        status: "completed",
        currentStep: 6,
        completedAt: nowIso(),
        skippedAt: "",
      },
    });
    close();
  }

  function scheduleSave(patchBuilder) {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(async () => {
      try {
        await settingsStore.savePatch(patchBuilder());
      } catch (error) {
        console.error(error);
      }
    }, 120);
  }

  function buildFieldPatch(key, value) {
    const settings = getSettings();
    switch (key) {
      case "dailyGoal":
        return { dailyGoal: parseMinutes(value, settings.dailyGoal) };
      case "defaultPause":
        return { defaultPause: parseMinutes(value, settings.defaultPause) };
      case "profileName":
      case "companyName":
      case "contractType":
      case "firstDayOfWeek":
      case "defaultStartTime":
      case "defaultEndTime":
      case "accentColor":
      case "theme":
      case "animations":
        return { [key]: value };
      default:
        return null;
    }
  }

  async function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error || new Error("read_failed"));
      reader.readAsDataURL(file);
    });
  }

  root.addEventListener("click", async (event) => {
    const prev = event.target instanceof HTMLElement ? event.target.closest("[data-onboarding-prev]") : null;
    if (prev) {
      await goToStep(state.step - 1);
      return;
    }

    const next = event.target instanceof HTMLElement ? event.target.closest("[data-onboarding-next]") : null;
    if (next) {
      await goToStep(state.step + 1);
      return;
    }

    const finish = event.target instanceof HTMLElement ? event.target.closest("[data-onboarding-finish]") : null;
    if (finish) {
      await completeOnboarding();
      return;
    }

    const skip = event.target instanceof HTMLElement
      ? event.target.closest("[data-onboarding-skip], [data-onboarding-secondary]")
      : null;
    if (skip) {
      await skipOnboarding();
      return;
    }

    const action = event.target instanceof HTMLElement ? event.target.closest("[data-onboarding-action]") : null;
    if (!action) {
      return;
    }

    await completeOnboarding();
    const actionType = action.dataset.onboardingAction || "";
    if (actionType === "entry") {
      const dateInput = document.getElementById("date");
      if (dateInput) {
        dateInput.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => dateInput.focus(), 160);
      }
      return;
    }
    if (actionType === "cockpit") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  root.querySelectorAll("[data-onboarding-field]").forEach((field) => {
    field.addEventListener("input", () => {
      const key = field.dataset.onboardingField || "";
      const patch = buildFieldPatch(key, field.value);
      if (!patch) {
        return;
      }
      if (key === "dailyGoal" || key === "defaultPause" || key === "defaultStartTime" || key === "defaultEndTime") {
        updateLivePreview();
      }
      scheduleSave(() => patch);
    });
    field.addEventListener("change", async () => {
      const key = field.dataset.onboardingField || "";
      const patch = buildFieldPatch(key, field.value);
      if (!patch) {
        return;
      }
      try {
        await settingsStore.savePatch(patch);
      } catch (error) {
        console.error(error);
      }
    });
  });

  root.querySelectorAll("[data-onboarding-upload]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0] ? input.files[0] : null;
      const key = input.dataset.onboardingUpload || "";
      if (!file || !key) {
        return;
      }
      if (file.size > 1_500_000) {
        window.alert("Image trop lourde. Choisissez un fichier inférieur à 1,5 MB.");
        input.value = "";
        return;
      }
      try {
        const dataUrl = await readImageAsDataUrl(file);
        await settingsStore.savePatch({ [key]: dataUrl });
      } catch (error) {
        console.error(error);
      }
    });
  });

  document.querySelectorAll("[data-onboarding-relaunch]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await settingsStore.savePatch({
          onboarding: {
            status: "in_progress",
            currentStep: 1,
            completedAt: "",
            skippedAt: "",
          },
        });
        state.step = 1;
        syncFieldsFromSettings();
        open();
      } catch (error) {
        console.error(error);
      }
    });
  });

  settingsStore.subscribe((settings) => {
    syncFieldsFromSettings(settings);
  });

  const currentSettings = getSettings();
  syncFieldsFromSettings(currentSettings);

  const onboardingState = currentSettings.onboarding || { status: "not_started", currentStep: 1 };
  if (onboardingState.status === "completed" || onboardingState.status === "skipped") {
    close();
    return;
  }

  state.step = onboardingState.status === "in_progress"
    ? Math.max(1, Math.min(6, Number(onboardingState.currentStep || 1)))
    : 1;

  if (onboardingState.status === "not_started") {
    settingsStore.savePatch({
      onboarding: {
        status: "in_progress",
        currentStep: 1,
        completedAt: "",
        skippedAt: "",
      },
    }).catch((error) => {
      console.error(error);
    });
  }

  open();
})();
