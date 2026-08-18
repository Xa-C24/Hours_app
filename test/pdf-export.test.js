const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPeriodPdfBuffer,
  buildHistoryPdfBuffer,
  buildPeriodPdfModel,
  buildHistoryPdfModel,
  buildExportFilename,
  resolvePdfFontPaths,
  getBrandBannerPath,
} = require("../pdf-export");

const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");

const QA_LOGO_PATH = path.resolve(__dirname, "..", "public", "logo_app.png");

function buildSampleMonthRows(count, overrides = {}) {
  const dayTypes = ["office", "remote", "leave", "rtt", "sick_leave", "holiday"];
  const dayTypeLabels = {
    office: "Bureau",
    remote: "Télétravail",
    leave: "Congé",
    rtt: "RTT",
    sick_leave: "Maladie",
    holiday: "Récupération",
  };
  return Array.from({ length: count }, (_, index) => {
    const dayType = dayTypes[index % dayTypes.length];
    return {
      work_date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      work_date_display: `${String((index % 28) + 1).padStart(2, "0")}/08/2026`,
      day_type: dayType,
      day_type_display: dayTypeLabels[dayType],
      arrival_time_display: dayType === "office" || dayType === "remote" ? "08:30" : "",
      departure_time_display: dayType === "office" || dayType === "remote" ? "17:00" : "",
      lunch_break_minutes_display: dayType === "office" || dayType === "remote" ? "45" : "",
      worked_hhmm: dayType === "office" || dayType === "remote" ? "07:45" : "00:00",
      overtime_hhmm: dayType === "office" ? "00:45" : "00:00",
      recovered_minutes: dayType === "holiday" ? 420 : 0,
      recovered_hhmm: dayType === "holiday" ? "07:00" : "00:00",
      is_worked_day: dayType === "office" || dayType === "remote",
      under_target: false,
      comment_text:
        overrides.comment_text ||
        `Commentaire ${index + 1}: é è ê ë à â ù û ç É À œ € ’ Télétravail / Récupération.`,
      ...overrides,
    };
  });
}

function buildMonthData(entries, overrides = {}) {
  return {
    payPeriodStartDate: "2026-07-15",
    payPeriodEndDate: "2026-08-14",
    payPeriodLabel: "Du 15/07/2026 au 14/08/2026",
    totalHHMM: "147:15",
    totalOvertimeHHMM: "09:30",
    totalRecoveredHHMM: "01:15",
    workedDayCount: entries.filter((entry) => entry.is_worked_day).length,
    salaryAmountCents: 245000,
    dayTypeCounts: {
      office: entries.filter((entry) => entry.day_type === "office").length,
      remote: entries.filter((entry) => entry.day_type === "remote").length,
      leave: entries.filter((entry) => entry.day_type === "leave").length,
      rtt: entries.filter((entry) => entry.day_type === "rtt").length,
      sick_leave: entries.filter((entry) => entry.day_type === "sick_leave").length,
      holiday: entries.filter((entry) => entry.day_type === "holiday").length,
    },
    entries,
    ...overrides,
  };
}

test("export.pdf handler requires an explicit clientId and uses the selected client id for data fetch", () => {
  const exportPdfRoute = serverSource.match(/app\.get\("\/export\.pdf", async \(req, res\) => \{[\s\S]*?\n\}\);/);
  assert.ok(exportPdfRoute, "export.pdf route should exist");
  assert.match(exportPdfRoute[0], /application\/pdf/);
  assert.match(
    exportPdfRoute[0],
    /getExportClient\(req\.authUser, req\.query\.clientId, \{ requireExplicitId: true \}\)/
  );
  assert.match(exportPdfRoute[0], /getMonthData\(req\.authUser, client\.id, month\)/);
  assert.match(exportPdfRoute[0], /getWorkEntriesByClient\(req\.authUser, client\.id\)/);
});

test("PDF export resolves a real embedded Unicode font", () => {
  const fontPaths = resolvePdfFontPaths();
  assert.match(fontPaths.regular, /arial\.ttf$/i);
  assert.match(fontPaths.bold, /arialbd\.ttf$/i);
  assert.ok(fs.existsSync(fontPaths.regular));
  assert.ok(fs.existsSync(fontPaths.bold));
  assert.ok(fs.existsSync(getBrandBannerPath()));
});

test("buildPeriodPdfModel preserves French Unicode characters and exact selected client context", () => {
  const unicodeComment = "é è ê ë à â ù û ç É À œ € ’";
  const model = buildPeriodPdfModel({
    client: {
      company_name: "Alice",
      company_logo: "",
    },
    userSettings: {
      accentColor: "amber",
      profileName: "Zoé Dœ",
      companyName: "Atelier Élite",
      companyLogo: "",
    },
    authUser: "zoe",
    monthData: buildMonthData(buildSampleMonthRows(1, { comment_text: unicodeComment })),
  });

  assert.match(model.context.meta, /Client Alice/);
  assert.equal(model.rows[0].comment, unicodeComment);
  assert.equal(model.rows[0].type, "Bureau");
  assert.equal(model.context.logoSource, null);
  assert.deepEqual(
    model.kpis.map((item) => item.label),
    ["Heures travaillées", "Heures supplémentaires", "Récupérées", "Journées travaillées"]
  );
});

