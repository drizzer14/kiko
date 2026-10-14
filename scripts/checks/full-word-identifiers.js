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
  'temp',
  'num',
  'arr',
  'obj',
  'str',
]);

// Every entry is a concrete, verified case where the identifier mirrors a
// name forced by a third-party API/format, not a choice made in this
// codebase (see kiko-code-style's "Full words in identifiers" exception
// list, and CLAUDE.md's "Documented exceptions" for the same "narrow,
// verifiable reason" standard). Keyed by (path suffix, word, EXACT
// identifier name) — name is required, not just word, so a file that uses
// the same denylisted word BOTH as a forced external name and as a free
// local choice (binance.transactions.ts: the wire-mirrored `txId` field
// stays, but `BinanceTxSyncDeps` — this codebase's own type name — does
// not) exempts only the one identifier it was verified against, not every
// identifier containing that word in the whole file.
const EXEMPTIONS = [
  {
    suffix: 'src/db/run-migrations.ts',
    word: 'idx',
    name: 'idx',
    reason: 'mirrors drizzle-kit’s own generated _journal.json {idx, when, tag} shape',
  },
  {
    suffix: 'src/db/run-migrations.test.ts',
    word: 'idx',
    name: 'idx',
    reason: 'same drizzle migration-journal shape as run-migrations.ts',
  },
  {
    suffix: 'src/db/schema.category-overrides.test.ts',
    word: 'idx',
    name: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/db/schema.change-group.test.ts',
    word: 'idx',
    name: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/db/schema.namespace-external-ids.test.ts',
    word: 'idx',
    name: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/db/schema.statement-mappings.test.ts',
    word: 'idx',
    name: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/db/schema.sync-state.test.ts',
    word: 'idx',
    name: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/db/schema.trend-filter.test.ts',
    word: 'idx',
    name: 'idx',
    reason: 'test fixture mirrors the drizzle migration-journal entry shape',
  },
  {
    suffix: 'src/bonds/nbu-register/nbu-register.ts',
    word: 'val',
    name: 'val_code',
    reason: 'val_code is the literal NBU register external JSON field name',
  },
  {
    suffix: 'src/bonds/nbu-register/nbu-register.test.ts',
    word: 'val',
    name: 'val_code',
    reason: 'val_code is the literal NBU register external JSON field name',
  },
  {
    suffix: 'src/bonds/nbu-register/nbu-register.ts',
    word: 'val',
    name: 'pay_val',
    reason: 'pay_val is the literal NBU register payments[] external JSON field name',
  },
  {
    suffix: 'src/bonds/nbu-register/nbu-register.test.ts',
    word: 'val',
    name: 'pay_val',
    reason: 'pay_val is the literal NBU register payments[] external JSON field name',
  },
  {
    suffix: 'src/crypto-sync/binance/binance.client.ts',
    word: 'msg',
    name: 'msg',
    reason: 'msg is the literal field name in a Binance error body {code, msg}',
  },
  {
    suffix: 'src/crypto-sync/binance/binance.client.test.ts',
    word: 'msg',
    name: 'msg',
    reason: 'msg is the literal field name in a Binance error body {code, msg}',
  },
  {
    suffix: 'src/design-system/components/currency-field/currency-field.component.tsx',
    word: 'num',
    name: 'initialNumToRender',
    reason: 'initialNumToRender is React Native FlatList’s own prop name',
  },
  {
    suffix: 'src/crypto-sync/btc-wallet/btc-wallet.client.test.ts',
    word: 'tx',
    name: 'tx_count',
    reason: 'tx_count is the literal Esplora/Blockstream address-stats API field name',
  },
  {
    suffix: 'src/crypto-sync/binance/binance.history-client.ts',
    word: 'tx',
    name: 'txId',
    reason: 'txId is the literal field name on Binance’s deposit/withdraw history records',
  },
  {
    suffix: 'src/crypto-sync/binance/binance.history-client.test.ts',
    word: 'tx',
    name: 'txId',
    reason: 'txId is the literal field name on Binance’s deposit/withdraw history records',
  },
  {
    suffix: 'src/crypto-sync/binance/binance.transactions.ts',
    word: 'tx',
    name: 'txId',
    reason: 'recordKey reads the same Binance record’s literal txId field',
  },
  {
    suffix: 'src/crypto-sync/binance/binance.transactions.test.ts',
    word: 'tx',
    name: 'txId',
    reason: 'fixtures mirror Binance’s literal txId field',
  },
  {
    suffix: 'src/crypto-sync/binance/binance.transactions.placement.test.ts',
    word: 'tx',
    name: 'txId',
    reason: 'fixtures mirror Binance’s literal txId field',
  },
  {
    suffix: 'src/crypto-sync/binance/binance.pay-history.real-sqlite.test.ts',
    word: 'tx',
    name: 'txId',
    reason: 'fixtures mirror Binance’s literal txId field',
  },
];

