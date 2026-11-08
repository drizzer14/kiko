// Builds the bundled merchant category code names (code, en, uk) from two pinned community files.
// Pure functions only: the test regenerates the data file, this script never touches the disk.
//
// English names and codes, Unlicense (public domain, no attribution required):
//   https://raw.githubusercontent.com/greggles/mcc-codes/df792275c567946119a8903d36dbd33e44a248bf/mcc_codes.json
//   commit df792275c567946119a8903d36dbd33e44a248bf
//   SHA-256 60fff0a4457e18dd03731a8971f219f2d1e4b22a13c1d930aaac07badbfe8e68
//
// Ukrainian names, MIT, "Copyright (c) 2020 Sominemo" (the notice ships with the app):
//   https://raw.githubusercontent.com/Sominemo/MCC-Localize-Dataset/7b3cbceeb3fbbd6a27dbe489b25abe82552ddff2/mcc-loc.json
//   commit 7b3cbceeb3fbbd6a27dbe489b25abe82552ddff2
//   SHA-256 ed32d9bfca87862580d3228b1a23203a07e9a9152b4b1cca6bd2f0c765a01347
//
// A download is untrusted data: fetch each file into its own new, empty directory outside the
// repository, read it by path with JSON.parse only, and never execute it. Regenerate:
//   KIKO_REGEN_MCC=1 KIKO_MCC_GREGGLES=<greggles file> KIKO_MCC_SOMINEMO=<sominemo file> \
//   KIKO_MCC_REVIEW_OUT=<review table path> npx jest __tests__/generate-mcc-names.test.ts

const { createHash } = require('node:crypto');

const MCC_SOURCES = {
  greggles: {
    url: 'https://raw.githubusercontent.com/greggles/mcc-codes/df792275c567946119a8903d36dbd33e44a248bf/mcc_codes.json',
    commit: 'df792275c567946119a8903d36dbd33e44a248bf',
    sha256: '60fff0a4457e18dd03731a8971f219f2d1e4b22a13c1d930aaac07badbfe8e68',
    license: 'Unlicense',
  },
  sominemo: {
    url: 'https://raw.githubusercontent.com/Sominemo/MCC-Localize-Dataset/7b3cbceeb3fbbd6a27dbe489b25abe82552ddff2/mcc-loc.json',
    commit: '7b3cbceeb3fbbd6a27dbe489b25abe82552ddff2',
    sha256: 'ed32d9bfca87862580d3228b1a23203a07e9a9152b4b1cca6bd2f0c765a01347',
    license: 'MIT',
  },
};

const CODE_DIGITS = 4;
const CYRILLIC = 'А-Яа-яЁёІіЇїЄєҐґ';
// The catalogue rule of the Ukrainian locale: U+02BC is the only apostrophe inside a word.
const QUOTE_INSIDE_CYRILLIC_WORD = new RegExp(`(?<=[${CYRILLIC}])['’](?=[${CYRILLIC}])`, 'g');
const MODIFIER_LETTER_APOSTROPHE = 'ʼ';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const tidy = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

const padCode = (value) => {
  const text = String(value);

  if (!/^\d{1,4}$/.test(text)) {
    throw new Error(`MCC code is not four digits: ${JSON.stringify(value)}`);
  }

  return text.padStart(CODE_DIGITS, '0');
};

const englishNameOf = (row, code) => {
  const name = tidy(row.edited_description) || tidy(row.combined_description);

  if (name === '') {
    throw new Error(`MCC ${code} has no English name`);
  }

  return name;
};

const ukrainianNameOf = (sominemo, code) => {
  if (!hasOwn(sominemo, code) || sominemo[code] === null || typeof sominemo[code] !== 'object') {
    return undefined;
  }

  const name = tidy(sominemo[code].uk).replace(
    QUOTE_INSIDE_CYRILLIC_WORD,
    MODIFIER_LETTER_APOSTROPHE,
  );

  return name === '' ? undefined : name;
};

const englishNamesByCode = (greggles) => {
  const englishByCode = new Map();

  for (const row of greggles) {
    const code = padCode(row.mcc);
    const english = englishNameOf(row, code);

    if (englishByCode.has(code) && englishByCode.get(code) !== english) {
      throw new Error(`MCC ${code} has two different English names`);
    }

    englishByCode.set(code, english);
  }

  return englishByCode;
};

const buildMccNames = ({ greggles, sominemo }) => {
  const englishByCode = englishNamesByCode(greggles);
  const codes = [...englishByCode.keys()].sort();
  const withoutUkrainian = codes.filter((code) => ukrainianNameOf(sominemo, code) === undefined);

  if (withoutUkrainian.length > 0) {
    throw new Error(`No Ukrainian name for MCC ${withoutUkrainian.join(', ')}`);
  }

  return {
    entries: codes.map((code) => ({
      code,
      en: englishByCode.get(code),
      uk: ukrainianNameOf(sominemo, code),
    })),
    report: {
      dropped: Object.keys(sominemo)
        .filter((code) => !englishByCode.has(code))
        .sort(),
    },
  };
};

const verifySource = (text, expectedSha256) => {
  const actualSha256 = createHash('sha256').update(text).digest('hex');

  if (actualSha256 !== expectedSha256) {
    throw new Error(`Source SHA-256 ${actualSha256} differs from the pinned ${expectedSha256}`);
  }
};

const renderMccNamesJson = (entries) =>
  `${JSON.stringify(
    entries.map(({ code, en, uk }) => ({ code, en, uk })),
    null,
    2,
  )}\n`;

const renderReviewTable = (entries) =>
  entries.map(({ code, en, uk }) => `${code}\t${en}\t${uk}\n`).join('');

module.exports = {
  MCC_SOURCES,
  verifySource,
  buildMccNames,
  renderMccNamesJson,
  renderReviewTable,
};
