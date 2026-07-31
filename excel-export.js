const ExcelJS = require("exceljs");

const APP_TITLE = "Hours App";
const WORKSHEET_HEADER_ROW = 8;
const DATA_START_ROW = WORKSHEET_HEADER_ROW + 1;
const HISTORY_HEADER_ROW = 7;
const HISTORY_DATA_START_ROW = HISTORY_HEADER_ROW + 1;

const PALETTE = {
  ink: "FF23313D",
  text: "FF2A3642",
  muted: "FF6B7785",
  border: "FFD6DEE6",
  panel: "FFF6F8FB",
  panelAlt: "FFEFF3F8",
  title: "FF203040",
  accent: "FF3A6EA5",
  accentSoft: "FFDCE7F4",
  green: "FF2E8B57",
  greenSoft: "FFE3F4EA",
  amber: "FFC08A2D",
  amberSoft: "FFF9EED7",
  red: "FFB2574C",
  redSoft: "FFF7E4E1",
  blue: "FF2F6EAA",
  blueSoft: "FFE1ECF8",
  white: "FFFFFFFF",
};

function hhmmToExcelDuration(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const [hours, minutes] = value.split(":").map(Number);
  return (hours * 60 + minutes) / (24 * 60);
}

function timeToExcelValue(value) {
  return hhmmToExcelDuration(value);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatDateLongFr(dateString) {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString || "";
  }
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateShortFr(dateString) {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString || "";
  }
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTimeDisplayFr(dateTimeString) {
  if (typeof dateTimeString !== "string" || !dateTimeString.trim()) {
    return "";
  }
  const [datePart, timePart = ""] = dateTimeString.trim().split(/\s+/);
  const dateLabel = formatDateShortFr(datePart);
  const timeLabel = timePart.slice(0, 5);
  if (dateLabel && timeLabel) {
    return `${dateLabel} à ${timeLabel}`;
  }
  return dateLabel || dateTimeString;
}

function formatCurrencyFromCents(amountCents) {
  if (!Number.isInteger(amountCents)) {
    return "Non renseigné";
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(amountCents / 100);
}

function getDayTypeLabel(dayType, fallback = "") {
  switch (dayType) {
    case "office":
      return "Bureau";
    case "remote":
      return "Télétravail";
    case "leave":
      return "Congés";
    case "rtt":
      return "RTT";
    case "sick_leave":
      return "Arrêt";
    case "holiday":
      return "Férié";
    default:
      return fallback || "";
  }
}

function getHistoryStatusLabel(entry) {
  if (!entry.is_worked_day) {
    return getDayTypeLabel(entry.day_type, entry.day_type_display);
  }
  if (Number(entry.recovered_minutes || 0) > 0) {
    return `Récup ${entry.recovered_hhmm || ""}`.trim();
  }
  if (entry.under_target) {
    return "Moins de 7h";
  }
  return "OK";
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function sanitizeWorksheetName(value, fallback) {
  const cleaned = String(value || fallback || "Export")
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback || "Export").slice(0, 31);
}

function applyCellBorder(cell, color = PALETTE.border) {
  cell.border = {
    top: { style: "thin", color: { argb: color } },
    left: { style: "thin", color: { argb: color } },
    bottom: { style: "thin", color: { argb: color } },
    right: { style: "thin", color: { argb: color } },
  };
}

function styleLabelValueRow(worksheet, rowNumber, label, value, options = {}) {
  const labelCell = worksheet.getCell(`A${rowNumber}`);
  const valueCell = worksheet.getCell(`B${rowNumber}`);
  labelCell.value = label;
  valueCell.value = value;
  worksheet.mergeCells(`B${rowNumber}:D${rowNumber}`);
  labelCell.font = { bold: true, color: { argb: PALETTE.muted }, size: 10 };
  valueCell.font = { bold: true, color: { argb: PALETTE.text }, size: options.large ? 12 : 10.5 };
  labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.panel } };
  valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.panel } };
  labelCell.alignment = { vertical: "middle" };
  valueCell.alignment = { vertical: "middle" };
  applyCellBorder(labelCell);
  applyCellBorder(valueCell);
  if (options.valueIsCurrency) {
    valueCell.alignment = { horizontal: "left", vertical: "middle" };
  }
}

