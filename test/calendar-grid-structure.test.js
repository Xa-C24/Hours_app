const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ejs = require("ejs");

const viewPath = path.join(__dirname, "..", "views", "index.ejs");
const stylePath = path.join(__dirname, "..", "public", "style.css");

function makeDay(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  return {
    isoDate,
    dayNumber: date.getDate(),
    weekdayShort: date.toLocaleDateString("fr-FR", { weekday: "short" }),
    dateLabel: date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" }),
    entry: null,
    isWeekend: date.getDay() === 0 || date.getDay() === 6,
    isInPeriod: true,
    isToday: false,
    isSelected: false,
    dayType: "",
    durationLabel: "",
    durationLabelHtml: "",
    stateTone: "empty",
    stateEmoji: "",
    stateLabel: "Aucune saisie",
    metaLabel: "",
  };
}

function getCalendarDesktopTemplate() {
  const view = fs.readFileSync(viewPath, "utf8");
  const start = view.indexOf('<div class="calendar-weekdays" aria-hidden="true">');
  const end = view.indexOf('<p class="calendar-empty-filter"', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return view.slice(start, end);
}

test("one visible week renders Monday through Sunday then one weekly summary", () => {
  const weekDates = [
    "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27",
    "2026-08-28", "2026-08-29", "2026-08-30",
  ];
  const html = ejs.render(getCalendarDesktopTemplate(), {
    _calendarWeeks: [weekDates.map(makeDay)],
    _calendarWeekSummaries: [{ weekNumber: 35, totalWorkedHHMM: "35:00", totalOvertimeHHMM: "00:00", totalOvertimeMinutes: 0 }],
    _buildCalendarTooltipText: () => "",
    selectedClient: null,
  });
  const items = [...html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"|class="calendar-week-total-card/g)]
    .map((match) => match[1] || "summary");
  const headerStart = html.indexOf('<div class="calendar-weekdays"');
  const header = html.slice(headerStart, html.indexOf("</div>", headerStart));

  assert.deepEqual(items, [...weekDates, "summary"]);
  assert.equal((header.match(/<span/g) || []).length, 8);
  assert.match(header, />SEMAINE<\/span>/);
  assert.equal((html.match(/calendar-week-total-card/g) || []).length, 1);
  assert.equal(new Date("2026-08-25T12:00:00").getDay(), 2, "25/08/2026 is Tuesday");
});

test("each rendered weekly summary card exposes the modal hooks", () => {
  const firstWeek = [
    "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27",
    "2026-08-28", "2026-08-29", "2026-08-30",
  ];
  const secondWeek = [
    "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
    "2026-09-04", "2026-09-05", "2026-09-06",
  ];
  const html = ejs.render(getCalendarDesktopTemplate(), {
    _calendarWeeks: [firstWeek.map(makeDay), secondWeek.map(makeDay)],
    _calendarWeekSummaries: [
      { weekNumber: 35, totalWorkedHHMM: "35:00", totalOvertimeHHMM: "00:00", totalOvertimeMinutes: 0 },
      { weekNumber: 36, totalWorkedHHMM: "28:00", totalOvertimeHHMM: "01:00", totalOvertimeMinutes: 60 },
    ],
    _buildCalendarTooltipText: () => "",
    selectedClient: null,
  });
  const cards = [...html.matchAll(/<aside\b(?=[^>]*\bclass="calendar-week-total-card)[^>]*>/g)].map((match) => match[0]);

  assert.equal(cards.length, 2);
  cards.forEach((card, index) => {
    assert.match(card, /\brole="button"/);
    assert.match(card, /\btabindex="0"/);
    assert.match(card, /\baria-haspopup="dialog"/);
    assert.match(card, new RegExp(`\\bdata-week-summary-index="${index}"`));
    assert.match(card, /\bdata-week-start="\d{4}-\d{2}-\d{2}"/);
    assert.match(card, /\bdata-week-end="\d{4}-\d{2}-\d{2}"/);
    assert.match(card, new RegExp(`\\bdata-week-number="${35 + index}"`));
  });
});

test("desktop calendar and header share the eight-column grid", () => {
  const stylesheet = fs.readFileSync(stylePath, "utf8");
  const view = fs.readFileSync(viewPath, "utf8");

  assert.match(
    stylesheet,
    /\.calendar-weekdays,\s*\.calendar-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\) minmax\(110px, 0\.75fr\);/s
  );
  assert.match(view, /<span class="calendar-week-total-heading">SEMAINE<\/span>/);
  assert.match(stylesheet, /\.calendar-board\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.match(stylesheet, /\.calendar-board-scroll\s*\{[^}]*overflow-x:\s*clip;/s);
  assert.match(stylesheet, /\.calendar-day-filler,\s*\.calendar-day-card\s*\{[^}]*min-width:\s*0;/s);
});
