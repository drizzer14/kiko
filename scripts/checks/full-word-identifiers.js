#!/usr/bin/env node

// Mechanizes kiko-code-style's "Full words in identifiers" rule: no
// abbreviated word as a whole camelCase/PascalCase/snake_case PART of a
// variable, parameter, function, type, or prop name. The denylist below is
// the exact table from that skill section — not a superset, not a guess.
//
// A hand-rolled scanner, not Semgrep: Semgrep has no primitive that splits an
// identifier into camelCase/snake_case parts and tests each part against a
// word list across every identifier-bearing syntax position (declarations,
// parameters, type members, destructuring, JSX props) at once — see the
// kiko-linter skill's "Import length-sort" section for the same class of
// gap. This follows that file's shape: blank noise first, then scan.

const fs = require('node:fs');
const path = require('node:path');

const DENYLIST = new Set([
  'cond',
  'btn',
  'idx',
  'acc',
  'tx',
  'err',
  'val',
  'prev',
  'cfg',
  'e',
  'res',
  'msg',
  'cb',
  'ctx',
  'el',
  'opts',
  'tmp',
  'num',
  'arr',
  'obj',
  'str',
]);

// Every entry is a concrete, verified case where the identifier mirrors a
// name forced by a third-party API/format, not a choice made in this
// codebase (see kiko-code-style's "Full words in identifiers" exception
// list, and CLAUDE.md's "Documented exceptions" for the same "narrow,
// verifiable reason" standard). Keyed by (path suffix, word), not by word
// alone, so the exemption stays scoped to the one file it was verified
// against — a denylisted word anywhere else still fails.
const EXEMPTIONS = [
  {
    suffix: 'src/db/run-migrations.ts',
    word: 'idx',
    reason: 'mirrors drizzle-kit’s own generated _journal.json {idx, when, tag} shape',
  },
  {
    suffix: 'src/db/run-migrations.test.ts',
    word: 'idx',
    reason: 'same drizzle migration-journal shape as run-migrations.ts',
  },
  {
    suffix: 'src/db/schema.category-overrides.test.ts',
    word: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/db/schema.change-group.test.ts',
    word: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/db/schema.namespace-external-ids.test.ts',
    word: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/db/schema.statement-mappings.test.ts',
    word: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/db/schema.sync-state.test.ts',
    word: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/db/schema.trend-filter.test.ts',
    word: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/bonds/nbu-register/nbu-register.ts',
    word: 'val',
    reason: 'val_code is the literal NBU register external JSON field name',
  },
  {
    suffix: 'src/bonds/nbu-register/nbu-register.test.ts',
    word: 'val',
    reason: 'val_code is the literal NBU register external JSON field name',
  },
  {
    suffix: 'src/crypto-sync/binance/binance.client.ts',
    word: 'msg',
    reason: 'msg is the literal field name in a Binance error body {code, msg}',
  },
  {
    suffix: 'src/crypto-sync/binance/binance.client.test.ts',
    word: 'msg',
    reason: 'msg is the literal field name in a Binance error body {code, msg}',
  },
  {
    suffix: 'src/design-system/components/currency-field/currency-field.component.tsx',
    word: 'num',
    reason: 'initialNumToRender is React Native FlatList’s own prop name',
  },
  {
    suffix: 'src/crypto-sync/btc-wallet/btc-wallet.client.test.ts',
    word: 'tx',
    reason: 'tx_count is the literal Esplora/Blockstream address-stats API field name',
  },
];

const isExempt = (targetPath, word) => {
  const normalized = targetPath.split(path.sep).join('/');

  return EXEMPTIONS.some(
    (exemption) =>
      exemption.word === word &&
      (normalized === exemption.suffix || normalized.endsWith(`/${exemption.suffix}`)),
  );
};

const blankSpan = (source, start, end) => source.slice(start, end).replace(/[^\n]/g, ' ');

const lineCommentEnd = (source, at) => {
  const end = source.indexOf('\n', at);

  return end === -1 ? source.length : end;
};

const blockCommentEnd = (source, at) => {
  const end = source.indexOf('*/', at + 2);

  return end === -1 ? source.length : end + 2;
};

const stringLiteralEnd = (source, at, quote) => {
  let cursor = at + 1;

  while (cursor < source.length && source[cursor] !== quote) {
    cursor += source[cursor] === '\\' ? 2 : 1;
  }

  return Math.min(cursor + 1, source.length);
};