function styleDayTypeSummary(worksheet, startRow, dayTypeCounts) {
  worksheet.mergeCells(`F${startRow}:G${startRow}`);
  const titleCell = worksheet.getCell(`F${startRow}`);
  titleCell.value = "Répartition des types de journée";
  titleCell.font = { bold: true, size: 11, color: { argb: PALETTE.title } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.accentSoft } };
  titleCell.alignment = { vertical: "middle" };
  applyCellBorder(titleCell);
  applyCellBorder(worksheet.getCell(`G${startRow}`));

  const dayTypes = [
    ["Bureau", dayTypeCounts.office || 0],
    ["Télétravail", dayTypeCounts.remote || 0],
    ["Congés", dayTypeCounts.leave || 0],
    ["RTT", dayTypeCounts.rtt || 0],
    ["Arrêt", dayTypeCounts.sick_leave || 0],
    ["Férié", dayTypeCounts.holiday || 0],
  ];

  dayTypes.forEach(([label, count], index) => {
    const rowNumber = startRow + 1 + index;
    const labelCell = worksheet.getCell(`F${rowNumber}`);
    const valueCell = worksheet.getCell(`G${rowNumber}`);
    labelCell.value = label;
    valueCell.value = count;
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 === 0 ? PALETTE.white : PALETTE.panel } };
    valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 === 0 ? PALETTE.white : PALETTE.panel } };
    labelCell.font = { color: { argb: PALETTE.text }, size: 10.5 };
    valueCell.font = { bold: true, color: { argb: PALETTE.text }, size: 10.5 };
    valueCell.alignment = { horizontal: "center", vertical: "middle" };
    applyCellBorder(labelCell);
    applyCellBorder(valueCell);
  });
}

function styleSummaryCard(worksheet, startRow, monthData) {
  worksheet.mergeCells(`A${startRow}:D${startRow}`);
  const titleCell = worksheet.getCell(`A${startRow}`);
  titleCell.value = "Synthèse de la période";
  titleCell.font = { bold: true, size: 11, color: { argb: PALETTE.title } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.accentSoft } };
  titleCell.alignment = { vertical: "middle" };
  ["A", "B", "C", "D"].forEach((column) => applyCellBorder(worksheet.getCell(`${column}${startRow}`)));

  styleLabelValueRow(worksheet, startRow + 1, "Période", monthData.payPeriodLabel || "");
  styleLabelValueRow(worksheet, startRow + 2, "Jours travaillés", Number(monthData.workedDayCount || 0), { large: true });
  styleLabelValueRow(worksheet, startRow + 3, "Total période", monthData.totalHHMM || "00:00", { large: true });
  styleLabelValueRow(worksheet, startRow + 4, "Heures supplémentaires", monthData.totalOvertimeHHMM || "00:00", { large: true });
  styleLabelValueRow(worksheet, startRow + 5, "Heures récupérées", monthData.totalRecoveredHHMM || "00:00", { large: true });
  styleLabelValueRow(
    worksheet,
    startRow + 6,
    "Salaire net",
    monthData.salaryAmountCents === null ? "Non renseigné" : formatCurrencyFromCents(monthData.salaryAmountCents),
    { large: true, valueIsCurrency: true }
  );
}

function setWorkbookMetadata(workbook) {
  workbook.creator = APP_TITLE;
  workbook.company = APP_TITLE;
  workbook.subject = "Relevé d'heures";
  workbook.title = "Relevé d'heures";
  workbook.created = new Date();
  workbook.modified = new Date();
}

function setupSheetLayout(worksheet, title) {
  worksheet.properties.defaultRowHeight = 22;
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.35,
      right: 0.35,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    },
  };
  worksheet.headerFooter = {
    firstHeader: `&L&"Segoe UI,Bold"&14${title}&R&G`,
    firstFooter: "&LHours App&RPage &P / &N",
    oddFooter: "&LHours App&RPage &P / &N",
  };
}

