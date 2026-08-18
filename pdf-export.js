const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");

const {
  buildExportFilename,
  getDayTypeLabel,
  getHistoryStatusLabel,
  formatCurrencyFromCents,
} = require("./excel-export");

const PAGE_SIZE = "A4";
const PAGE_MARGIN = 40;
const HEADER_HEIGHT = 106;
const FOOTER_HEIGHT = 38;
const CONTENT_TOP_GAP = 6;
const ROW_PADDING_Y = 4;
const FONT_CACHE = {};
const BRAND_BANNER_PATH = path.join(__dirname, "public", "bandeau_extract.png");

const EXPORT_THEME = {
  primary: "#1f4f82",
  secondary: "#4d83b8",
  panel: "#eef5fb",
  line: "#cad8e7",
  mutedRow: "#f7fbff",
};

const FONT_CANDIDATES = {
  regular: [
    path.join(__dirname, "assets", "fonts", "arial.ttf"),
    "C:\\Windows\\Fonts\\arial.ttf",
  ],
  bold: [
    path.join(__dirname, "assets", "fonts", "arialbd.ttf"),
    "C:\\Windows\\Fonts\\arialbd.ttf",
  ],
};

function getPalette() {
  return EXPORT_THEME;
}

function safeText(value) {
  return String(value ?? "").trim();
}