// A `/` starts a regex literal (rather than division) when the last
// significant character emitted so far is a punctuation/operator context, an
// opening bracket, or nothing (start of file) — a plain heuristic, not a full
// parser, but sufficient for this codebase's style (see kiko-linter's
// Semgrep gotchas for the same "good enough heuristic, not an AST parse"
// convention already used by import-order.js and one-component-per-file.ts).
const REGEX_START_CONTEXT = /[([{,;:=!&|?+\-*%^~<>]$|^$/;

const consumeRegexFlags = (source, at) => {
  let cursor = at;

  while (cursor < source.length && /[a-z]/i.test(source[cursor])) {
    cursor += 1;
  }

  return cursor;
};

const regexLiteralEnd = (source, at) => {
  let cursor = at + 1;
  let inClass = false;

  while (cursor < source.length) {
    const char = source[cursor];

    if (char === '\\') {
      cursor += 2;
      continue;
    }

    if (char === '\n') {
      return cursor;
    }

    if (char === '[') {
      inClass = true;
    } else if (char === ']') {
      inClass = false;
    } else if (char === '/' && !inClass) {
      return consumeRegexFlags(source, cursor + 1);
    }

    cursor += 1;
  }

  return source.length;
};

// Blanks (space-fills, preserving length and newlines) every string,
// template, comment, and regex-literal span, so a later identifier scan
// never matches text that only LOOKS like an identifier inside a literal —
// the same design as one-component-per-file.ts's blankNoise, extended with
// regex-literal handling (a bare letter inside a regex, e.g. the `e` in
// `/e([+-]\d+)/`, is not an identifier).
const blankNoise = (source) => {
  let result = '';
  let i = 0;

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      const stop = lineCommentEnd(source, i);
      result += blankSpan(source, i, stop);
      i = stop;
      continue;
    }

    if (two === '/*') {
      const stop = blockCommentEnd(source, i);
      result += blankSpan(source, i, stop);
      i = stop;
      continue;
    }

    const quote = source[i];

    if (quote === '"' || quote === "'" || quote === '`') {
      const stop = stringLiteralEnd(source, i, quote);
      result += blankSpan(source, i, stop);
      i = stop;
      continue;
    }

    if (quote === '/' && REGEX_START_CONTEXT.test(result.replace(/\s+$/, ''))) {
      const stop = regexLiteralEnd(source, i);
      result += blankSpan(source, i, stop);
      i = stop;
      continue;
    }

    result += source[i];
    i += 1;
  }

  return result;
};

// Splits an identifier into lowercase word parts on snake_case underscores
// and camelCase/PascalCase transitions, including the acronym-run boundary
// (the "PAN" in "maskedPAN", the "BTC" in "isBTCEntry" — see kiko-code-style's
// "Variable naming" acronym rule): a lowercase/digit followed by an
// uppercase starts a new word, and an uppercase run followed by a
// lowercase-starting word also starts a new word one character early (so
// "BTCEntry" splits as "BTC" + "Entry", not "BTCE" + "ntry").
const splitIdentifierWords = (name) =>
  name
    .split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|_/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());

const IDENTIFIER = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;

// Returns one violation per (line, identifier, denylisted word) found in
// `source`, skipping any (targetPath, word) pair on the exact-path
// allowlist above.
const findViolations = (source, targetPath) => {
  const blanked = blankNoise(source);
  const lines = blanked.split('\n');
  const violations = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    IDENTIFIER.lastIndex = 0;
    let match = IDENTIFIER.exec(line);

    while (match !== null) {
      const name = match[0];
      const words = splitIdentifierWords(name);

      for (const word of words) {
        if (DENYLIST.has(word) && !isExempt(targetPath, word)) {
          violations.push(
            `${targetPath}:${lineIndex + 1}: \`${name}\` — abbreviated word \`${word}\` (write the full word)`,
          );
        }
      }

      match = IDENTIFIER.exec(line);
    }
  }

  return violations;
};

module.exports = { DENYLIST, findViolations, isExempt, splitIdentifierWords };

function runCli() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    process.stderr.write('usage: full-word-identifiers.js <file...>\n');
    process.exit(2);
  }

  let anyViolation = false;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const violations = findViolations(source, file);

    if (violations.length > 0) {
      anyViolation = true;
      process.stdout.write(`${violations.join('\n')}\n`);
    }
  }

  process.exit(anyViolation ? 1 : 0);
}

if (require.main === module) {
  runCli();
}