function styleHeaderBand(worksheet, client, subtitle, hasLogo) {
  worksheet.mergeCells("A1:H2");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = "RELEVÉ D’HEURES";
  titleCell.font = { name: "Segoe UI", size: 20, bold: true, color: { argb: PALETTE.white } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  titleCell.fill = {
    type: "gradient",
    gradient: "angle",
    degree: 0,
    stops: [
      { position: 0, color: { argb: PALETTE.title } },
      { position: 1, color: { argb: PALETTE.accent } },
    ],
  };

  worksheet.mergeCells("A3:H3");
  const subtitleCell = worksheet.getCell("A3");
  subtitleCell.value = subtitle;
  subtitleCell.font = { name: "Segoe UI", size: 11, color: { argb: PALETTE.muted }, italic: true };
  subtitleCell.alignment = { vertical: "middle", horizontal: "left" };

  worksheet.mergeCells(hasLogo ? "J1:K2" : "I1:J2");
  const clientCell = worksheet.getCell(hasLogo ? "J1" : "I1");
  clientCell.value = client.company_name || "Client";
  clientCell.font = { name: "Segoe UI", size: hasLogo ? 12 : 14, bold: true, color: { argb: PALETTE.title } };
  clientCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  clientCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.panel } };
  (hasLogo
    ? ["J1", "K1", "J2", "K2"]
    : ["I1", "J1", "I2", "J2"]
  ).forEach((address) => applyCellBorder(worksheet.getCell(address)));
}

function maybeAddClientLogo(workbook, worksheet, client) {
  const dataUrl = typeof client.company_logo === "string" ? client.company_logo.trim() : "";
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|gif);base64,/i);
  if (!match) {
    return false;
  }
  const extension = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const imageId = workbook.addImage({
    base64: dataUrl,
    extension,
  });
  worksheet.addImage(imageId, {
    tl: { col: 8.2, row: 0.2 },
    br: { col: 9.35, row: 2.35 },
  });
  return true;
}

function autofitWorksheetColumns(worksheet, columnsConfig) {
  columnsConfig.forEach((columnConfig, index) => {
    const column = worksheet.getColumn(index + 1);
    let maxLength = columnConfig.width || 10;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const rawValue = cell.value;
      let cellText = "";
      if (rawValue === null || rawValue === undefined) {
        cellText = "";
      } else if (typeof rawValue === "object" && rawValue.richText) {
        cellText = rawValue.richText.map((part) => part.text).join("");
      } else if (typeof rawValue === "object" && rawValue.text) {
        cellText = rawValue.text;
      } else {
        cellText = String(rawValue);
      }
      maxLength = Math.max(maxLength, cellText.length + 2);
    });
    column.width = Math.min(columnConfig.maxWidth || 40, Math.max(columnConfig.minWidth || 10, maxLength));
  });
}

function applyTableHeaderStyle(row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: PALETTE.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.accent } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    applyCellBorder(cell, PALETTE.accent);
  });
}

function applyRegularDataStyle(row, rowIndex) {
  const fillColor = rowIndex % 2 === 0 ? PALETTE.white : PALETTE.panel;
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
    cell.font = { name: "Segoe UI", size: 10.5, color: { argb: PALETTE.text } };
    cell.alignment = { vertical: "middle" };
    applyCellBorder(cell);
  });
}

function applyWeekTotalStyle(row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.accentSoft } };
    cell.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: PALETTE.title } };
    cell.alignment = { vertical: "middle" };
    applyCellBorder(cell, PALETTE.accent);
  });
}

function applyStatusStyle(cell, status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "ok") {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.greenSoft } };
    cell.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: PALETTE.green } };
    return;
  }
  if (normalized.includes("moins")) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.amberSoft } };
    cell.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: PALETTE.amber } };
    return;
  }
  if (normalized.includes("récup") || normalized.includes("recup")) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.blueSoft } };
    cell.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: PALETTE.blue } };
    return;
  }
  if (normalized.includes("arrêt") || normalized.includes("congé") || normalized.includes("ferié")) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.redSoft } };
    cell.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: PALETTE.red } };
  }
}

