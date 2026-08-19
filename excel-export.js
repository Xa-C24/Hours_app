const ExcelJS = require("exceljs");

const fs = require("node:fs");
const path = require("node:path");

const APP_TITLE = "Hours App";
const WORKSHEET_HEADER_ROW = 8;
const DATA_START_ROW = WORKSHEET_HEADER_ROW + 1;
const HISTORY_HEADER_ROW = 7;
const HISTORY_DATA_START_ROW = HISTORY_HEADER_ROW + 1;
const BRAND_BANNER_PATH = path.join(__dirname, "public", "bandeau_extract.png");
const A4_LANDSCAPE_PAGE_HEIGHT_POINTS = 595.28;
const A4_LANDSCAPE_PAGE_WIDTH_POINTS = 841.89;
const EXCEL_PIXELS_TO_POINTS = 0.75;
const FOOTER_BOTTOM_GAP_POINTS = 10;
const FOOTER_MIN_SPACING_POINTS = 24;

const PALETTE = {
  ink: "FF23313D",
  text: "FF1E2A36",
  muted: "FF64748B",
  border: "FFD4E0EC",
  panel: "FFF4F8FC",
  panelAlt: "FFEAF2FB",
  title: "FF173A63",
  accent: "FF3D78B4",
  accentSoft: "FFE4EFFA",
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

function formatDateDayMonthYearMultilineFr(dateString) {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString || "";
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);
  const weekday = parsedDate.toLocaleDateString("fr-FR", { weekday: "long" });
  const dateLabel = parsedDate.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return `${weekday} ${day}\n${dateLabel}`;
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

function formatExportedAtCompactFr(date) {
  return `${date.toLocaleDateString("fr-FR")} ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
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

function buildProfileHeaderLine(userSettings, authUser, client) {
  const profileName = normalizeText(userSettings && userSettings.profileName);
  const companyName = normalizeText(userSettings && userSettings.companyName);
  const fallbackUser = normalizeText(authUser);
  const fallbackCompany = normalizeText(client && client.company_name);
  const left = profileName || fallbackUser || "Utilisateur";
  const right = companyName || fallbackCompany || "";
  return right ? `${left} • ${right}` : left;
}

function buildMetaHeaderLine(client, periodLabel, exportedAt) {
  return [
    `Client ${client.company_name || "Non renseigné"}`,
    periodLabel,
    `Généré le ${formatExportedAtCompactFr(exportedAt)}`,
  ]
    .filter(Boolean)
    .join(" • ");
}

function getVisibleDayTypeSummary(dayTypeCounts) {
  return [
    ["Bureau", dayTypeCounts.office || 0],
    ["Télétravail", dayTypeCounts.remote || 0],
    ["Congé", dayTypeCounts.leave || 0],
    ["RTT", dayTypeCounts.rtt || 0],
    ["Maladie", dayTypeCounts.sick_leave || 0],
    ["Récupération", dayTypeCounts.holiday || 0],
  ].filter(([, count]) => Number(count) > 0);
}

function getBrandBannerPath() {
  return fs.existsSync(BRAND_BANNER_PATH) ? BRAND_BANNER_PATH : null;
}

function readPngDimensions(filePath) {
  if (!filePath || !/\.png$/i.test(filePath)) {
    return null;
  }
  const fileBuffer = fs.readFileSync(filePath);
  if (fileBuffer.length < 24 || fileBuffer.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  return {
    width: fileBuffer.readUInt32BE(16),
    height: fileBuffer.readUInt32BE(20),
  };
}

function getRowHeightPoints(worksheet, rowNumber) {
  return Number(worksheet.getRow(rowNumber).height || worksheet.properties.defaultRowHeight || 15);
}

function getColumnWidthPixels(worksheet, columnNumber) {
  const width = Number(worksheet.getColumn(columnNumber).width || 8.43);
  return Math.floor(width * 7 + 5);
}

function getPrintableHeightPoints(worksheet) {
  const topMargin = Number(worksheet.pageSetup?.margins?.top || 0) * 72;
  const bottomMargin = Number(worksheet.pageSetup?.margins?.bottom || 0) * 72;
  return A4_LANDSCAPE_PAGE_HEIGHT_POINTS - topMargin - bottomMargin;
}

function getPrintableWidthPoints(worksheet) {
  const leftMargin = Number(worksheet.pageSetup?.margins?.left || 0) * 72;
  const rightMargin = Number(worksheet.pageSetup?.margins?.right || 0) * 72;
  return A4_LANDSCAPE_PAGE_WIDTH_POINTS - leftMargin - rightMargin;
}

function getSheetWidthPixels(worksheet, lastColumnCount) {
  let total = 0;
  for (let column = 1; column <= lastColumnCount; column += 1) {
    total += getColumnWidthPixels(worksheet, column);
  }
  return total;
}

function getCumulativeTopPoints(worksheet, rowNumber) {
  let total = 0;
  for (let row = 1; row < rowNumber; row += 1) {
    total += getRowHeightPoints(worksheet, row);
  }
  return total;
}

function ensureRowsForPointPosition(worksheet, targetBottomPoints) {
  let cumulative = 0;
  let rowNumber = 1;
  while (cumulative < targetBottomPoints) {
    cumulative += getRowHeightPoints(worksheet, rowNumber);
    rowNumber += 1;
  }
}

function convertPointsToRowFloat(worksheet, targetTopPoints) {
  ensureRowsForPointPosition(worksheet, targetTopPoints + 1);
  let cumulative = 0;
  let rowNumber = 1;
  while (true) {
    const rowHeight = getRowHeightPoints(worksheet, rowNumber);
    if (cumulative + rowHeight >= targetTopPoints) {
      const offset = Math.max(0, targetTopPoints - cumulative);
      return (rowNumber - 1) + Math.min(0.999, offset / rowHeight);
    }
    cumulative += rowHeight;
    rowNumber += 1;
  }
}

function convertPixelsToColumnFloat(worksheet, lastColumnCount, offsetPixels) {
  let cumulative = 0;
  for (let columnNumber = 1; columnNumber <= lastColumnCount; columnNumber += 1) {
    const columnWidth = getColumnWidthPixels(worksheet, columnNumber);
    if (cumulative + columnWidth >= offsetPixels) {
      const remainder = Math.max(0, offsetPixels - cumulative);
      return (columnNumber - 1) + Math.min(0.999, remainder / columnWidth);
    }
    cumulative += columnWidth;
  }
  return 0;
}

function getRowNumberAtPointPosition(worksheet, targetPoints) {
  ensureRowsForPointPosition(worksheet, targetPoints);
  let cumulative = 0;
  let rowNumber = 1;
  while (cumulative < targetPoints) {
    cumulative += getRowHeightPoints(worksheet, rowNumber);
    rowNumber += 1;
  }
  return Math.max(1, rowNumber - 1);
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

function styleHeaderBand(worksheet, client, options = {}) {
  const profileLine = options.profileLine || "Utilisateur";
  const metaLine = options.metaLine || `Client ${client.company_name || "Non renseigné"}`;
  worksheet.mergeCells("A1:I2");
  worksheet.mergeCells("A3:I3");
  worksheet.mergeCells("A4:I4");
  worksheet.mergeCells("J1:J4");

  ["A1", "A3", "A4", "J1"].forEach((address) => {
    const cell = worksheet.getCell(address);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.panel } };
  });

  for (let row = 1; row <= 4; row += 1) {
    for (let col = 1; col <= 10; col += 1) {
      const cell = worksheet.getRow(row).getCell(col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.panel } };
      applyCellBorder(cell, PALETTE.border);
    }
  }

  for (let col = 1; col <= 10; col += 1) {
    const topCell = worksheet.getRow(1).getCell(col);
    topCell.border = {
      ...topCell.border,
      top: { style: "medium", color: { argb: PALETTE.accent } },
    };
  }

  const titleCell = worksheet.getCell("A1");
  titleCell.value = "RAPPORT D'HEURES";
  titleCell.font = { name: "Segoe UI", size: 19, bold: true, color: { argb: PALETTE.title } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  const profileCell = worksheet.getCell("A3");
  profileCell.value = profileLine;
  profileCell.font = { name: "Segoe UI", size: 11.5, bold: true, color: { argb: PALETTE.text } };
  profileCell.alignment = { vertical: "middle", horizontal: "left" };

  const metaCell = worksheet.getCell("A4");
  metaCell.value = metaLine;
  metaCell.font = { name: "Segoe UI", size: 10, color: { argb: PALETTE.muted } };
  metaCell.alignment = { vertical: "middle", horizontal: "left" };

  worksheet.getRow(1).height = 28;
  worksheet.getRow(2).height = 18;
  worksheet.getRow(3).height = 20;
  worksheet.getRow(4).height = 22;
}

function styleKpiStrip(worksheet, startRow, monthData) {
  const kpis = [
    { label: "HEURES TRAVAILLÉES", value: monthData.totalHHMM || "00:00" },
    { label: "HEURES SUPPLÉMENTAIRES", value: monthData.totalOvertimeHHMM || "00:00" },
    { label: "RÉCUPÉRÉES", value: monthData.totalRecoveredHHMM || "00:00" },
    { label: "JOURNÉES TRAVAILLÉES", value: String(Number(monthData.workedDayCount || 0)) },
  ];
  const columnGroups = [
    ["A", "B"],
    ["C", "D"],
    ["E", "F"],
    ["G", "H"],
  ];

  columnGroups.forEach(([startColumn, endColumn], index) => {
    worksheet.mergeCells(`${startColumn}${startRow}:${endColumn}${startRow}`);
    worksheet.mergeCells(`${startColumn}${startRow + 1}:${endColumn}${startRow + 1}`);
    const labelCell = worksheet.getCell(`${startColumn}${startRow}`);
    const valueCell = worksheet.getCell(`${startColumn}${startRow + 1}`);
    labelCell.value = kpis[index].label;
    valueCell.value = kpis[index].value;
    labelCell.font = { name: "Segoe UI", size: 9, bold: true, color: { argb: PALETTE.muted } };
    valueCell.font = { name: "Segoe UI", size: 16, bold: true, color: { argb: PALETTE.title } };
    labelCell.alignment = { vertical: "middle", horizontal: "left" };
    valueCell.alignment = { vertical: "middle", horizontal: "left" };
    for (const column of [startColumn, endColumn]) {
      for (let row = startRow; row <= startRow + 1; row += 1) {
        const cell = worksheet.getCell(`${column}${row}`);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.white } };
        applyCellBorder(cell, PALETTE.border);
      }
    }
    if (index < columnGroups.length - 1) {
      const dividerColumn = endColumn;
      for (let row = startRow; row <= startRow + 1; row += 1) {
        const cell = worksheet.getCell(`${dividerColumn}${row}`);
        cell.border = {
          ...cell.border,
          right: { style: "thin", color: { argb: PALETTE.border } },
        };
      }
    }
  });

  worksheet.mergeCells(`I${startRow}:J${startRow + 1}`);
  const noteCell = worksheet.getCell(`I${startRow}`);
  noteCell.value =
    monthData.salaryAmountCents === null
      ? ""
      : `Salaire net\n${formatCurrencyFromCents(monthData.salaryAmountCents)}`;
  noteCell.font = { name: "Segoe UI", size: 9.5, color: { argb: PALETTE.text }, bold: true };
  noteCell.alignment = { vertical: "middle", horizontal: "right", wrapText: true };
  noteCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.white } };
  ["I", "J"].forEach((column) => {
    for (let row = startRow; row <= startRow + 1; row += 1) {
      applyCellBorder(worksheet.getCell(`${column}${row}`), PALETTE.border);
    }
  });

  worksheet.getRow(startRow).height = 18;
  worksheet.getRow(startRow + 1).height = 24;
}

function styleHistoryKpiStrip(worksheet, startRow, client, entries) {
  const totalMinutes = entries.reduce((sum, entry) => sum + Number(entry.worked_minutes || 0), 0);
  const totalOvertimeMinutes = entries.reduce((sum, entry) => {
    if (typeof entry.overtime_hhmm !== "string" || !/^\d{2}:\d{2}$/.test(entry.overtime_hhmm)) {
      return sum;
    }
    const [hours, minutes] = entry.overtime_hhmm.split(":").map(Number);
    return sum + hours * 60 + minutes;
  }, 0);
  const kpis = [
    { label: "CLIENT", value: client.company_name || "Client" },
    { label: "JOURNÉES", value: String(entries.length) },
    { label: "HEURES", value: `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}` },
    { label: "SUPPLÉMENTAIRES", value: `${String(Math.floor(totalOvertimeMinutes / 60)).padStart(2, "0")}:${String(totalOvertimeMinutes % 60).padStart(2, "0")}` },
  ];
  const columnGroups = [
    ["A", "B"],
    ["C", "D"],
    ["E", "F"],
    ["G", "H"],
  ];
  columnGroups.forEach(([startColumn, endColumn], index) => {
    worksheet.mergeCells(`${startColumn}${startRow}:${endColumn}${startRow}`);
    worksheet.mergeCells(`${startColumn}${startRow + 1}:${endColumn}${startRow + 1}`);
    const labelCell = worksheet.getCell(`${startColumn}${startRow}`);
    const valueCell = worksheet.getCell(`${startColumn}${startRow + 1}`);
    labelCell.value = kpis[index].label;
    valueCell.value = kpis[index].value;
    labelCell.font = { name: "Segoe UI", size: 9, bold: true, color: { argb: PALETTE.muted } };
    valueCell.font = {
      name: "Segoe UI",
      size: kpis[index].value.length > 18 ? 11 : 15,
      bold: true,
      color: { argb: PALETTE.title },
    };
    labelCell.alignment = { vertical: "middle", horizontal: "left" };
    valueCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    for (const column of [startColumn, endColumn]) {
      for (let row = startRow; row <= startRow + 1; row += 1) {
        const cell = worksheet.getCell(`${column}${row}`);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.white } };
        applyCellBorder(cell, PALETTE.border);
      }
    }
  });
  worksheet.getRow(startRow).height = 18;
  worksheet.getRow(startRow + 1).height = 24;
}

function styleDayTypeSummary(worksheet, startRow, dayTypeCounts) {
  worksheet.mergeCells(`A${startRow}:B${startRow}`);
  worksheet.mergeCells(`C${startRow}:J${startRow}`);
  const titleCell = worksheet.getCell(`A${startRow}`);
  const valueCell = worksheet.getCell(`C${startRow}`);
  const visibleDayTypes = getVisibleDayTypeSummary(dayTypeCounts);
  titleCell.value = "Répartition";
  valueCell.value =
    visibleDayTypes.length > 0
      ? visibleDayTypes.map(([label, count]) => `${label} : ${count}`).join("   •   ")
      : "Aucune journée enregistrée";
  titleCell.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: PALETTE.accent } };
  valueCell.font = { name: "Segoe UI", size: 10, color: { argb: PALETTE.text } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  valueCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  for (let col = 1; col <= 10; col += 1) {
    const cell = worksheet.getRow(startRow).getCell(col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.white } };
    applyCellBorder(cell, PALETTE.border);
  }
  worksheet.getRow(startRow).height = 22;
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
    horizontalCentered: true,
  };
  worksheet.headerFooter = {
    firstHeader: `&L&"Segoe UI,Bold"&14${title}&R&G`,
    firstFooter: "&LHours App&RPage &P / &N",
    oddFooter: "&LHours App&RPage &P / &N",
  };
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
    tl: { col: 8.75, row: 0.35 },
    br: { col: 9.85, row: 3.6 },
  });
  return true;
}

function addBrandBannerToWorksheet(workbook, worksheet, afterRow, lastColumnCount) {
  const bannerPath = getBrandBannerPath();
  const bannerSize = readPngDimensions(bannerPath);
  if (!bannerPath || !bannerSize || !bannerSize.width || !bannerSize.height) {
    return {
      footerRow: afterRow,
      footerRowFloat: afterRow - 1,
      footerBottomRow: afterRow,
      imageWidthPixels: 0,
      imageHeightPixels: 0,
      estimatedPageCount: 1,
      endRow: afterRow,
    };
  }
  const imageId = workbook.addImage({
    filename: bannerPath,
    extension: "png",
  });
  const sheetWidthPixels = getSheetWidthPixels(worksheet, lastColumnCount);
  const width = Math.round(sheetWidthPixels * 0.92);
  const height = Math.round((bannerSize.height / bannerSize.width) * width);
  const printableHeightPoints = getPrintableHeightPoints(worksheet);
  const printableWidthPoints = getPrintableWidthPoints(worksheet);
  const sheetWidthPoints = sheetWidthPixels * EXCEL_PIXELS_TO_POINTS;
  const fitScale =
    worksheet.pageSetup?.fitToWidth === 1 && sheetWidthPoints > printableWidthPoints
      ? printableWidthPoints / sheetWidthPoints
      : 1;
  const effectivePrintableHeightPoints = printableHeightPoints / fitScale;
  const bannerHeightPoints = height * EXCEL_PIXELS_TO_POINTS;
  const minimumFooterTopPointsWithinPage =
    effectivePrintableHeightPoints - bannerHeightPoints - FOOTER_BOTTOM_GAP_POINTS;
  const contentBottomPoints = getCumulativeTopPoints(worksheet, afterRow + 1);
  const maxContentBottomPointsWithinPage = minimumFooterTopPointsWithinPage - FOOTER_MIN_SPACING_POINTS;
  const footerPageIndex = Math.max(
    0,
    Math.ceil((contentBottomPoints - maxContentBottomPointsWithinPage) / effectivePrintableHeightPoints)
  );
  const finalFooterTopPoints =
    footerPageIndex * effectivePrintableHeightPoints + minimumFooterTopPointsWithinPage;
  const finalBottomPoints = finalFooterTopPoints + bannerHeightPoints + FOOTER_BOTTOM_GAP_POINTS;
  const footerPageBottomPoints = (footerPageIndex + 1) * effectivePrintableHeightPoints;
  ensureRowsForPointPosition(worksheet, footerPageBottomPoints);
  const startRowFloat = convertPointsToRowFloat(worksheet, finalFooterTopPoints);
  const startRow = Math.floor(startRowFloat) + 1;
  const horizontalOffsetPixels = Math.max(0, Math.round((sheetWidthPixels - width) / 2));
  const startCol = convertPixelsToColumnFloat(worksheet, lastColumnCount, horizontalOffsetPixels);
  worksheet.addImage(imageId, {
    tl: { col: startCol, row: startRowFloat },
    ext: { width, height },
  });
  const approxRows = Math.ceil((bannerHeightPoints + FOOTER_BOTTOM_GAP_POINTS) / (worksheet.properties.defaultRowHeight || 22));
  for (let row = startRow; row <= startRow + approxRows; row += 1) {
    worksheet.getRow(row).height = 22;
  }
  const footerBottomRow = getRowNumberAtPointPosition(worksheet, finalBottomPoints);
  const pageBottomRow = getRowNumberAtPointPosition(worksheet, footerPageBottomPoints);
  return {
    footerRow: startRow,
    footerRowFloat: Number(startRowFloat.toFixed(3)),
    footerBottomRow,
    imageWidthPixels: width,
    imageHeightPixels: height,
    estimatedPageCount: footerPageIndex + 1,
    endRow: pageBottomRow,
  };
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
  if (normalized.includes("rÃ©cup") || normalized.includes("recup")) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.blueSoft } };
    cell.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: PALETTE.blue } };
    return;
  }
  if (normalized.includes("arrÃªt") || normalized.includes("congÃ©") || normalized.includes("feriÃ©")) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.redSoft } };
    cell.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: PALETTE.red } };
  }
}

function populatePeriodTable(worksheet, monthData) {
  const columns = [
    { header: "Date", key: "date", width: 18, minWidth: 16, maxWidth: 21 },
    { header: "Type", key: "type", width: 15, minWidth: 13, maxWidth: 17 },
    { header: "Arrivée", key: "arrival", width: 12, minWidth: 10, maxWidth: 12 },
    { header: "Départ", key: "departure", width: 12, minWidth: 10, maxWidth: 12 },
    { header: "Pause", key: "pause", width: 10, minWidth: 9, maxWidth: 11 },
    { header: "Heures", key: "worked", width: 11, minWidth: 10, maxWidth: 12 },
    { header: "Sup", key: "overtime", width: 9, minWidth: 8, maxWidth: 10 },
    { header: "Statut", key: "status", width: 13, minWidth: 11, maxWidth: 15 },
    { header: "Commentaire", key: "comment", width: 40, minWidth: 28, maxWidth: 56 },
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
        "",
        entry.week_summary_label || "",
      ];
      applyWeekTotalStyle(row);
    } else {
      const statusLabel = getHistoryStatusLabel(entry);
      row.values = [
        formatDateDayMonthYearMultilineFr(entry.work_date),
        getDayTypeLabel(entry.day_type, entry.day_type_display),
        timeToExcelValue(entry.arrival_time_display),
        timeToExcelValue(entry.departure_time_display),
        entry.lunch_break_minutes_display === "" ? "" : Number(entry.lunch_break_minutes_display),
        hhmmToExcelDuration(entry.worked_hhmm),
        hhmmToExcelDuration(entry.overtime_hhmm),
        statusLabel,
        normalizeText(entry.comment_text),
      ];
      applyRegularDataStyle(row, currentRowNumber);
      applyStatusStyle(row.getCell(8), statusLabel);
    }

    row.height = 32;
    row.getCell(1).alignment = { vertical: "top", horizontal: "left", wrapText: true };
    row.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(3).numFmt = "hh:mm";
    row.getCell(4).numFmt = "hh:mm";
    row.getCell(5).alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(6).numFmt = "[h]:mm";
    row.getCell(7).numFmt = "[h]:mm";
    row.getCell(8).alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(9).alignment = { vertical: "top", horizontal: "left", wrapText: true };
    currentRowNumber += 1;
  }

  autofitWorksheetColumns(worksheet, columns);
  return currentRowNumber;
}

function populateHistoryTable(worksheet, entries) {
  const columns = [
    { header: "Date", width: 18, minWidth: 16, maxWidth: 21 },
    { header: "Type", width: 15, minWidth: 13, maxWidth: 17 },
    { header: "Arrivée", width: 12, minWidth: 10, maxWidth: 12 },
    { header: "Départ", width: 12, minWidth: 10, maxWidth: 12 },
    { header: "Pause", width: 10, minWidth: 9, maxWidth: 11 },
    { header: "Heures", width: 11, minWidth: 10, maxWidth: 12 },
    { header: "Sup", width: 9, minWidth: 8, maxWidth: 10 },
    { header: "Commentaire", width: 42, minWidth: 30, maxWidth: 58 },
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
      formatDateDayMonthYearMultilineFr(entry.work_date),
      getDayTypeLabel(entry.day_type, entry.day_type_display),
      timeToExcelValue(entry.arrival_time_display),
      timeToExcelValue(entry.departure_time_display),
      entry.lunch_break_minutes_display === "" ? "" : Number(entry.lunch_break_minutes_display),
      hhmmToExcelDuration(entry.worked_hhmm),
      hhmmToExcelDuration(entry.overtime_hhmm),
      normalizeText(entry.comment_text),
    ];
    applyRegularDataStyle(row, rowNumber);
    row.height = 32;
    row.getCell(1).alignment = { vertical: "top", horizontal: "left", wrapText: true };
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

async function buildPeriodWorkbook({ client, monthData, userSettings = {}, authUser = "", exportedAt = new Date() }) {
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
    {
      hasLogo,
      profileLine: buildProfileHeaderLine(userSettings, authUser, client),
      metaLine: buildMetaHeaderLine(
        client,
        `Du ${formatDateLongFr(monthData.payPeriodStartDate)} au ${formatDateLongFr(monthData.payPeriodEndDate)}`,
        exportedAt
      ),
    }
  );
  styleKpiStrip(worksheet, 5, monthData);
  styleDayTypeSummary(worksheet, 7, monthData.dayTypeCounts || {});

  const endTableRow = populatePeriodTable(worksheet, monthData);
  const bannerPlacement = addBrandBannerToWorksheet(workbook, worksheet, endTableRow + 1, 10);
  worksheet.pageSetup.printTitlesRow = `${WORKSHEET_HEADER_ROW}:${WORKSHEET_HEADER_ROW}`;
  worksheet.pageSetup.printArea = `A1:J${bannerPlacement.endRow}`;
  worksheet._brandBannerMeta = {
    lastDataRow: endTableRow - 1,
    footerRow: bannerPlacement.footerRow,
    footerRowFloat: bannerPlacement.footerRowFloat,
    footerBottomRow: bannerPlacement.footerBottomRow,
    imageWidthPixels: bannerPlacement.imageWidthPixels,
    imageHeightPixels: bannerPlacement.imageHeightPixels,
    estimatedPageCount: bannerPlacement.estimatedPageCount,
    printArea: worksheet.pageSetup.printArea,
  };

  return workbook;
}

async function buildHistoryWorkbook({ client, entries, userSettings = {}, authUser = "", exportedAt = new Date() }) {
  const workbook = new ExcelJS.Workbook();
  setWorkbookMetadata(workbook);
  const worksheet = workbook.addWorksheet(
    sanitizeWorksheetName(`Historique ${client.company_name || "Client"}`, "Historique")
  );
  setupSheetLayout(worksheet, "Historique des heures");

  const hasLogo = maybeAddClientLogo(workbook, worksheet, client);
  styleHeaderBand(worksheet, client, {
    hasLogo,
    profileLine: buildProfileHeaderLine(userSettings, authUser, client),
    metaLine: buildMetaHeaderLine(client, "Historique complet", exportedAt),
  });
  worksheet.getCell("A1").value = "HISTORIQUE DES HEURES";
  styleHistoryKpiStrip(worksheet, 5, client, entries);

  const endDataRow = populateHistoryTable(worksheet, entries);
  const bannerPlacement = addBrandBannerToWorksheet(workbook, worksheet, endDataRow + 1, 8);
  worksheet.pageSetup.printTitlesRow = `${HISTORY_HEADER_ROW}:${HISTORY_HEADER_ROW}`;
  worksheet.pageSetup.printArea = `A1:H${bannerPlacement.endRow}`;
  worksheet._brandBannerMeta = {
    lastDataRow: endDataRow - 1,
    footerRow: bannerPlacement.footerRow,
    footerRowFloat: bannerPlacement.footerRowFloat,
    footerBottomRow: bannerPlacement.footerBottomRow,
    imageWidthPixels: bannerPlacement.imageWidthPixels,
    imageHeightPixels: bannerPlacement.imageHeightPixels,
    estimatedPageCount: bannerPlacement.estimatedPageCount,
    printArea: worksheet.pageSetup.printArea,
  };
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
  getBrandBannerPath,
};


