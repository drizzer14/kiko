// kiko-code-style's "One component per file" mechanized as a Jest invariant
// (see kiko-linter's "One exported component per .tsx" section for why a
// Jest invariant and not Semgrep — Semgrep has no same-file cross-declaration
// cardinality primitive). This scans a `.tsx` source string and returns the
// name of every top-level, EXPORTED, component-like declaration; the
// invariant test asserts every real file returns at most one.

const blankSpan = (source: string, start: number, end: number): string =>
  source.slice(start, end).replace(/[^\n]/g, ' ');

const lineCommentEnd = (source: string, at: number): number => {
  const end = source.indexOf('\n', at);

  return end === -1 ? source.length : end;
};

const blockCommentEnd = (source: string, at: number): number => {
  const end = source.indexOf('*/', at + 2);

  return end === -1 ? source.length : end + 2;
};

const stringLiteralEnd = (source: string, at: number, quote: string): number => {
  let cursor = at + 1;

  while (cursor < source.length && source[cursor] !== quote) {
    cursor += source[cursor] === '\\' ? 2 : 1;
  }

  return Math.min(cursor + 1, source.length);
};

const isIdentifierChar = (char: string | undefined): boolean =>
  char !== undefined && /[A-Za-z0-9_$]/.test(char);

// A `/` starts a regex literal (rather than division) when the last
// significant character emitted so far is a punctuation/operator context, an
// opening bracket, or nothing (start of file) — the same heuristic
// full-word-identifiers.js's blankNoise uses, needed here for the same
// reason: a quote INSIDE a regex literal (`/'/g`) is not a string opener.
const REGEX_START_CONTEXT = /[([{,;:=!&|?+\-*%^~<>]$|^$/;

const consumeRegexFlags = (source: string, at: number): number => {
  let cursor = at;

  while (cursor < source.length && /[a-z]/i.test(source[cursor] as string)) {
    cursor += 1;
  }

  return cursor;
};

const regexLiteralEnd = (source: string, at: number): number => {
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
// template, comment, and regex-literal span, so a later regex never matches
// text that only LOOKS like a declaration inside a literal. A `'`/`"`
// preceded by an identifier character (`n` in "don't") is a contraction or
// possessive inside JSX text, not a string opener — that syntax position is
// never valid TS/JS otherwise, so this is a safe heuristic, not a guess; a
// backtick keeps the old unconditional behavior since a tagged template
// (`` tag`...` ``) legitimately opens right after an identifier.
const blankNoise = (source: string): string => {
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

    if ((quote === '"' || quote === "'") && !isIdentifierChar(source[i - 1])) {
      const stop = stringLiteralEnd(source, i, quote);
      result += blankSpan(source, i, stop);
      i = stop;
      continue;
    }

    if (quote === '`') {
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

// A top-level (column-0) declaration opener — Biome formats every top-level
// statement flush-left, so this is a reliable boundary in this codebase.
// `export default memo(Name);` and a named export list (`export { A, B };`,
// but NOT a re-export `export { A } from '...';` — that `}` is followed by
// `from`, not `;`) are both openers too, so a slice starting there is never
// silently folded into whatever slice precedes it.
const TOP_LEVEL_DECL =
  /^(export\s+default\s+function\s+\w|export\s+function\s+\w|export\s+default\s+memo\(\s*\w+\s*\)\s*;|export\s+default\s+\w+\s*;|export\s+const\s+\w|export\s*\{[^}]*\}\s*;|const\s+\w|function\s+\w)/gm;

const declarationSlices = (source: string): string[] => {
  const starts: number[] = [];
  TOP_LEVEL_DECL.lastIndex = 0;

  for (
    let match = TOP_LEVEL_DECL.exec(source);
    match !== null;
    match = TOP_LEVEL_DECL.exec(source)
  ) {
    starts.push(match.index);
  }

  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
};

// True when a declaration's own slice (from its opener to the next top-level
// declaration, or EOF) reads as a component: an explicit `return` into JSX, a
// concise arrow directly returning JSX, or an `FC`/`FunctionComponent` type
// annotation on the declaration line itself.
const looksLikeComponent = (slice: string): boolean => {
  if (/(return|=>)\s*\(?\s*\n?\s*<[A-Za-z]/.test(slice)) {
    return true;
  }

  const firstNewline = slice.indexOf('\n');
  const declarationLine = slice.slice(0, firstNewline === -1 ? slice.length : firstNewline);

  return /:\s*(FC|FunctionComponent)\b/.test(declarationLine);
};

type SliceClassification =
  | { kind: 'exportedComponent'; name: string }
  | { kind: 'defaultAlias'; target: string }
  | { kind: 'namedExportList'; names: string[] }
  | { kind: 'localDeclaration'; name: string }
  | { kind: 'other' };

const classifySlice = (slice: string): SliceClassification => {
  // Covers all 3 direct-export shapes at once: `export default function
  // Name`, `export function Name`, `export const Name` — `default` is
  // optional, and only `function`/`const` ever introduce a component this
  // way (a bare `export default Name;`/`export default memo(Name);` alias
  // is handled separately below, since there is no declaration here to
  // classify, only a reference to one).
  const exportedDeclaration = /^export\s+(?:default\s+)?(?:function|const)\s+(\w+)/.exec(slice);

  if (exportedDeclaration) {
    return looksLikeComponent(slice)
      ? { kind: 'exportedComponent', name: exportedDeclaration[1] as string }
      : { kind: 'other' };
  }

  const defaultMemoAlias = /^export\s+default\s+memo\(\s*(\w+)\s*\)\s*;/.exec(slice);

  if (defaultMemoAlias) {
    return { kind: 'defaultAlias', target: defaultMemoAlias[1] as string };
  }

  const defaultAlias = /^export\s+default\s+(\w+)\s*;/.exec(slice);

  if (defaultAlias) {
    return { kind: 'defaultAlias', target: defaultAlias[1] as string };
  }

  // A re-export (`export { A } from '...';`) never reaches here — its `}` is
  // followed by `from`, not `;`, so TOP_LEVEL_DECL never opens a slice there
  // in the first place; its name resolves against a module this file never
  // declared, not a local one.
  const namedExportList = /^export\s*\{([^}]*)\}\s*;/.exec(slice);

  if (namedExportList) {
    const names = (namedExportList[1] as string)
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => (entry.split(/\s+as\s+/)[0] as string).trim());

    return { kind: 'namedExportList', names };
  }

  const bareConst = /^const\s+(\w+)/.exec(slice);

  if (bareConst) {
    return { kind: 'localDeclaration', name: bareConst[1] as string };
  }

  const bareFunction = /^function\s+(\w+)/.exec(slice);

  if (bareFunction) {
    return { kind: 'localDeclaration', name: bareFunction[1] as string };
  }

  return { kind: 'other' };
};

// A jest.mock(...) factory body cannot syntactically contain a top-level
// `export` (export is only valid at module scope) or, by the same token, a
// top-level `const`/`function` — TOP_LEVEL_DECL only matches column-0, and a
// factory body is always indented — so an inline mock component inside one
// is never mistaken for an exported declaration, and its own local
// `const`/`function` names never leak into `localDeclarations` either. No
// separate blanking pass is needed to enforce that; it falls out of the
// column-0 opener requirement already in place for every other reason.
export const exportedComponentNames = (rawSource: string): string[] => {
  const source = blankNoise(rawSource);
  const slices = declarationSlices(source);

  const localDeclarations = new Map<string, string>();
  const exportedNames: string[] = [];
  const aliasTargets: string[] = [];

  for (const slice of slices) {
    const classified = classifySlice(slice);

    if (classified.kind === 'exportedComponent') {
      exportedNames.push(classified.name);
    }

    if (classified.kind === 'defaultAlias') {
      aliasTargets.push(classified.target);
    }

    if (classified.kind === 'namedExportList') {
      aliasTargets.push(...classified.names);
    }

    if (classified.kind === 'localDeclaration') {
      localDeclarations.set(classified.name, slice);
    }
  }

  for (const target of aliasTargets) {
    const declared = localDeclarations.get(target);

    if (declared !== undefined && looksLikeComponent(declared)) {
      exportedNames.push(target);
    }
  }

  return [...new Set(exportedNames)];
};
