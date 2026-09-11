(() => {
  const types = window.hoursDayTypes;
  function enhance(select) {
    if (select.dataset.halfDayEnhanced) return;
    select.dataset.halfDayEnhanced = "true";
    Array.from(select.options || []).forEach(option => { option.hidden = option.value.includes("__"); });
    const container = document.createElement("div");
    const modeLabel = document.createElement("label");
    modeLabel.className = "form-label half-day-toggle";
    const mode = document.createElement("input");
    mode.type = "checkbox";
    modeLabel.append(mode, " Saisir par demi-journée");
    container.append(modeLabel);
    const halves = document.createElement("div");
    const fields = ["Matin", "Après-midi"].map(labelText => {
      const label = document.createElement("label");
      label.className = "form-label";
      label.textContent = labelText;
      const field = document.createElement("select");
      field.className = "form-select";
      field.dataset.nativeSelect = "true";
      types.baseOptions.forEach(option => field.add(new Option(option.label, option.value)));
      label.append(field);
      halves.append(label);
      return field;
    });
    const hint = document.createElement("p");
    hint.className = "entry-hours-note";
    hint.textContent = "Saisissez les horaires réellement travaillés. Pour une seule demi-journée travaillée, la pause déjeuner est de 0 min et l’objectif quotidien est divisé par deux.";
    halves.append(hint);
    container.append(halves);
    select.after(container);
    function render() {
      const parts = types.parts(select.value);
      if (select.value.includes("__")) mode.checked = true;
      fields.forEach((field, index) => { field.value = parts[index] || "office"; });
      halves.hidden = !mode.checked;
      select.hidden = mode.checked;
      select.style.display = mode.checked ? "none" : "";
      const pause = select.form.querySelector('[name="lunchBreakMinutes"]');
      if (pause) {
        pause.readOnly = types.workedFraction(select.value) === 0.5;
        if (pause.readOnly) pause.value = "0";
      }
    }
    let updating = false;
    function update() {
      const [morning, afternoon] = fields.map(field => field.value);
      select.value = mode.checked && morning !== afternoon ? `${morning}__${afternoon}` : morning;
      if (types.workedFraction(select.value) === 0.5) {
        const pause = select.form.querySelector('[name="lunchBreakMinutes"]');
        if (pause) pause.value = "0";
      }
      updating = true;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      updating = false;
      render();
    }
    mode.addEventListener("change", update);
    fields.forEach(field => field.addEventListener("change", update));
    select.addEventListener("change", () => {
      if (!updating && !select.value.includes("__") && document.activeElement !== fields[0] && document.activeElement !== fields[1]) mode.checked = false;
      render();
    });
    render();
  }
  function scan() {
    document.querySelectorAll("[data-day-type-select], [data-day-details-day-type]").forEach(enhance);
  }
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
