const ROOT_PALETTE_SELECTOR = /^:root(?:\[data-theme="[a-z0-9-]+"\])?$/i;

function findBlockEnd(source, openingBrace) {
  let depth = 1;
  let inComment = false;

  for (let index = openingBrace + 1; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (current === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }

    if (current === "{") depth += 1;
    if (current === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function extractCustomProperties(block) {
  return block
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => /^--[\w-]+\s*:/.test(declaration))
    .map((declaration) => `${declaration};`);
}

function extractThemeTokenRules(sourceCss) {
  if (typeof sourceCss !== "string") throw new TypeError("CSS source must be a string");

  // The app stylesheet imports remote web fonts before its first token block.
  // Strip imports and comments so this endpoint emits local palette values only.
  const localCss = sourceCss
    .replace(/^[ \t]*@import[^\r\n]*(?:\r?\n|$)/gim, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  let cursor = 0;

  while (cursor < localCss.length) {
    const openingBrace = localCss.indexOf("{", cursor);
    if (openingBrace < 0) break;

    const selector = localCss.slice(cursor, openingBrace).trim();
    const closingBrace = findBlockEnd(localCss, openingBrace);
    if (closingBrace < 0) break;

    const selectors = selector.split(",").map((part) => part.trim());
    if (selectors.length && selectors.every((part) => ROOT_PALETTE_SELECTOR.test(part))) {
      const properties = extractCustomProperties(localCss.slice(openingBrace + 1, closingBrace));
      if (properties.length) rules.push(`${selector} {\n  ${properties.join("\n  ")}\n}`);
    }

    cursor = closingBrace + 1;
  }

  return `${rules.join("\n\n")}\n`;
}

module.exports = { extractThemeTokenRules };
