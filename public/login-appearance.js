(() => {
  document.addEventListener("DOMContentLoaded", () => {
    const controls = [];
    const closeAll = () => controls.forEach(({ trigger, menu, wrapper }) => {
      trigger.setAttribute("aria-expanded", "false");
      menu.hidden = true;
      wrapper.classList.remove("is-open");
    });

    document.querySelectorAll(".login-topbar select").forEach((select) => {
      const label = document.querySelector(`label[for="${select.id}"]`);
      const wrapper = document.createElement("div");
      wrapper.className = "app-custom-select login-appearance-select";
      select.before(wrapper);
      wrapper.append(select);
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.id = `${select.id}-trigger`;
      trigger.className = "app-custom-select-trigger";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const caption = document.createElement("span");
      caption.setAttribute("data-custom-select-label", "");
      const caret = document.createElement("span");
      caret.className = "app-custom-select-caret";
      caret.textContent = "⌄";
      caret.setAttribute("aria-hidden", "true");
      trigger.append(caption, caret);
      const menu = document.createElement("div");
      menu.id = `${select.id}-menu`;
      menu.className = "app-custom-select-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", label?.textContent || "Apparence");
      menu.hidden = true;
      trigger.setAttribute("aria-controls", menu.id);
      const options = Array.from(select.options, (option) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "app-custom-select-option";
        item.dataset.value = option.value;
        item.textContent = option.textContent;
        item.setAttribute("role", "option");
        item.tabIndex = -1;
        item.addEventListener("click", () => {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          closeAll();
          trigger.focus();
        });
        menu.append(item);
        return item;
      });
      const sync = () => {
        caption.textContent = select.selectedOptions[0]?.textContent || "Choisir";
        trigger.setAttribute("aria-label", `${label?.textContent || "Apparence"} : ${caption.textContent}`);
        options.forEach((item) => {
          const active = item.dataset.value === select.value;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", String(active));
        });
      };
      const open = () => {
        closeAll();
        menu.hidden = false;
        wrapper.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        (options.find((item) => item.dataset.value === select.value) || options[0])?.focus();
      };
      trigger.addEventListener("click", () => menu.hidden ? open() : closeAll());
      trigger.addEventListener("keydown", (event) => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          open();
        }
      });
      let search = "";
      let lastKey = 0;
      menu.addEventListener("keydown", (event) => {
        const index = options.indexOf(document.activeElement);
        let target;
        if (event.key === "ArrowDown") target = options[(index + 1) % options.length];
        if (event.key === "ArrowUp") target = options[(index - 1 + options.length) % options.length];
        if (event.key === "Home") target = options[0];
        if (event.key === "End") target = options.at(-1);
        if (event.key === "Escape") {
          closeAll();
          trigger.focus();
          event.preventDefault();
        }
        if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
          search = Date.now() - lastKey > 700 ? event.key : search + event.key;
          lastKey = Date.now();
          target = options.find((item) => item.textContent.toLocaleLowerCase("fr").startsWith(search.toLocaleLowerCase("fr")));
        }
        if (target) {
          event.preventDefault();
          target.focus();
        }
      });
      wrapper.addEventListener("focusout", (event) => {
        if (!wrapper.contains(event.relatedTarget)) closeAll();
      });
      select.addEventListener("change", sync);
      wrapper.append(trigger, menu);
      select.hidden = true;
      select.classList.add("app-custom-select-native");
      if (label) label.htmlFor = trigger.id;
      controls.push({ wrapper, trigger, menu, sync });
      sync();
    });
    document.addEventListener("click", (event) => {
      if (!controls.some(({ wrapper }) => wrapper.contains(event.target))) closeAll();
    });
    new MutationObserver(() => controls.forEach(({ sync }) => sync())).observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-theme", "data-style"],
    });
  });
})();