function populatePeriodTable(worksheet, monthData) {
  const columns = [
    { header: "Date", key: "date", width: 18, minWidth: 15, maxWidth: 22 },
    { header: "Type", key: "type", width: 16, minWidth: 14, maxWidth: 18 },
    { header: "Arrivée", key: "arrival", width: 12, minWidth: 10, maxWidth: 12 },
    { header: "Départ", key: "departure", width: 12, minWidth: 10, maxWidth: 12 },
    { header: "Pause (min)", key: "pause", width: 12, minWidth: 10, maxWidth: 14 },
    { header: "Heures du jour", key: "worked", width: 14, minWidth: 12, maxWidth: 16 },
    { header: "Heures sup", key: "overtime", width: 12, minWidth: 11, maxWidth: 14 },
    { header: "Heures récup", key: "recovered", width: 14, minWidth: 12, maxWidth: 16 },
    { header: "État", key: "status", width: 14, minWidth: 11, maxWidth: 16 },
    { header: "Commentaire", key: "comment", width: 36, minWidth: 20, maxWidth: 48 },
  ];

  worksheet.columns = columns.map((column) => ({
    key: column.key,
    width: column.width,
  }));
  const headerRow = worksheet.getRow(WORKSHEET_HEADER_ROW);
  headerRow.values = columns.map((column) => column.header);
  applyTableHeaderStyle(headerRow);
  worksheet.autoFilter = {
    from: { row: WORKSHEET_HEADER_ROW, column: 1 },
    to: { row: WORKSHEET_HEADER_ROW, column: columns.length },
  };
  worksheet.views = [{ state: "frozen", xSplit: 0, ySplit: WORKSHEET_HEADER_ROW, showGridLines: false }];

  let currentRowNumber = DATA_START_ROW;
  for (const entry of monthData.displayEntries) {
    const row = worksheet.getRow(currentRowNumber);
    if (entry.is_week_total) {
      row.values = [
        "Total semaine",
        "",
        "",
        "",
        "",
        hhmmToExcelDuration(entry.week_total_hhmm),
        hhmmToExcelDuration(entry.week_total_overtime_hhmm),
        hhmmToExcelDuration(entry.week_total_recovered_hhmm),
        "",
        entry.week_summary_label || "",
      ];
      applyWeekTotalStyle(row);
    } else {
      const statusLabel = getHistoryStatusLabel(entry);
      row.values = [
        entry.work_date_display || entry.work_date,
        getDayTypeLabel(entry.day_type, entry.day_type_display),
        timeToExcelValue(entry.arrival_time_display),
        timeToExcelValue(entry.departure_time_display),
        entry.lunch_break_minutes_display === "" ? "" : Number(entry.lunch_break_minutes_display),
        hhmmToExcelDuration(entry.worked_hhmm),
        hhmmToExcelDuration(entry.overtime_hhmm),
        Number(entry.recovered_minutes || 0) > 0 ? hhmmToExcelDuration(entry.recovered_hhmm) : "",
        statusLabel,
        normalizeText(entry.comment_text),
      ];
      applyRegularDataStyle(row, currentRowNumber);
      applyStatusStyle(row.getCell(9), statusLabel);
    }

    row.height = 22;
    row.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(3).numFmt = "hh:mm";
    row.getCell(4).numFmt = "hh:mm";
    row.getCell(5).alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(6).numFmt = "[h]:mm";
    row.getCell(7).numFmt = "[h]:mm";
    row.getCell(8).numFmt = "[h]:mm";
    row.getCell(9).alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(10).alignment = { vertical: "top", horizontal: "left", wrapText: true };
    currentRowNumber += 1;
  }

  autofitWorksheetColumns(worksheet, columns);
  return currentRowNumber;
}