function formatDateLongFr(dateString) {
  if (!dateString) {
    return "";
  }
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return safeText(dateString);
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDateTimeFr(date) {
  return `${date.toLocaleDateString("fr-FR")} ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function resolveReadableFile(candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        fs.accessSync(candidate, fs.constants.R_OK);
        return candidate;
      }
    } catch (error) {
      // Continue until a readable candidate is found.
    }
  }
  return null;
}

function resolvePdfFontPaths() {
  if (!FONT_CACHE.paths) {
    const regular = resolveReadableFile(FONT_CANDIDATES.regular);
    const bold = resolveReadableFile(FONT_CANDIDATES.bold);
    if (!regular || !bold) {
      throw new Error("Aucune police Unicode lisible n'est disponible pour l'export PDF.");
    }
    FONT_CACHE.paths = { regular, bold };
  }
  return FONT_CACHE.paths;
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

function loadImageSource(logoValue) {
  if (typeof logoValue !== "string" || !logoValue.trim()) {
    return null;
  }
  const trimmedValue = logoValue.trim();
  const dataUrlMatch = trimmedValue.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (dataUrlMatch) {
    try {
      return Buffer.from(dataUrlMatch[1], "base64");
    } catch (error) {
      return null;
    }
  }
  if (/^https?:\/\//i.test(trimmedValue)) {
    return null;
  }
  if (fs.existsSync(trimmedValue)) {
    return trimmedValue;
  }
  return null;
}

function pickLogoSource(client, userSettings) {
  return (
    loadImageSource(client && client.company_logo) ||
    loadImageSource(userSettings && userSettings.companyLogo) ||
    null
  );
}

function createDocument(info) {
  const fontPaths = resolvePdfFontPaths();
  const doc = new PDFDocument({
    size: PAGE_SIZE,
    margins: {
      top: PAGE_MARGIN,
      right: PAGE_MARGIN,
      bottom: PAGE_MARGIN,
      left: PAGE_MARGIN,
    },
    bufferPages: true,
    compress: false,
    autoFirstPage: false,
    info,
  });
  doc.registerFont("AppHoursRegular", fontPaths.regular);
  doc.registerFont("AppHoursBold", fontPaths.bold);
  return doc;
}

function usePdfFont(doc, variant = "regular") {
  doc.font(variant === "bold" ? "AppHoursBold" : "AppHoursRegular");
  return doc;
}

function buildPdfInfo(typeLabel, clientName, profileName, companyName) {
  return {
    Title: `${typeLabel} - ${clientName || "Client"}`,
    Author: "App_Hours",
    Subject: `Client ${clientName || "Non renseigne"} | Profil ${profileName || "Utilisateur"} | Structure ${companyName || "Non renseignee"}`,
    Keywords: `${clientName || ""},${profileName || ""},App_Hours,PDF`,
    Creator: "App_Hours",
    Producer: "PDFKit",
  };
}

function buildCommonContext({ title, client, userSettings, authUser, extraMeta, exportedAt }) {
  const clientName = safeText(client && client.company_name) || "Non renseigné";
  const profileName = safeText(userSettings && userSettings.profileName) || safeText(authUser) || "Utilisateur";
  const companyName = safeText(userSettings && userSettings.companyName);
  return {
    title,
    subtitle: companyName ? `${profileName} • ${companyName}` : profileName,
    meta: [`Client ${clientName}`, extraMeta, `Généré le ${formatDateTimeFr(exportedAt)}`]
      .filter(Boolean)
      .join(" • "),
    logoSource: pickLogoSource(client, userSettings),
    clientName,
    profileName,
    companyName,
    accentColor: safeText(userSettings && userSettings.accentColor),
  };
}

function buildPeriodPdfModel({
  client,
  monthData,
  userSettings = {},
  authUser = "",
  exportedAt = new Date(),
}) {
  const periodLabel =
    safeText(monthData && monthData.payPeriodLabel) ||
    `Du ${formatDateLongFr(monthData.payPeriodStartDate)} au ${formatDateLongFr(monthData.payPeriodEndDate)}`;
  const context = buildCommonContext({
    title: "RAPPORT D'HEURES",
    client,
    userSettings,
    authUser,
    exportedAt,
    extraMeta: periodLabel,
  });

  const dayTypeSummary = Object.entries(monthData.dayTypeCounts || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([dayType, count]) => `${getDayTypeLabel(dayType)}: ${count}`)
    .join(" • ");

  const rows = (monthData.entries || []).map((entry) => ({
    date: entry.work_date_display || entry.work_date,
    type: getDayTypeLabel(entry.day_type, entry.day_type_display),
    arrival: entry.arrival_time_display || "-",
    departure: entry.departure_time_display || "-",
    pause: entry.lunch_break_minutes_display === "" ? "-" : String(entry.lunch_break_minutes_display),
    worked: entry.worked_hhmm || "00:00",
    overtime: entry.overtime_hhmm || "00:00",
    status: getHistoryStatusLabel(entry),
    comment: entry.comment_text || "",
  }));

  return {
    info: buildPdfInfo("Rapport d'heures", context.clientName, context.profileName, context.companyName),
    context,
    kpis: [
      { label: "Heures travaillées", value: safeText(monthData.totalHHMM) || "00:00" },
      { label: "Heures supplémentaires", value: safeText(monthData.totalOvertimeHHMM) || "00:00" },
      { label: "Récupérées", value: safeText(monthData.totalRecoveredHHMM) || "00:00" },
      { label: "Journées travaillées", value: String(monthData.workedDayCount || 0) },
    ],
    secondarySummary: [
      dayTypeSummary ? { label: "Répartition", value: dayTypeSummary } : null,
      Number.isInteger(monthData.salaryAmountCents)
        ? { label: "Salaire période", value: formatCurrencyFromCents(monthData.salaryAmountCents) }
        : null,
    ].filter(Boolean),
    rows,
    emptyMessage: "Aucune journée enregistrée sur cette période.",
    columns: [
      { key: "date", label: "Date", width: 58 },
      { key: "type", label: "Type", width: 72 },
      { key: "arrival", label: "Arrivée", width: 42, align: "center" },
      { key: "departure", label: "Départ", width: 42, align: "center" },
      { key: "pause", label: "Pause", width: 36, align: "center" },
      { key: "worked", label: "Heures", width: 44, align: "center" },
      { key: "overtime", label: "Sup", width: 40, align: "center" },
      { key: "status", label: "Statut", width: 52, align: "center" },
      { key: "comment", label: "Commentaire", width: 129 },
    ],
  };
}

function buildHistoryPdfModel({
  client,
  entries,
  userSettings = {},
  authUser = "",
  exportedAt = new Date(),
}) {
  const context = buildCommonContext({
    title: "HISTORIQUE DES HEURES",
    client,
    userSettings,
    authUser,
    exportedAt,
    extraMeta: "Archive complète",
  });
  const totalMinutes = (entries || []).reduce((sum, entry) => sum + Number(entry.worked_minutes || 0), 0);
  const totalOvertimeMinutes = (entries || []).reduce((sum, entry) => {
    const [hoursPart, minutesPart] = safeText(entry.overtime_hhmm || "00:00").split(":").map(Number);
    return sum + (Number.isFinite(hoursPart) ? hoursPart * 60 : 0) + (Number.isFinite(minutesPart) ? minutesPart : 0);
  }, 0);

  return {
    info: buildPdfInfo("Historique des heures", context.clientName, context.profileName, context.companyName),
    context,
    kpis: [
      { label: "Entrées", value: String((entries || []).length) },
      { label: "Heures travaillées", value: `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}` },
      { label: "Heures supplémentaires", value: `${Math.floor(totalOvertimeMinutes / 60)}:${String(totalOvertimeMinutes % 60).padStart(2, "0")}` },
      { label: "Client", value: context.clientName },
    ],
    secondarySummary: [],
    rows: (entries || []).map((entry) => ({
      date: entry.work_date_display || entry.work_date,
      type: getDayTypeLabel(entry.day_type, entry.day_type_display),
      arrival: entry.arrival_time_display || "-",
      departure: entry.departure_time_display || "-",
      pause: entry.lunch_break_minutes_display === "" ? "-" : String(entry.lunch_break_minutes_display),
      worked: entry.worked_hhmm || "00:00",
      overtime: entry.overtime_hhmm || "00:00",
      comment: entry.comment_text || "",
    })),
    emptyMessage: "Aucune entrée disponible dans l'historique de ce client.",
    columns: [
      { key: "date", label: "Date", width: 62 },
      { key: "type", label: "Type", width: 78 },
      { key: "arrival", label: "Arrivée", width: 42, align: "center" },
      { key: "departure", label: "Départ", width: 42, align: "center" },
      { key: "pause", label: "Pause", width: 36, align: "center" },
      { key: "worked", label: "Heures", width: 44, align: "center" },
      { key: "overtime", label: "Sup", width: 40, align: "center" },
      { key: "comment", label: "Commentaire", width: 171 },
    ],
  };
}

function renderPageShell(doc, palette, context) {
  const pageWidth = doc.page.width;
  const innerWidth = pageWidth - PAGE_MARGIN * 2;

  doc.save();
  doc.roundedRect(PAGE_MARGIN, PAGE_MARGIN, innerWidth, 82, 12).fill(palette.panel);
  doc.restore();

  doc.save();
  doc.roundedRect(PAGE_MARGIN, PAGE_MARGIN, innerWidth, 10, 12).fill(palette.secondary);
  doc.restore();

  usePdfFont(doc, "bold")
    .fillColor("#111827")
    .fontSize(21)
    .text(context.title, PAGE_MARGIN + 16, PAGE_MARGIN + 18, {
      width: innerWidth - (context.logoSource ? 98 : 16),
    });

  usePdfFont(doc, "regular")
    .fillColor("#374151")
    .fontSize(10.5)
    .text(context.subtitle, PAGE_MARGIN + 16, PAGE_MARGIN + 46, {
      width: innerWidth - (context.logoSource ? 98 : 16),
    });

  usePdfFont(doc, "regular")
    .fillColor("#6b7280")
    .fontSize(8.5)
    .text(context.meta, PAGE_MARGIN + 16, PAGE_MARGIN + 62, {
      width: innerWidth - (context.logoSource ? 98 : 16),
    });

  if (context.logoSource) {
    try {
      doc.image(context.logoSource, pageWidth - PAGE_MARGIN - 66, PAGE_MARGIN + 18, {
        fit: [50, 50],
        align: "center",
        valign: "center",
      });
    } catch (error) {
      // Keep export functional even when the configured logo is malformed.
    }
  }
}

function renderBrandBanner(doc, y) {
  const bannerPath = getBrandBannerPath();
  if (!bannerPath) {
    return y;
  }
  const bannerSize = readPngDimensions(bannerPath);
  if (!bannerSize || !bannerSize.width || !bannerSize.height) {
    return y;
  }
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;
  const width = maxWidth;
  const height = Math.round((bannerSize.height / bannerSize.width) * width);
  doc.image(bannerPath, PAGE_MARGIN, y, {
    width,
    height,
  });
  return y + height;
}

function finalizeFooters(doc, palette) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    doc.save();
    doc.moveTo(PAGE_MARGIN, doc.page.height - PAGE_MARGIN - 18)
      .lineTo(doc.page.width - PAGE_MARGIN, doc.page.height - PAGE_MARGIN - 18)
      .strokeColor(palette.line)
      .lineWidth(1)
      .stroke();
    doc.restore();
    usePdfFont(doc, "regular")
      .fillColor("#4b5563")
      .fontSize(9)
      .text(`Page ${index + 1} / ${range.count}`, PAGE_MARGIN, doc.page.height - PAGE_MARGIN - 8, {
        align: "right",
        width: doc.page.width - PAGE_MARGIN * 2,
      });
  }
}

function startPage(doc, palette, context) {
  doc.addPage();
  renderPageShell(doc, palette, context);
  return PAGE_MARGIN + HEADER_HEIGHT + CONTENT_TOP_GAP;
}

function renderKpiCards(doc, y, palette, cards) {
  const visibleCards = cards.filter((card) => safeText(card.value));
  const gap = 8;
  const cardWidth = (doc.page.width - PAGE_MARGIN * 2 - gap * 3) / 4;
  let x = PAGE_MARGIN;
  visibleCards.slice(0, 4).forEach((card) => {
    doc.save();
    doc.roundedRect(x, y, cardWidth, 48, 9).fill("#ffffff").strokeColor(palette.line).lineWidth(0.9).stroke();
    doc.restore();
    usePdfFont(doc, "regular")
      .fillColor("#6b7280")
      .fontSize(8.2)
      .text(card.label, x + 10, y + 9, { width: cardWidth - 20 });
    usePdfFont(doc, "bold")
      .fillColor("#111827")
      .fontSize(card.value.length > 18 ? 10.5 : 15.5)
      .text(card.value, x + 10, y + 22, { width: cardWidth - 20 });
    x += cardWidth + gap;
  });
  return y + 56;
}

function renderSummaryLine(doc, y, palette, label, value) {
  usePdfFont(doc, "bold").fillColor(palette.primary).fontSize(10.2).text(label, PAGE_MARGIN, y);
  usePdfFont(doc, "regular")
    .fillColor("#374151")
    .fontSize(9.4)
    .text(value, PAGE_MARGIN + 96, y, {
      width: doc.page.width - PAGE_MARGIN * 2 - 96,
    });
  return y + 14;
}

function renderTableHeader(doc, y, columns, palette) {
  let x = PAGE_MARGIN;
  doc.save();
  doc.roundedRect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, 22, 7).fill(palette.primary);
  doc.restore();
  usePdfFont(doc, "bold").fillColor("#ffffff").fontSize(8.5);
  columns.forEach((column) => {
    doc.text(column.label, x + 4, y + 6.5, {
      width: column.width - 8,
      align: column.align || "left",
    });
    x += column.width;
  });
  return y + 25;
}

function estimateRowHeight(doc, row, columns) {
  let maxHeight = 16;
  columns.forEach((column) => {
    const textHeight = doc.heightOfString(safeText(row[column.key]) || " ", {
      width: column.width - 8,
      align: column.align || "left",
    });
    maxHeight = Math.max(maxHeight, textHeight + ROW_PADDING_Y * 2);
  });
  return maxHeight;
}

function renderRow(doc, y, row, columns, fillColor) {
  const rowHeight = estimateRowHeight(doc, row, columns);
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  let x = PAGE_MARGIN;

  doc.save();
  doc.roundedRect(PAGE_MARGIN, y, totalWidth, rowHeight, 3).fill(fillColor);
  doc.restore();
  doc.strokeColor("#e5e7eb").lineWidth(0.7).rect(PAGE_MARGIN, y, totalWidth, rowHeight).stroke();

  usePdfFont(doc, "regular").fillColor("#111827").fontSize(8.6);
  columns.forEach((column) => {
    doc.text(safeText(row[column.key]), x + 4, y + ROW_PADDING_Y, {
      width: column.width - 8,
      align: column.align || "left",
    });
    x += column.width;
  });

  return rowHeight + 3;
}

function renderEmptyStateRow(doc, y, palette, columns, message) {
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  doc.save();
  doc.roundedRect(PAGE_MARGIN, y, totalWidth, 34, 5).fill("#ffffff").strokeColor(palette.line).lineWidth(0.9).stroke();
  doc.restore();
  usePdfFont(doc, "regular")
    .fillColor("#6b7280")
    .fontSize(9.2)
    .text(message, PAGE_MARGIN + 10, y + 11, {
      width: totalWidth - 20,
      align: "center",
    });
  return y + 37;
}

function getBodyBottomLimit(doc) {
  return doc.page.height - PAGE_MARGIN - FOOTER_HEIGHT;
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

async function renderPdfBuffer(model, accentColor) {
  const palette = getPalette(accentColor);
  const doc = createDocument(model.info);
  let y = startPage(doc, palette, model.context);
  y = renderKpiCards(doc, y, palette, model.kpis);

  for (const summaryLine of model.secondarySummary || []) {
    y = renderSummaryLine(doc, y + 1, palette, summaryLine.label, summaryLine.value);
  }

  y = renderTableHeader(doc, y + 4, model.columns, palette);

  if (!model.rows.length) {
    y = renderEmptyStateRow(doc, y, palette, model.columns, model.emptyMessage);
  } else {
    model.rows.forEach((row, index) => {
      usePdfFont(doc, "regular").fontSize(8.6);
      const rowHeight = estimateRowHeight(doc, row, model.columns) + 3;
      if (y + rowHeight > getBodyBottomLimit(doc)) {
        y = startPage(doc, palette, model.context);
        y = renderTableHeader(doc, y, model.columns, palette);
      }
      y += renderRow(doc, y, row, model.columns, index % 2 === 0 ? "#ffffff" : palette.mutedRow);
    });
  }

  const bannerPath = getBrandBannerPath();
  if (bannerPath) {
    const bannerSize = readPngDimensions(bannerPath);
    if (bannerSize && bannerSize.width && bannerSize.height) {
      const bannerHeight = Math.round(
        (bannerSize.height / bannerSize.width) * (doc.page.width - PAGE_MARGIN * 2)
      );
      const requiredHeight = 18 + bannerHeight;
      if (y + requiredHeight > getBodyBottomLimit(doc)) {
        y = startPage(doc, palette, model.context);
      } else {
        y += 18;
      }
      y = renderBrandBanner(doc, y);
    }
  }

  finalizeFooters(doc, palette);
  return collectPdf(doc);
}

async function buildPeriodPdfBuffer(options) {
  const model = buildPeriodPdfModel(options);
  return renderPdfBuffer(model, options.userSettings && options.userSettings.accentColor);
}

async function buildHistoryPdfBuffer(options) {
  const model = buildHistoryPdfModel(options);
  return renderPdfBuffer(model, options.userSettings && options.userSettings.accentColor);
}

module.exports = {
  buildPeriodPdfBuffer,
  buildHistoryPdfBuffer,
  buildPeriodPdfModel,
  buildHistoryPdfModel,
  buildExportFilename,
  resolvePdfFontPaths,
  getBrandBannerPath,
};
