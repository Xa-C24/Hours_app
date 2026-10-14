(() => {
  function missingDates({ entries = [], start, end, today, workingDays = [1,2,3,4,5] }) {
    if (![start,end,today].every(v=>typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) return [];
    const known = new Set(entries.map(e=>e.work_date));
    const dates=[];
    const cursor = new Date(`${start}T12:00:00`);
    for(let i=0;i<366 && Number.isFinite(cursor.getTime());i++,cursor.setDate(cursor.getDate()+1)) {
      const date = [cursor.getFullYear(),String(cursor.getMonth()+1).padStart(2,"0"),String(cursor.getDate()).padStart(2,"0")].join("-");
      if(date > end || date >= today) break;
      if(workingDays.includes(cursor.getDay()) && !known.has(date)) dates.push(date);
    }
    return dates;
  }
  if(typeof module !== "undefined" && module.exports) module.exports={missingDates};
  if(typeof document === "undefined") return;
  const selectors = {entry:["[data-entry-card]","[data-entry-toggle]"], calendar:["[data-pay-period-card]","[data-pay-period-toggle]"],history:["[data-archived-clients-card]","[data-archived-clients-toggle]"]};
  const timers = new WeakMap();
  function highlight(section) {
    if(!section) return;
    clearTimeout(timers.get(section));
    section.classList.add("navigation-highlight");
    timers.set(section,setTimeout(()=>section.classList.remove("navigation-highlight"),1800));
  }
  function reveal(key) {
    const target = selectors[key];
    if(!target) return;
    const section = document.querySelector(target[0]);
    if(section?.classList.contains("is-collapsed")) section.querySelector(target[1])?.click();
    highlight(section);
    return section;
  }
  function showView(key) {
    return window.hoursMobileNavigation?.show(key) || false;
  }
  window.hoursNavigation={reveal,highlight,showView};
  document.addEventListener("click",event=>{
    const button=event.target.closest("[data-dashboard-action], [data-workspace-target], [data-mobile-nav-button]");
    if(!button) return;
    const key=button.dataset.dashboardAction || button.dataset.workspaceTarget || button.dataset.targetView;
    if(button.matches("[data-mobile-nav-button]")) return;
    reveal(key);
  },true);
  document.addEventListener("DOMContentLoaded",()=>{
    let bootstrap;
    try { bootstrap=JSON.parse(document.getElementById("hours-settings-bootstrap")?.textContent || "{}"); } catch { return; }
    const now=new Date();
    const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
    const summary=document.querySelector("[data-missing-days]");
    function render(settings) {
      if(!summary) return;
      const dates=missingDates({entries:bootstrap.entries,start:bootstrap.payPeriodStartDate,end:bootstrap.payPeriodEndDate,today,workingDays:settings.workingDays});
      summary.replaceChildren();
      summary.hidden=!dates.length || settings.notifications?.missingEntry === false;
      if(summary.hidden) return;
      const title=document.createElement("strong");
      title.textContent=`${dates.length} journée${dates.length>1?"s":""} sans saisie sur cette période`;
      summary.append(title);
      const links=document.createElement("div");
      links.className="entry-quick-actions";
      for(const date of dates) {
        const link=document.createElement("a");
        link.className="button-link button-neutral";
        const params=new URLSearchParams(location.search);
        params.delete("today");
        params.set("editDate",date);
        link.href=`/?${params.toString()}`;
        link.textContent=new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR",{day:"numeric",month:"short"});
        links.append(link);
      }
      summary.append(links);
    }
    render(window.hoursSettingsStore?.getSettings() || bootstrap.settings || {});
    window.hoursSettingsStore?.subscribe(settings=>render(settings));
    const params=new URLSearchParams(location.search);
    if(params.get("backup") === "1") {
      document.querySelector('[data-dashboard-action="history"]')?.click();
      requestAnimationFrame(()=>{
        const panel=document.querySelector("[data-account-backup]");
        highlight(panel);
        panel?.scrollIntoView({behavior:window.hoursMotion?.scrollBehavior() || "instant",block:"start"});
      });
    } else if(params.get("today") === "1") {
      document.querySelector('[data-dashboard-action="calendar"]')?.click();
      requestAnimationFrame(()=>{
        const card=document.querySelector(`[data-calendar-day][data-date="${today}"]`);
        const target=card && card.getClientRects().length ? card : reveal("calendar");
        highlight(target);
        target?.scrollIntoView({behavior:window.hoursMotion?.scrollBehavior() || "instant",block:"center"});
        card?.focus({preventScroll:true});
      });
    } else if(params.has("editDate")) {
      document.querySelector('[data-dashboard-action="entry"]')?.click();
    }
  });
})();