const isExempt = (targetPath, word, name) => {
  const normalized = targetPath.split(path.sep).join('/');

  return EXEMPTIONS.some(
    (exemption) =>
      exemption.word === word &&
      exemption.name === name &&
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
// opening bracket, nothing (start of file), or a keyword that only ever
// precedes an EXPRESSION, never a value to divide (`return /e/.test(...)`,
// `typeof /x/`) — a plain heuristic, not a full parser, but sufficient for
// this codebase's style (see kiko-linter's Semgrep gotchas for the same
// "good enough heuristic, not an AST parse" convention already used by
// import-order.js and one-component-per-file.ts).
const REGEX_START_CONTEXT =
  /[([{,;:=!&|?+\-*%^~<>]$|^$|\b(?:return|typeof|instanceof|in|of|yield|throw|new|void|delete|case|do|else)$/;

const isIdentifierChar = (char) => char !== undefined && /[A-Za-z0-9_$]/.test(char);

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

// Tries to consume one noise span (a line/block comment, a string, a
// template literal, or a regex literal) starting at `cursor`, given the
// blanked-so-far `resultSoFar` (needed only to test REGEX_START_CONTEXT).
// Returns null when `cursor` starts none of those — the shared stepper
// blankNoise and substitutionSpan both drive, so a literal is blanked the
// SAME way whether it appears at top level or inside a template
// substitution's own code.
const consumeNoiseSpan = (source, cursor, resultSoFar) => {
  const two = source.slice(cursor, cursor + 2);

  if (two === '//') {
    const stop = lineCommentEnd(source, cursor);
    return { text: blankSpan(source, cursor, stop), end: stop };
  }

  if (two === '/*') {
    const stop = blockCommentEnd(source, cursor);
    return { text: blankSpan(source, cursor, stop), end: stop };
  }

  const char = source[cursor];

  // A `'`/`"` preceded by an identifier character (`n` in "don't") is a
  // contraction or possessive inside JSX text, not a string opener — that
  // syntax position is never valid TS/JS otherwise, so this is a safe
  // heuristic, not a guess (ported from one-component-per-file.ts's
  // blankNoise, which hit the same apostrophe-in-JSX-text miss — see commit
  // c7efec5).
  if ((char === '"' || char === "'") && !isIdentifierChar(source[cursor - 1])) {
    const stop = stringLiteralEnd(source, cursor, char);
    return { text: blankSpan(source, cursor, stop), end: stop };
  }

  if (char === '`') {
    const template = templateLiteralSpan(source, cursor);
    return { text: template.text, end: template.end };
  }

  if (char === '/' && REGEX_START_CONTEXT.test(resultSoFar.replace(/\s+$/, ''))) {
    const stop = regexLiteralEnd(source, cursor);
    return { text: blankSpan(source, cursor, stop), end: stop };
  }

  return null;
};

// Scans forward from just after a template substitution's opening `${` to
// its matching `}`, tracking nested-brace depth so a `{` inside the
// expression (an object literal, a block) never ends the scan early — the
// substitution's own code stays visible to the identifier scanner (a bare
// `${tx}` must still flag `tx`), while any literal INSIDE it is still
// blanked via the shared consumeNoiseSpan stepper. Returns the blanked
// replacement text (same length as the source span, closing `}` included)
// and the index just past that `}`.
const substitutionSpan = (source, at) => {
  let result = '';
  let cursor = at;
  let depth = 0;

  while (cursor < source.length) {
    const span = consumeNoiseSpan(source, cursor, result);

    if (span) {
      result += span.text;
      cursor = span.end;
      continue;
    }

    const char = source[cursor];

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      if (depth === 0) {
        return { text: `${result}}`, end: cursor + 1 };
      }
      depth -= 1;
    }

    result += char;
    cursor += 1;
  }

  return { text: result, end: source.length };
};

// Blanks a template literal's LITERAL text but keeps each `${...}`
// substitution's own code visible (see substitutionSpan above) — unlike a
// plain string, a template can hold real identifiers the scanner must still
// see. `at` points at the opening backtick. Returns the full blanked
// replacement text (same length as the source span) and the index just past
// the closing backtick.
const templateLiteralSpan = (source, at) => {
  let result = '`';
  let cursor = at + 1;

  while (cursor < source.length) {
    const char = source[cursor];

    if (char === '\\' && cursor + 1 < source.length) {
      result += blankSpan(source, cursor, cursor + 2);
      cursor += 2;
      continue;
    }

    if (char === '`') {
      return { text: `${result}\``, end: cursor + 1 };
    }

    if (char === '$' && source[cursor + 1] === '{') {
      const substitution = substitutionSpan(source, cursor + 2);
      result += `\${${substitution.text}`;
      cursor = substitution.end;
      continue;
    }

    result += char === '\n' ? '\n' : ' ';
    cursor += 1;
  }

  return { text: result, end: source.length };
};

// Blanks (space-fills, preserving length and newlines) every string,
// template, comment, and regex-literal span, so a later identifier scan
// never matches text that only LOOKS like an identifier inside a literal —
// the same design as one-component-per-file.ts's blankNoise, extended with
// regex-literal handling (a bare letter inside a regex, e.g. the `e` in
// `/e([+-]\d+)/`, is not an identifier) and template-substitution handling
// (see consumeNoiseSpan/templateLiteralSpan/substitutionSpan above).
const blankNoise = (source) => {
  let result = '';
  let i = 0;

  while (i < source.length) {
    const span = consumeNoiseSpan(source, i, result);

    if (span) {
      result += span.text;
      i = span.end;
      continue;
    }

    result += source[i];
    i += 1;
  }

  return result;
};

// Splits an identifier into lowercase word parts on snake_case underscores,
// a `$` prefix, and camelCase/PascalCase transitions, including the
// acronym-run boundary (the "PAN" in "maskedPAN", the "BTC" in "isBTCEntry"
// — see kiko-code-style's "Variable naming" acronym rule): a LETTER
// followed by an uppercase starts a new word, and an uppercase run followed
// by a lowercase-starting word also starts a new word one character early
// (so "BTCEntry" splits as "BTC" + "Entry", not "BTCE" + "ntry"). A digit is
// deliberately NOT a split trigger either side — an acronym-with-digit run
// like "isE2E" stays ONE word ("e2e", not denylisted "e"), matching how a
// digit behaves inside a plain word (no one reads "isE2E" as three words).
const splitIdentifierWords = (name) =>
  name
    .split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[_$]/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());

// A property access on the built-in `Math` namespace (`Math.E`, `Math.PI`,
// ...) is never a name this codebase chose — JS/TS's own global, not an
// abbreviation to spell out. Detected structurally (immediately preceded by
// literal `Math.` in the line), not via the path-scoped EXEMPTIONS list
// above, since this can appear at any path.
const isMathConstant = (line, matchStart) =>
  line.slice(Math.max(0, matchStart - 5), matchStart) === 'Math.';

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
      const words = isMathConstant(line, match.index) ? [] : splitIdentifierWords(name);

      for (const word of words) {
        if (DENYLIST.has(word) && !isExempt(targetPath, word, name)) {
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