function populateHistoryTable(worksheet, entries) {
  const columns = [
    { header: "Date", width: 18, minWidth: 15, maxWidth: 22 },
    { header: "Type", width: 16, minWidth: 14, maxWidth: 18 },
    { header: "Arrivée", width: 12, minWidth: 10, maxWidth: 12 },
    { header: "Départ", width: 12, minWidth: 10, maxWidth: 12 },
    { header: "Pause (min)", width: 12, minWidth: 10, maxWidth: 14 },
    { header: "Heures", width: 12, minWidth: 11, maxWidth: 14 },
    { header: "Heures sup", width: 12, minWidth: 11, maxWidth: 14 },
    { header: "Commentaire", width: 40, minWidth: 22, maxWidth: 52 },
  ];
  worksheet.columns = columns.map((column, index) => ({
    key: `col_${index + 1}`,
    width: column.width,
  }));
  const headerRow = worksheet.getRow(HISTORY_HEADER_ROW);
  headerRow.values = columns.map((column) => column.header);
  applyTableHeaderStyle(headerRow);
  worksheet.autoFilter = {
    from: { row: HISTORY_HEADER_ROW, column: 1 },
    to: { row: HISTORY_HEADER_ROW, column: columns.length },
  };
  worksheet.views = [{ state: "frozen", ySplit: HISTORY_HEADER_ROW, showGridLines: false }];

  let rowNumber = HISTORY_DATA_START_ROW;
  entries.forEach((entry) => {
    const row = worksheet.getRow(rowNumber);
    row.values = [
      entry.work_date_display || entry.work_date,
      getDayTypeLabel(entry.day_type, entry.day_type_display),
      timeToExcelValue(entry.arrival_time_display),
      timeToExcelValue(entry.departure_time_display),
      entry.lunch_break_minutes_display === "" ? "" : Number(entry.lunch_break_minutes_display),
      hhmmToExcelDuration(entry.worked_hhmm),
      hhmmToExcelDuration(entry.overtime_hhmm),
      normalizeText(entry.comment_text),
    ];
    applyRegularDataStyle(row, rowNumber);
    row.height = 22;
    row.getCell(3).numFmt = "hh:mm";
    row.getCell(4).numFmt = "hh:mm";
    row.getCell(6).numFmt = "[h]:mm";
    row.getCell(7).numFmt = "[h]:mm";
    row.getCell(8).alignment = { vertical: "top", horizontal: "left", wrapText: true };
    rowNumber += 1;
  });

  autofitWorksheetColumns(worksheet, columns);
  return rowNumber;
}

