const fs = require("fs/promises");
const path = require("path");
const {
  buildPeriodWorkbook,
  buildHistoryWorkbook,
} = require("../excel-export");

async function writeWorkbook(workbook, filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await workbook.xlsx.writeFile(filePath);
}

async function main() {
  const client = {
    id: 1,
    company_name: "BDD Conseil",
    contact_name: "Alice Martin",
    email: "alice.martin@bdd-conseil.fr",
    phone: "06 87 74 02 73",
    address: "12 rue des Contamines, 69000 Lyon",
    notes: "Client de démonstration pour validation export Excel",
    company_logo: "",
    archived_at: "2026-07-24 18:05:00",
  };

  const monthData = {
    payPeriodStartDate: "2026-07-15",
    payPeriodEndDate: "2026-08-14",
    payPeriodLabel: "Du 15 juillet 2026 au 14 août 2026",
    salaryAmountCents: 248500,
    workedDayCount: 4,
    dayTypeCounts: {
      office: 2,
      remote: 1,
      leave: 0,
      rtt: 0,
      sick_leave: 0,
      holiday: 1,
    },
    totalHHMM: "31:20",
    totalOvertimeHHMM: "03:10",
    totalRecoveredHHMM: "00:40",
    displayEntries: [
      {
        work_date: "2026-07-28",
        work_date_display: "mardi 28 juillet",
        day_type: "office",
        day_type_display: "Bureau",
        arrival_time_display: "09:00",
        departure_time_display: "18:05",
        lunch_break_minutes_display: 60,
        worked_hhmm: "08:05",
        overtime_hhmm: "01:05",
        recovered_minutes: 0,
        recovered_hhmm: "00:00",
        under_target: false,
        is_worked_day: true,
        comment_text: "Préparation du reporting mensuel et revue des pointages.",
      },
      {
        work_date: "2026-07-29",
        work_date_display: "mercredi 29 juillet",
        day_type: "remote",
        day_type_display: "Télétravail",
        arrival_time_display: "08:45",
        departure_time_display: "17:35",
        lunch_break_minutes_display: 45,
        worked_hhmm: "08:05",
        overtime_hhmm: "01:05",
        recovered_minutes: 0,
        recovered_hhmm: "00:00",
        under_target: false,
        is_worked_day: true,
        comment_text: "Atelier Teams avec le cabinet comptable et consolidation des justificatifs.",
      },
      {
        work_date: "2026-07-30",
        work_date_display: "jeudi 30 juillet",
        day_type: "office",
        day_type_display: "Bureau",
        arrival_time_display: "09:00",
        departure_time_display: "17:10",
        lunch_break_minutes_display: 60,
        worked_hhmm: "07:10",
        overtime_hhmm: "00:10",
        recovered_minutes: 40,
        recovered_hhmm: "00:40",
        under_target: false,
        is_worked_day: true,
        comment_text: "Réunion client, finalisation des exports et validation RH.",
      },
      {
        is_week_total: true,
        week_total_hhmm: "23:20",
        week_total_overtime_hhmm: "02:20",
        week_total_recovered_hhmm: "00:40",
        week_summary_label: "du 28 juillet au 30 juillet - semaine 31",
      },
      {
        work_date: "2026-07-31",
        work_date_display: "vendredi 31 juillet",
        day_type: "office",
        day_type_display: "Bureau",
        arrival_time_display: "09:00",
        departure_time_display: "18:50",
        lunch_break_minutes_display: 50,
        worked_hhmm: "08:00",
        overtime_hhmm: "00:50",
        recovered_minutes: 0,
        recovered_hhmm: "00:00",
        under_target: false,
        is_worked_day: true,
        comment_text: "Bouclage de période de paie et livraison du relevé au client.",
      },
      {
        work_date: "2026-08-01",
        work_date_display: "samedi 01 août",
        day_type: "holiday",
        day_type_display: "Férié",
        arrival_time_display: "",
        departure_time_display: "",
        lunch_break_minutes_display: "",
        worked_hhmm: "00:00",
        overtime_hhmm: "00:00",
        recovered_minutes: 0,
        recovered_hhmm: "00:00",
        under_target: false,
        is_worked_day: false,
        comment_text: "Jour non travaillé.",
      },
      {
        is_week_total: true,
        week_total_hhmm: "08:00",
        week_total_overtime_hhmm: "00:50",
        week_total_recovered_hhmm: "00:00",
        week_summary_label: "du 31 juillet au 01 août - semaine 31",
      },
    ],
  };

  const historyEntries = monthData.displayEntries
    .filter((entry) => !entry.is_week_total)
    .map((entry) => ({
      ...entry,
      worked_minutes:
        typeof entry.worked_hhmm === "string"
          ? Number(entry.worked_hhmm.slice(0, 2)) * 60 + Number(entry.worked_hhmm.slice(3, 5))
          : 0,
    }));

  const periodWorkbook = await buildPeriodWorkbook({
    client,
    monthData,
    exportedAt: new Date("2026-07-31T16:45:00"),
  });
  const historyWorkbook = await buildHistoryWorkbook({
    client,
    entries: historyEntries,
    exportedAt: new Date("2026-07-31T16:45:00"),
  });

  const outputDir = path.join(process.cwd(), "demo");
  await writeWorkbook(periodWorkbook, path.join(outputDir, "releve-heures-demo.xlsx"));
  await writeWorkbook(historyWorkbook, path.join(outputDir, "historique-heures-demo.xlsx"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
