const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const viewPath = path.join(__dirname, "..", "views", "index.ejs");
const stylePath = path.join(__dirname, "..", "public", "style.css");

test("premium entry layout retains every functional form hook", () => {
  const view = fs.readFileSync(viewPath, "utf8");

  [
    'action="/entries"',
    'method="post"',
    'id="entryFormPanel"',
    "data-entry-form",
    'id="date" name="date"',
    'id="dayType" name="dayType"',
    'id="arrivalTime"',
    'name="arrivalTime"',
    'id="departureTime"',
    'name="departureTime"',
    'id="lunchBreakMinutes"',
    'name="lunchBreakMinutes"',
    'id="commentText"',
    'name="commentText"',
    "data-day-type-select",
    "data-worked-day-field",
    "data-comment-target",
    "data-entry-submit-button",
    "data-confirm-replace-input",
  ].forEach((hook) => assert.match(view, new RegExp(hook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.doesNotMatch(view, /data-entry-clear-draft|Effacer le brouillon/);
});

test("premium entry layout keeps the three visual zones", () => {
  const view = fs.readFileSync(viewPath, "utf8");

  ["entry-context-grid", "entry-day-layout", "entry-workday-panel", "entry-comment-field", "entry-actions-footer"].forEach((className) => {
    assert.match(view, new RegExp(`class="[^\"]*${className}`));
  });
});

test("workday type and time inputs share the same visual cockpit", () => {
  const view = fs.readFileSync(viewPath, "utf8");
  const workdayStart = view.indexOf('class="entry-hours-panel entry-workday-panel"');
  const workdayEnd = view.indexOf("</section>", workdayStart);
  const workday = view.slice(workdayStart, workdayEnd);

  assert.ok(workdayStart >= 0);
  assert.match(workday, /id="dayType" name="dayType"/);
  assert.match(workday, /id="arrivalTime"/);
  assert.match(workday, /id="departureTime"/);
  assert.match(workday, /id="lunchBreakMinutes"/);
});

test("entry state badge and load status are rendered once under the date field", () => {
  const view = fs.readFileSync(viewPath, "utf8");
  const dateCardStart = view.indexOf('class="field form-field entry-daybar-date entry-context-card"');
  const dateCardEnd = view.indexOf("</div>", dateCardStart);
  const dateCard = view.slice(dateCardStart, view.indexOf("</div>", view.indexOf('class="entry-date-status-row"', dateCardStart)) + 6);

  assert.ok(dateCardStart >= 0);
  assert.match(dateCard, /id="date" name="date"/);
  assert.match(dateCard, /class="entry-date-status-row"/);
  assert.match(dateCard, /data-entry-state-badge/);
  assert.match(dateCard, /data-entry-load-status/);
  assert.equal((view.match(/<span[^>]*data-entry-state-badge/g) || []).length, 1);
  assert.equal((view.match(/<p[^>]*data-entry-load-status/g) || []).length, 1);
});

test("entry save restores the previous viewport before it becomes visible", () => {
  const view = fs.readFileSync(viewPath, "utf8");

  assert.match(view, /const entryScrollRestoreKey = "hours_entry_scroll_restore"/);
  assert.match(view, /const payPeriodScrollRestoreTarget = "pay-period"/);
  assert.match(view, /const entryFormScrollRestoreTarget = "entry-form"/);
  assert.match(view, /const payPeriodScrollRestoreSelector = "\[data-pay-period-card\]"/);
  assert.match(view, /const payPeriodScrollRestoreOffset = 20/);
  assert.match(view, /window\.hoursScrollRestore = \{/);
  assert.match(view, /saveScrollRestoreState = \(\{ target = entryFormScrollRestoreTarget, scrollY = window\.scrollY, savedAt = Date\.now\(\) \} = \{\}\) =>/);
  assert.match(view, /sessionStorage\.removeItem\(entryScrollRestoreKey\)/);
  assert.match(view, /history\.scrollRestoration = "manual"/);
  assert.match(view, /data-restoring-scroll="true"/);
  assert.match(view, /document\.documentElement\.style\.scrollBehavior = "auto"/);
  assert.match(view, /targetSelector: resolveScrollRestoreSelector\(target\)/);
  assert.match(view, /window\.scrollTo\(0, pendingEntryScrollRestore\.scrollY\)/);
  assert.match(view, /window\.scrollTo\(0, Math\.min\(fallbackTop, maxScrollY\)\)/);
  assert.match(view, /document\.documentElement\.removeAttribute\("data-restoring-scroll"\)/);
});

test("pay period section exposes a stable restore anchor", () => {
  const view = fs.readFileSync(viewPath, "utf8");

  assert.match(view, /data-pay-period-card/);
  assert.match(view, /data-scroll-restore-anchor="pay-period"/);
  assert.match(view, /<h2>Période de paie<\/h2>/);
});

test("month selection submits the existing GET form once and restores the pay period viewport", () => {
  const view = fs.readFileSync(viewPath, "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "public", "workspace-tabs.js"), "utf8");
  const style = fs.readFileSync(stylePath, "utf8");

  assert.match(view, /<form action="\/" method="get" class="month-form" data-month-auto-submit>/);
  assert.match(view, /<input type="hidden" name="clientId" value="<%= _selectedClientId %>" \/>/);
  assert.match(view, /<input id="month" name="month" type="month" required value="<%= selectedMonth %>" aria-describedby="monthLoadingStatus" \/>/);
  assert.doesNotMatch(view, /<button type="submit" data-ripple>Afficher<\/button>/);
  assert.match(view, /id="monthLoadingStatus" class="month-loading-status" role="status" aria-live="polite" hidden>Chargement\.\.\.<\/span>/);
  assert.match(view, /<details class="export-menu">/);
  assert.match(view, /<script src="\/workspace-tabs\.js\?v=week-summary-modal-v4"><\/script>/);
  assert.match(script, /function bindPayPeriodMonthAutoSubmit\(monthInput, options = \{\}\)/);
  assert.match(script, /const form = monthInput\.closest\("form"\)/);
  assert.match(script, /String\(form\.method \|\| ""\)\.toLowerCase\(\) !== "get"/);
  assert.match(script, /if \(isSubmitting \|\| !monthInput\.value \|\| !monthInput\.checkValidity\(\)\) \{/);
  assert.match(script, /form\.requestSubmit\(\)/);
  assert.match(script, /form\.submit\(\)/);
  assert.equal((script.match(/monthInput\.addEventListener\("change"/g) || []).length, 1);
  assert.match(style, /\.month-form-controls\s*\{[\s\S]*?gap: 0\.55rem;/);
  assert.match(style, /\.month-loading-status\s*\{[\s\S]*?font-size: 0\.78rem;/);
  assert.match(style, /grid-template-columns: minmax\(0, 1fr\) auto;/);
});

test("calendar month links retain the existing GET URLs and restore the pay period viewport", () => {
  const view = fs.readFileSync(viewPath, "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "public", "workspace-tabs.js"), "utf8");

  assert.match(view, /class="calendar-nav-button"[\s\S]*?href="\/\?month=<%= encodeURIComponent\(_previousMonth\) %>&clientId=<%= encodeURIComponent\(_selectedClientId\) %>"/);
  assert.match(view, /class="calendar-nav-button"[\s\S]*?href="\/\?month=<%= encodeURIComponent\(_nextMonth\) %>&clientId=<%= encodeURIComponent\(_selectedClientId\) %>"/);
  assert.match(script, /bindPayPeriodCalendarNavigationRestore\(document\.querySelectorAll\("\.calendar-nav-button"\), \{/);
  assert.match(view, /const entryScrollRestoreKey = "hours_entry_scroll_restore"/);
  assert.match(script, /scrollRestoreApi\.save\(\{[\s\S]*?scrollY: getScrollY\(\)/);
  assert.match(script, /pageLifecycle\.addEventListener\("pageshow", resetNavigationPending\)/);
  assert.match(script, /control\.addEventListener\("click", \(event\) => \{[\s\S]*?\}, true\)/);
  assert.doesNotMatch(script, /calendar_nav_scroll|calendarScrollRestore|calendar-scroll-restore/);
});

test("day details actions reuse the same scroll restore flow for modify and delete", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "public", "workspace-tabs.js"), "utf8");

  assert.match(script, /<form class="day-details-form entry-form" action="\/entries" method="post" data-scroll-restore-target="pay-period">/);
  assert.match(script, /const restoreTarget = form\.dataset\.scrollRestoreTarget \|\| ""/);
  assert.match(script, /scrollRestoreApi\.save\(\{\s*target: restoreTarget,\s*scrollY: window\.scrollY,\s*savedAt: Date\.now\(\),\s*\}\)/);
  assert.match(script, /formaction="\/entries\/\$\{encodeURIComponent\(entry\.work_date\)\}\/delete"/);
});

test("client presentation and save CTA target existing DOM hooks", () => {
  const view = fs.readFileSync(viewPath, "utf8");
  const style = fs.readFileSync(stylePath, "utf8");

  assert.match(view, /class="entry-daybar-client-card"/);
  assert.match(view, /class="entry-daybar-client-copy"/);
  assert.match(view, /class="entry-daybar-client-logo/);
  assert.match(style, /\.entry-daybar-client-card\s*\{\s*display: grid;/);
  assert.match(style, /\.entry-daybar-client-logo\.has-image img[\s\S]*?object-fit: contain;/);
  assert.match(style, /\[data-entry-submit-button\]\s*\{/);
  assert.match(style, /\.entry-actions-footer \[data-entry-submit-button\]/);
});

test("premium entry CSS keeps distinct date status, client identity and summary cards", () => {
  const style = fs.readFileSync(stylePath, "utf8");

  assert.match(style, /\.entry-date-status-row\s*\{[\s\S]*?border-radius: 11px;/);
  assert.match(style, /\.entry-state-badge\.is-success::before\s*\{[\s\S]*?content: "✓";/);
  assert.match(style, /\.entry-daybar-client-card\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 5rem;/);
  assert.match(style, /\.entry-daybar-client-logo\s*\{[\s\S]*?width: 5rem;/);
  assert.match(style, /\.entry-live-summary-block\s*\{[\s\S]*?min-height: 3\.75rem;/);
});

test("entry card halo derives from the active theme primary color", () => {
  const style = fs.readFileSync(stylePath, "utf8");

  assert.match(style, /--entry-accent-glow: color-mix\(in srgb, var\(--primary\) 18%, transparent\)/);
  assert.match(style, /--entry-workday-glow: color-mix\(in srgb, var\(--primary\) 22%, transparent\)/);
  assert.match(style, /--entry-comment-glow: color-mix\(in srgb, var\(--primary\) 14%, transparent\)/);
  assert.match(style, /--entry-accent-glow-hover: color-mix\(in srgb, var\(--primary\) 28%, transparent\)/);
  assert.match(style, /--entry-accent-glow-focus: color-mix\(in srgb, var\(--primary\) 33%, transparent\)/);
  assert.match(style, /\.entry-context-card:focus-within[\s\S]*?var\(--entry-accent-glow-focus\)/);
  assert.match(style, /\.entry-workday-panel:focus-within[\s\S]*?var\(--entry-accent-glow-focus\)/);
  assert.match(style, /\.entry-comment-field:focus-within[\s\S]*?0 0 18px var\(--entry-accent-glow-focus\)/);
});

test("entry card halos render outside clipped card surfaces", () => {
  const style = fs.readFileSync(stylePath, "utf8");

  assert.match(style, /\.entry-context-card,[\s\S]*?\.entry-comment-field\s*\{[\s\S]*?isolation: isolate;[\s\S]*?overflow: visible;/);
  assert.match(style, /\.entry-context-card::after,[\s\S]*?\.entry-comment-field::after\s*\{[\s\S]*?inset: -4px;[\s\S]*?z-index: -1;[\s\S]*?0 0 8px var\(--entry-accent-glow\),[\s\S]*?0 0 16px var\(--entry-accent-glow\);/);
  assert.match(style, /\.entry-workday-panel::after\s*\{[\s\S]*?0 0 18px var\(--entry-workday-glow\);/);
  assert.match(style, /\.entry-comment-field::after\s*\{[\s\S]*?0 0 16px var\(--entry-comment-glow\);/);
  assert.match(style, /\.mobile-premium-shell \.entry-card\[data-entry-card\]\s*\{[\s\S]*?overflow: visible;/);
});

test("the entry day type custom menu floats without stretching the workday panel", () => {
  const view = fs.readFileSync(viewPath, "utf8");
  const style = fs.readFileSync(stylePath, "utf8");
  const store = fs.readFileSync(path.join(__dirname, "..", "public", "settings-store.js"), "utf8");

  assert.match(view, /class="field form-field entry-day-type-field entry-day-type-card"[\s\S]*?<select class="form-select" id="dayType" name="dayType" required data-day-type-select>/);
  assert.match(style, /\.entry-day-type-field \.app-custom-select\.is-open\s*\{[\s\S]*?z-index: 30;/);
  assert.match(style, /\.entry-day-type-field \.app-custom-select-menu,[\s\S]*?\.entry-day-type-field \.app-custom-select-menu\.is-dropup\s*\{[\s\S]*?position: absolute;[\s\S]*?z-index: 31;[\s\S]*?max-height: min\(13rem, 35dvh, var\(--entry-day-type-menu-available-height, 13rem\)\);/);
  assert.match(style, /\.entry-day-type-field \.app-custom-select-menu\.is-dropup\s*\{[\s\S]*?bottom: calc\(100% \+ 0\.45rem\);/);
  assert.match(store, /function isEntryDayTypeCustomSelect\(wrapper\)/);
  assert.match(store, /function positionEntryDayTypeMenu\(wrapper, trigger, menu\)/);
  assert.match(store, /const wouldOverlapComment = Boolean\(commentBounds && triggerBounds\.bottom \+ menuGap \+ menuHeight > commentBounds\.top\);/);
  assert.match(store, /const shouldOpenUp = \(wouldOverlapComment \|\| spaceBelow < menuHeight\) && spaceAbove > 0;/);
});

test("entry save CTA has isolated accessible motion states", () => {
  const style = fs.readFileSync(stylePath, "utf8");

  assert.match(style, /\[data-entry-submit-button\]\s*\{[\s\S]*?transform: scale\(1\);/);
  assert.match(style, /\[data-entry-submit-button\]:hover:not\(:disabled\)\s*\{[\s\S]*?transform: translateY\(-1px\) scale\(1\.04\);/);
  assert.match(style, /\[data-entry-submit-button\]:active:not\(:disabled\)\s*\{[\s\S]*?transform: translateY\(0\) scale\(0\.96\);/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-entry-submit-button\]:hover:not\(:disabled\)[\s\S]*?transform: none;/);
});

test("entry drafts retain automatic storage without a manual clear control", () => {
  const view = fs.readFileSync(viewPath, "utf8");

  assert.doesNotMatch(view, /data-entry-clear-draft|clearDraftButton/);
  assert.match(view, /const persistDraftNow = \(\) =>/);
  assert.match(view, /const restoreDraftIfNeeded = \(\) =>/);
  assert.match(view, /clearDraftFor\(saveFlash\.clientId, saveFlash\.workDate\)/);
  assert.match(view, /\[data-entry-submit-button\][\s\S]*?class="btn-save-primary"|class="btn-save-primary"[\s\S]*?data-entry-submit-button/);
});
