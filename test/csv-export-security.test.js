const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeCsvValue, normalizeCsvCell } = require("../services/csv-export");

test("CSV cells neutralize formula prefixes even after leading whitespace and controls", () => {
  for (const prefix of ["=", "+", "-", "@"] ) {
    assert.equal(escapeCsvValue(`${prefix}SUM(1,1)`), `"'${prefix}SUM(1,1)"`);
    assert.equal(escapeCsvValue(` \t\r\n${prefix}1+1`), `"' \t\r\n${prefix}1+1"`);
    assert.equal(escapeCsvValue(`\u0000\u001f${prefix}1+1`), `"'\u0000\u001f${prefix}1+1"`);
  }
});

test("CSV quoting preserves ordinary French text, separators, quotes, and line breaks", () => {
  assert.equal(escapeCsvValue("Télétravail"), '"Télétravail"');
  assert.equal(escapeCsvValue('Client, "Dupont"\nligne 2'), '"Client, ""Dupont""\nligne 2"');
  assert.equal(escapeCsvValue("- lundi"), "\"'- lundi\"");
});

test("CSV legacy text normalization preserves literals outside its established corrections", () => {
  assert.equal(normalizeCsvCell("Télétravail"), "Télétravail");
  assert.equal(normalizeCsvCell("travail déjà écrit"), "travail déjà écrit");
  assert.equal(normalizeCsvCell("travailÃ©e"), "travailÃ©e");
  assert.equal(normalizeCsvCell("journÃ©e"), "journée");
});
