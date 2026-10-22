(() => {
  const themePicker = document.querySelector("[data-lab-theme]");
  const proposals = document.querySelectorAll("[data-proposal]");
  const proposalGrid = document.querySelector("[data-variant-grid]");
  const leftPicker = document.querySelector("[data-compare-left]");
  const rightPicker = document.querySelector("[data-compare-right]");
  const status = document.querySelector("[data-compare-status]");
  const returnButton = document.querySelector("[data-return-compare]");
  const variantNames = { a: "A · Neo Future", b: "B · Liquid Luxury", c: "C · Hyper UI", b2: "B2.0 · Liquid Luxury" };
  let soloVariant = null;

  const updateThemeShortcuts = () => {
    document.querySelectorAll("[data-theme-shortcut]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.themeShortcut === themePicker?.value));
    });
  };

  const renderComparison = () => {
    const selected = soloVariant ? [soloVariant] : [leftPicker?.value, rightPicker?.value];
    proposals.forEach((proposal) => {
      proposal.hidden = !selected.includes(proposal.dataset.proposal);
    });
    proposalGrid?.classList.toggle("is-solo", Boolean(soloVariant));
    if (returnButton) returnButton.hidden = !soloVariant;
    if (status) status.textContent = soloVariant
      ? `Examen seul · ${variantNames[soloVariant]}`
      : `${variantNames[leftPicker?.value]} ↔ ${variantNames[rightPicker?.value]}`;
  };

  const keepVariantsDistinct = (changedPicker, otherPicker) => {
    soloVariant = null;
    if (changedPicker.value === otherPicker.value) {
      otherPicker.value = ["b2", "b", "a", "c"].find((id) => id !== changedPicker.value);
    }
    renderComparison();
  };

  themePicker?.addEventListener("change", () => {
    document.documentElement.dataset.theme = themePicker.value;
    updateThemeShortcuts();
  });

  document.querySelectorAll("[data-theme-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!themePicker) return;
      themePicker.value = button.dataset.themeShortcut;
      document.documentElement.dataset.theme = themePicker.value;
      updateThemeShortcuts();
    });
  });

  leftPicker?.addEventListener("change", () => keepVariantsDistinct(leftPicker, rightPicker));
  rightPicker?.addEventListener("change", () => keepVariantsDistinct(rightPicker, leftPicker));
  document.querySelectorAll("[data-examine]").forEach((button) => {
    button.addEventListener("click", () => {
      soloVariant = button.dataset.examine;
      renderComparison();
      proposalGrid?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  returnButton?.addEventListener("click", () => {
    soloVariant = null;
    renderComparison();
    proposalGrid?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  proposals.forEach((proposal) => {
    const toggle = proposal.querySelector("[data-disabled-toggle]");
    const buttons = proposal.querySelectorAll("[data-button-preview] button");

    toggle?.addEventListener("change", () => {
      buttons.forEach((button) => {
        button.disabled = toggle.checked;
      });
    });

    proposal.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", (event) => event.preventDefault());
    });
  });

  updateThemeShortcuts();
  renderComparison();
})();
