// kiko-code-style's "One component per file" mechanized as a Jest invariant
// (see kiko-linter's R1.b entry for why a Jest invariant and not Semgrep —
// Semgrep has no same-file cross-declaration cardinality primitive). This
// scans a `.tsx` source string and returns the name of every top-level,
// EXPORTED, component-like declaration; the invariant test asserts every real
// file returns at most one.

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

// Blanks (space-fills, preserving length and newlines) every string,
// template, and comment span, so a later regex never matches text that only
// LOOKS like a declaration inside a literal.
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

    if (quote === '"' || quote === "'" || quote === '`') {
      const stop = stringLiteralEnd(source, i, quote);
      result += blankSpan(source, i, stop);
      i = stop;
      continue;
    }

    result += source[i];
    i += 1;
  }

  return result;
};

// A jest.mock(...) factory body cannot syntactically contain a top-level
// `export` (export is only valid at module scope), so a name-scanner keyed on
// the literal `export` keyword can never mistake an inline mock component for
// an exported one. This blanking is still done — matching the R1 brief's
// design — as a second, explicit layer: it also removes any stray
// `const`/`function` text a mock factory defines, so a later "was this local
// name later default-exported?" lookup never accidentally resolves to
// something declared only inside a mock.
const blankJestMockBodies = (source: string): string => {
  let result = source;
  let searchFrom = 0;

  for (;;) {
    const start = result.indexOf('jest.mock(', searchFrom);

    if (start === -1) {
      return result;
    }

    const openParen = start + 'jest.mock'.length;
    let depth = 0;
    let end = openParen;

    for (let i = openParen; i < result.length; i += 1) {
      if (result[i] === '(') {
        depth += 1;
      }

      if (result[i] === ')') {
        depth -= 1;

        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }

    result = result.slice(0, openParen) + blankSpan(result, openParen, end) + result.slice(end);
    searchFrom = end;
  }
};

// A top-level (column-0) declaration opener — Biome formats every top-level
// statement flush-left, so this is a reliable boundary in this codebase.
const TOP_LEVEL_DECL =
  /^(export\s+default\s+function\s+\w|export\s+function\s+\w|export\s+default\s+\w+\s*;|export\s+const\s+\w|const\s+\w|function\s+\w)/gm;

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
  | { kind: 'localDeclaration'; name: string }
  | { kind: 'other' };

const classifySlice = (slice: string): SliceClassification => {
  const defaultFunction = /^export\s+default\s+function\s+(\w+)/.exec(slice);

  if (defaultFunction) {
    return looksLikeComponent(slice)
      ? { kind: 'exportedComponent', name: defaultFunction[1] as string }
      : { kind: 'other' };
  }

  const namedFunction = /^export\s+function\s+(\w+)/.exec(slice);

  if (namedFunction) {
    return looksLikeComponent(slice)
      ? { kind: 'exportedComponent', name: namedFunction[1] as string }
      : { kind: 'other' };
  }

  const namedConst = /^export\s+const\s+(\w+)/.exec(slice);

  if (namedConst) {
    return looksLikeComponent(slice)
      ? { kind: 'exportedComponent', name: namedConst[1] as string }
      : { kind: 'other' };
  }

  const defaultAlias = /^export\s+default\s+(\w+)\s*;/.exec(slice);

  if (defaultAlias) {
    return { kind: 'defaultAlias', target: defaultAlias[1] as string };
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

export const exportedComponentNames = (rawSource: string): string[] => {
  const source = blankJestMockBodies(blankNoise(rawSource));
  const slices = declarationSlices(source);

  const localDeclarations = new Map<string, string>();
  const exportedNames: string[] = [];
  const defaultAliasTargets: string[] = [];

  for (const slice of slices) {
    const classified = classifySlice(slice);

    if (classified.kind === 'exportedComponent') {
      exportedNames.push(classified.name);
    }

    if (classified.kind === 'defaultAlias') {
      defaultAliasTargets.push(classified.target);
    }

    if (classified.kind === 'localDeclaration') {
      localDeclarations.set(classified.name, slice);
    }
  }

  for (const target of defaultAliasTargets) {
    const declared = localDeclarations.get(target);

    if (declared !== undefined && looksLikeComponent(declared)) {
      exportedNames.push(target);
    }
  }

  return [...new Set(exportedNames)];
};