async function buildPeriodWorkbook({ client, monthData, exportedAt = new Date() }) {
  const workbook = new ExcelJS.Workbook();
  setWorkbookMetadata(workbook);
  const worksheet = workbook.addWorksheet(
    sanitizeWorksheetName(`Relevé ${client.company_name || "Client"}`, "Relevé")
  );
  setupSheetLayout(worksheet, "Relevé d'heures");
  const hasLogo = maybeAddClientLogo(workbook, worksheet, client);
  styleHeaderBand(
    worksheet,
    client,
    `Client ${client.company_name || "Non renseigné"} • Période du ${formatDateLongFr(monthData.payPeriodStartDate)} au ${formatDateLongFr(monthData.payPeriodEndDate)} • Généré le ${exportedAt.toLocaleDateString("fr-FR")} à ${exportedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
    hasLogo
  );

  const endTableRow = populatePeriodTable(worksheet, monthData);
  const summaryStartRow = endTableRow + 2;
  styleSummaryCard(worksheet, summaryStartRow, monthData);
  styleDayTypeSummary(worksheet, summaryStartRow, monthData.dayTypeCounts || {});

  worksheet.getRow(1).height = 30;
  worksheet.getRow(2).height = 26;
  worksheet.getRow(3).height = 20;
  worksheet.pageSetup.printTitlesRow = `${WORKSHEET_HEADER_ROW}:${WORKSHEET_HEADER_ROW}`;

  return workbook;
}

async function buildHistoryWorkbook({ client, entries, exportedAt = new Date() }) {
  const workbook = new ExcelJS.Workbook();
  setWorkbookMetadata(workbook);
  const worksheet = workbook.addWorksheet(
    sanitizeWorksheetName(`Historique ${client.company_name || "Client"}`, "Historique")
  );
  setupSheetLayout(worksheet, "Historique des heures");

  const hasLogo = maybeAddClientLogo(workbook, worksheet, client);
  worksheet.mergeCells("A1:F2");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = "HISTORIQUE DES HEURES";
  titleCell.font = { name: "Segoe UI", size: 20, bold: true, color: { argb: PALETTE.white } };
  titleCell.fill = {
    type: "gradient",
    gradient: "angle",
    degree: 0,
    stops: [
      { position: 0, color: { argb: PALETTE.title } },
      { position: 1, color: { argb: PALETTE.accent } },
    ],
  };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  worksheet.mergeCells("A3:F3");
  worksheet.getCell("A3").value = `Client ${client.company_name || "Non renseigné"} • Exporté le ${exportedAt.toLocaleDateString("fr-FR")} à ${exportedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  worksheet.getCell("A3").font = { name: "Segoe UI", size: 11, italic: true, color: { argb: PALETTE.muted } };

  if (!hasLogo) {
    worksheet.mergeCells("G1:H2");
    const clientCell = worksheet.getCell("G1");
    clientCell.value = client.company_name || "Client";
    clientCell.font = { name: "Segoe UI", size: 13, bold: true, color: { argb: PALETTE.title } };
    clientCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.panel } };
    clientCell.alignment = { vertical: "middle", horizontal: "center" };
    ["G1", "H1", "G2", "H2"].forEach((address) => applyCellBorder(worksheet.getCell(address)));
  }

  const endDataRow = populateHistoryTable(worksheet, entries);
  const totalMinutes = entries.reduce((sum, entry) => sum + Number(entry.worked_minutes || 0), 0);
  const totalOvertimeMinutes = entries.reduce((sum, entry) => {
    const extra = hhmmToExcelDuration(entry.overtime_hhmm);
    return sum + (extra === null ? 0 : extra);
  }, 0);

  const summaryStartRow = endDataRow + 2;
  worksheet.mergeCells(`A${summaryStartRow}:D${summaryStartRow}`);
  const summaryTitleCell = worksheet.getCell(`A${summaryStartRow}`);
  summaryTitleCell.value = "Résumé";
  summaryTitleCell.font = { bold: true, size: 11, color: { argb: PALETTE.title } };
  summaryTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.accentSoft } };
  ["A", "B", "C", "D"].forEach((column) => applyCellBorder(worksheet.getCell(`${column}${summaryStartRow}`)));

  styleLabelValueRow(worksheet, summaryStartRow + 1, "Client", client.company_name || "");
  if (client.archived_at) {
    styleLabelValueRow(worksheet, summaryStartRow + 2, "Archivé le", formatDateTimeDisplayFr(client.archived_at));
  }
  styleLabelValueRow(worksheet, summaryStartRow + 3, "Nombre de journées", entries.length, { large: true });
  styleLabelValueRow(
    worksheet,
    summaryStartRow + 4,
    "Total heures",
    `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`,
    { large: true }
  );

  const overtimeCell = worksheet.getCell(`B${summaryStartRow + 5}`);
  styleLabelValueRow(
    worksheet,
    summaryStartRow + 5,
    "Total heures sup",
    totalOvertimeMinutes
  );
  overtimeCell.numFmt = "[h]:mm";

  worksheet.pageSetup.printTitlesRow = `${HISTORY_HEADER_ROW}:${HISTORY_HEADER_ROW}`;
  return workbook;
}

function buildExportFilename(clientName, scope, extension) {
  const clientSlug = slugify(clientName) || "client";
  return `hours-${clientSlug}-${scope}.${extension}`;
}

module.exports = {
  buildPeriodWorkbook,
  buildHistoryWorkbook,
  buildExportFilename,
  getDayTypeLabel,
  getHistoryStatusLabel,
  formatCurrencyFromCents,
};
