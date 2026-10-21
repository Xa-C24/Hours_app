function normalizeCsvCell(value) {
  return String(value ?? "")
    .replace(/TÃ©lÃ©travail/g, "Télétravail")
    .replace(/CongÃ©s/g, "Congés")
    .replace(/ArrÃªt/g, "Arrêt")
    .replace(/FÃ©riÃ©/g, "Férié")
    .replace(/PÃ©riode/g, "Période")
    .replace(/journÃ©e/g, "journée")
    .replace(/journÃ©es/g, "journées")
    .replace(/travaillÃ©s/g, "travaillés")
    .replace(/ArrivÃ©e/g, "Arrivée")
    .replace(/DÃ©part/g, "Départ");
}

function escapeCsvValue(value) {
  const stringValue = normalizeCsvCell(value);
  // Spreadsheet applications may ignore leading whitespace/control characters
  // before deciding whether a cell begins with a formula. Prefix the original
  // value with Excel's text marker while preserving its visible content.
  const formulaCandidate = stringValue.replace(/^[\s\u0000-\u001f\u007f-\u009f\uFEFF]+/u, "");
  const safeValue = /^[=+\-@]/u.test(formulaCandidate) ? `'${stringValue}` : stringValue;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

module.exports = { escapeCsvValue, normalizeCsvCell };
