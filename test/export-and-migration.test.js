const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPeriodWorkbook,
  buildHistoryWorkbook,
  buildExportFilename,
  getBrandBannerPath,
} = require("../excel-export");
const {
  AUTH_DB_REQUIREMENTS,
  USER_DB_REQUIREMENTS,
} = require("../scripts/migrate-sqlite-to-postgres");

const serverSource = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
const schemaSource = fs.readFileSync(path.resolve(__dirname, "..", "schema.sql"), "utf8");

test("migration requirements include settings and company_logo", () => {
  assert.deepEqual(AUTH_DB_REQUIREMENTS.sessions, [
    "token",
    "username",
    "expires_at_ms",
    "created_at",
    "updated_at",
  ]);
  assert.ok(USER_DB_REQUIREMENTS.clients.includes("company_logo"));
  assert.deepEqual(USER_DB_REQUIREMENTS.settings, ["key", "value", "updated_at"]);
});

test("schema.sql documents the centralized PostgreSQL settings and company_logo fields", () => {
  assert.match(schemaSource, /PostgreSQL reference schema/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS clients \(/);
  assert.match(schemaSource, /company_logo TEXT NOT NULL DEFAULT ''/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS settings \(/);
  assert.match(schemaSource, /value JSONB NOT NULL/);
  assert.match(schemaSource, /PRIMARY KEY \(username, key\)/);
});

test("export.csv handler serves CSV content instead of redirecting to XLSX", () => {
  const exportCsvRoute = serverSource.match(/app\.get\("\/export\.csv", async \(req, res\) => \{[\s\S]*?\n\}\);/);
  assert.ok(exportCsvRoute, "export.csv route should exist");
  assert.match(exportCsvRoute[0], /text\/csv; charset=utf-16le/);
  assert.match(exportCsvRoute[0], /buildExportFilename\([\s\S]*"csv"/);
  assert.match(exportCsvRoute[0], /encodeCsvForExcel\(lines\)/);
  assert.doesNotMatch(exportCsvRoute[0], /redirect\(`\/export\.xlsx/);
});

test("buildPeriodWorkbook keeps the expected worksheet title and filename", async () => {
  const workbook = await buildPeriodWorkbook({
    client: {
      company_name: "Acme",
      company_logo: "",
    },
    userSettings: {
      profileName: "John",
      companyName: "JLO",
    },
    authUser: "john",
    monthData: {
      payPeriodStartDate: "2026-08-15",
      payPeriodEndDate: "2026-09-14",
      payPeriodLabel: "Du 15 aout 2026 au 14 septembre 2026",
      workedDayCount: 1,
      totalHHMM: "07:00",
      totalOvertimeHHMM: "00:00",
      totalRecoveredHHMM: "00:00",
      salaryAmountCents: null,
      dayTypeCounts: {
        office: 1,
        remote: 0,
        leave: 0,
        rtt: 0,
        sick_leave: 0,
        holiday: 0,
      },
      displayEntries: [
        {
          is_week_total: false,
          work_date: "2026-08-18",
          work_date_display: "18/08/2026",
          day_type: "remote",
          day_type_display: "Télétravail",
          arrival_time_display: "09:00",
          departure_time_display: "17:00",
          lunch_break_minutes_display: 60,
          worked_hhmm: "07:00",
          overtime_hhmm: "00:00",
          recovered_hhmm: "00:00",
          recovered_minutes: 0,
          under_target: false,
          is_worked_day: true,
          comment_text: "RAS",
          week_summary_label: "",
        },
      ],
    },
  });

  assert.match(workbook.worksheets[0].name, /^Relev.* Acme$/);
  assert.equal(workbook.worksheets[0].getCell("A1").value, "RAPPORT D'HEURES");
  assert.match(workbook.worksheets[0].getCell("A3").value, /John • JLO/);
  assert.match(workbook.worksheets[0].getCell("A4").value, /Client Acme/);
  assert.equal(buildExportFilename("Acme", "2026-09", "xlsx"), "hours-acme-2026-09.xlsx");
  assert.equal(workbook.worksheets[0].getCell("A1").fill.fgColor.argb, "FFF4F8FC");
  assert.ok(Array.isArray(workbook.model.media) && workbook.model.media.length >= 1);
  assert.ok(workbook.worksheets[0].pageSetup.printArea);
  assert.equal(getBrandBannerPath().endsWith("bandeau_extract.png"), true);
  assert.equal(workbook.worksheets[0].getCell("A5").value, "HEURES TRAVAILLÉES");
  assert.equal(workbook.worksheets[0].getCell("A6").value, "07:00");
  assert.equal(workbook.worksheets[0].getCell("A7").value, "Répartition");
  assert.match(String(workbook.worksheets[0].getCell("C7").value), /Bureau : 1/);

  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new (require("exceljs").Workbook)();
  await reloaded.xlsx.load(buffer);
  assert.equal(reloaded.worksheets.length, 1);
});

test("buildHistoryWorkbook keeps readable French labels", async () => {
  const workbook = await buildHistoryWorkbook({
    client: {
      company_name: "Acme",
      company_logo: "",
      archived_at: "2026-08-18 09:00:00",
    },
    userSettings: {
      profileName: "John",
      companyName: "JLO",
    },
    authUser: "john",
    entries: [
      {
        work_date: "2026-08-18",
        work_date_display: "18/08/2026",
        day_type: "holiday",
        day_type_display: "Férié",
        arrival_time_display: "",
        departure_time_display: "",
        lunch_break_minutes_display: "",
        worked_hhmm: "00:00",
        overtime_hhmm: "00:00",
        worked_minutes: 0,
        comment_text: "",
      },
    ],
  });

  assert.equal(workbook.worksheets[0].getCell("A1").value, "HISTORIQUE DES HEURES");
  assert.match(workbook.worksheets[0].getCell("A3").value, /John • JLO/);
  assert.match(workbook.worksheets[0].getCell("A4").value, /Client Acme/);
  assert.match(workbook.worksheets[0].getCell("A4").value, /18\/08\/2026/);
  assert.equal(workbook.worksheets[0].getCell("A1").fill.fgColor.argb, "FFF4F8FC");
  assert.ok(Array.isArray(workbook.model.media) && workbook.model.media.length >= 1);
  assert.ok(workbook.worksheets[0].pageSetup.printArea);
  assert.equal(workbook.worksheets[0].getCell("A5").value, "CLIENT");
  assert.equal(workbook.worksheets[0].getCell("A6").value, "Acme");

  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new (require("exceljs").Workbook)();
  await reloaded.xlsx.load(buffer);
  assert.equal(reloaded.worksheets.length, 1);
});