test("selected client drives the PDF model for Alice, BDD and JLO", () => {
  [
    { clientName: "Alice", marker: "ENTRY-ALICE" },
    { clientName: "BDD", marker: "ENTRY-BDD" },
    { clientName: "JLO", marker: "ENTRY-JLO" },
  ].forEach(({ clientName, marker }) => {
    const model = buildPeriodPdfModel({
      client: {
        company_name: clientName,
        company_logo: "",
      },
      userSettings: {
        accentColor: "amber",
        profileName: "Alice Martin",
        companyName: "Studio Alice",
        companyLogo: "",
      },
      authUser: "alice",
      monthData: buildMonthData(buildSampleMonthRows(1, { comment_text: marker })),
    });

    assert.match(model.context.meta, new RegExp(`Client ${clientName}`));
    assert.equal(model.rows[0].comment, marker);
  });
});

test("buildPeriodPdfBuffer returns a valid multipage PDF buffer for 20+ days and logo", async () => {
  const pdfBuffer = await buildPeriodPdfBuffer({
    client: {
      company_name: "Acme Premium",
      company_logo: QA_LOGO_PATH,
    },
    userSettings: {
      accentColor: "amber",
      profileName: "Alice Martin",
      companyName: "Studio Alice",
      companyLogo: "",
    },
    authUser: "alice",
    monthData: buildMonthData(buildSampleMonthRows(24)),
  });

  const pdfText = pdfBuffer.toString("latin1");
  assert.equal(pdfBuffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(pdfBuffer.length > 8000);
  assert.match(pdfText, /Acme Premium/);
  assert.match(pdfText, /\/Type \/Catalog/);
  assert.match(pdfText, /\/FontFile2/);
  assert.ok((pdfText.match(/\/Type \/Page\b/g) || []).length >= 2, "expected multiple pages");
});

test("buildPeriodPdfModel keeps a selected client logo when configured", () => {
  const model = buildPeriodPdfModel({
    client: {
      company_name: "Alice",
      company_logo: QA_LOGO_PATH,
    },
    userSettings: {
      accentColor: "amber",
      profileName: "Alice Martin",
      companyName: "Studio Alice",
      companyLogo: "",
    },
    authUser: "alice",
    monthData: buildMonthData(buildSampleMonthRows(1)),
  });

  assert.equal(model.context.logoSource, QA_LOGO_PATH);
});

test("buildPeriodPdfBuffer handles an empty period", async () => {
  const pdfBuffer = await buildPeriodPdfBuffer({
    client: {
      company_name: "BDD",
      company_logo: "",
    },
    userSettings: {
      accentColor: "steel",
      profileName: "Alice Martin",
      companyName: "Studio Alice",
      companyLogo: "",
    },
    authUser: "alice",
    monthData: buildMonthData([], {
      totalHHMM: "00:00",
      totalOvertimeHHMM: "00:00",
      totalRecoveredHHMM: "00:00",
      workedDayCount: 0,
      salaryAmountCents: null,
      dayTypeCounts: {
        office: 0,
        remote: 0,
        leave: 0,
        rtt: 0,
        sick_leave: 0,
        holiday: 0,
      },
    }),
  });

  assert.equal(pdfBuffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(pdfBuffer.length > 3000);
});

test("buildPeriodPdfBuffer handles a single day with a very long comment", async () => {
  const longComment =
    "Commentaire long ".repeat(18) + "é è ê ë à â ù û ç É À œ € ’";
  const pdfBuffer = await buildPeriodPdfBuffer({
    client: {
      company_name: "JLO",
      company_logo: "",
    },
    userSettings: {
      accentColor: "sage",
      profileName: "Alice Martin",
      companyName: "Studio Alice",
      companyLogo: "",
    },
    authUser: "alice",
    monthData: buildMonthData(buildSampleMonthRows(1, { comment_text: longComment })),
  });

  assert.equal(pdfBuffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(pdfBuffer.length > 3500);
});

test("buildHistoryPdfModel and history buffer keep the selected client and archive rows aligned", async () => {
  const entries = buildSampleMonthRows(8).map((entry, index) => ({
    ...entry,
    worked_minutes: entry.is_worked_day ? 465 : 0,
    comment_text: `HISTORY-JLO-${index + 1}`,
  }));
  const model = buildHistoryPdfModel({
    client: {
      company_name: "JLO",
      company_logo: "",
    },
    userSettings: {
      accentColor: "coral",
      profileName: "Alice Martin",
      companyName: "Studio Alice",
      companyLogo: "",
    },
    authUser: "alice",
    entries,
  });

  assert.match(model.context.meta, /Client JLO/);
  assert.equal(model.rows[0].comment, "HISTORY-JLO-1");

  const pdfBuffer = await buildHistoryPdfBuffer({
    client: {
      company_name: "JLO",
      company_logo: "",
    },
    userSettings: {
      accentColor: "coral",
      profileName: "Alice Martin",
      companyName: "Studio Alice",
      companyLogo: "",
    },
    authUser: "alice",
    entries,
  });
  const pdfText = pdfBuffer.toString("latin1");
  assert.equal(pdfBuffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.match(pdfText, /JLO/);
  assert.ok((pdfText.match(/\/Type \/Page\b/g) || []).length >= 1);
  assert.equal(buildExportFilename("Acme Premium", "2026-08", "pdf"), "hours-acme-premium-2026-08.pdf");
});
