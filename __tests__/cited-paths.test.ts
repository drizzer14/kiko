import { dirname, join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

// A unit move leaves the skills and harness docs citing the old path, and a
// drift pass had to re-list those by hand three times running. This makes a
// stale citation fail `make verify` instead.
//
// What counts as a citation: a path that starts with one of CITED_ROOTS,
// inside an inline code span (single or multi-backtick, which may wrap
// across lines of one paragraph), in prose outside a fenced code block.
// Fenced blocks hold illustrative trees and worked examples, not claims
// about this tree. A `:line` suffix and a `#anchor` are cut off. A call
// written as a path (`src/prices/metal-refresh/refreshMetalPrices(...)`)
// cites the folder before the function name. A glob, brace form or
// placeholder (`*`, `?`, `{}`, `[]`, `<>`, `$`, `...`, `…`) is not one path,
// so it is skipped. A root nested in a longer path (a sibling project under
// `~/`, `$PWD/src/...`) is not a repo path either. A doc that names a path
// that is gone writes it without backticks, so it is not a citation.
const REPOSITORY_ROOT = join(__dirname, '..');

const CITED_ROOTS = ['src', 'scripts', 'rules', 'docs', '__tests__', 'e2e', 'harness', '.claude'];

const CITATION_PATTERN = new RegExp(
  `(?<![\\w./~$-])(?:${CITED_ROOTS.map((root) => root.replace('.', '\\.')).join('|')})/[^\\s\`'"(),;:#|]*`,
  'g',
);

const PLACEHOLDER_PATTERN = /[*?{}[\]<>$…]|\.\.\./;

const INLINE_CODE_PATTERN = /(?<!`)(`+)(?!`)([\s\S]+?)(?<!`)\1(?!`)/g;

const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

// Stale citations the test tolerates. Empty: a stale citation is fixed in
// the skill or doc text, never added here. An entry that no longer fails
// fails the test, so the list can only shrink.
const KNOWN_STALE_CITATIONS: ReadonlyArray<{ file: string; path: string }> = [];

type Citation = { line: number; path: string };

type Paragraph = { firstLine: number; text: string };

const paragraphsOutsideFences = (markdown: string): Paragraph[] => {
  const paragraphs: Paragraph[] = [];
  let fence: string | undefined;
  let current: { firstLine: number; lines: string[] } | undefined;

  const closeParagraph = () => {
    if (current !== undefined) {
      paragraphs.push({ firstLine: current.firstLine, text: current.lines.join('\n') });
    }

    current = undefined;
  };

  markdown.split('\n').forEach((lineText, lineIndex) => {
    const fenceMatch = FENCE_PATTERN.exec(lineText);

    if (fence !== undefined) {
      if (fenceMatch?.[1].startsWith(fence)) {
        fence = undefined;
      }

      return;
    }

    if (fenceMatch !== null) {
      closeParagraph();
      fence = fenceMatch[1];

      return;
    }

    if (lineText.trim() === '') {
      closeParagraph();

      return;
    }

    current = current ?? { firstLine: lineIndex + 1, lines: [] };
    current.lines.push(lineText);
  });

  closeParagraph();

  return paragraphs;
};

const lineCountBefore = (text: string, offset: number): number =>
  text.slice(0, offset).split('\n').length - 1;

const citationsInParagraph = (paragraph: Paragraph): Citation[] =>
  [...paragraph.text.matchAll(INLINE_CODE_PATTERN)].flatMap((span) => {
    const spanStart = (span.index ?? 0) + span[1].length;

    return [...span[2].matchAll(CITATION_PATTERN)]
      .map((citation) => {
        const citationStart = spanStart + (citation.index ?? 0);
        const citationEnd = (citation.index ?? 0) + citation[0].length;
        const path = citation[0].replace(/\.+$/, '');

        return {
          line: paragraph.firstLine + lineCountBefore(paragraph.text, citationStart),
          path: span[2][citationEnd] === '(' ? dirname(path) : path,
        };
      })
      .filter((citation) => !PLACEHOLDER_PATTERN.test(citation.path));
  });

const citedPaths = (markdown: string): Citation[] =>
  paragraphsOutsideFences(markdown).flatMap(citationsInParagraph);

const pathsOf = (citations: Citation[]): string[] => citations.map((citation) => citation.path);

const markdownFilesUnder = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      return markdownFilesUnder(full);
    }

    return full.endsWith('.md') ? [full] : [];
  });

const citingFiles = (): string[] =>
  [
    ...markdownFilesUnder(join(REPOSITORY_ROOT, '.claude/skills')).filter((file) =>
      file.endsWith('/SKILL.md'),
    ),
    ...['harness/kiko/skills', 'harness/kiko/agents', 'docs/harness'].flatMap((directory) =>
      markdownFilesUnder(join(REPOSITORY_ROOT, directory)),
    ),
    join(REPOSITORY_ROOT, 'CLAUDE.md'),
  ].map((file) => file.slice(REPOSITORY_ROOT.length + 1));

const missingCitations = (file: string): Array<{ file: string; line: number; path: string }> =>
  citedPaths(readFileSync(join(REPOSITORY_ROOT, file), 'utf8'))
    .filter((citation) => !existsSync(join(REPOSITORY_ROOT, citation.path)))
    .map((citation) => ({ file, line: citation.line, path: citation.path }));

const citationKey = (citation: { file: string; path: string }): string =>
  `${citation.file} -> ${citation.path}`;

describe('citedPaths', () => {
  it('finds a backticked path and its line (POSITIVE)', () => {
    expect(citedPaths('# Title\n\nSee `src/db/schema.ts` for it.\n')).toEqual([
      { line: 3, path: 'src/db/schema.ts' },
    ]);
  });

  it('finds a path inside a longer span and cuts a line suffix and an anchor', () => {
    expect(
      pathsOf(
        citedPaths(
          'Run `node scripts/checks/import-order.js --write` and read `src/db/schema.ts:38` and `docs/harness/checks-internals.md#dedup`.',
        ),
      ),
    ).toEqual([
      'scripts/checks/import-order.js',
      'src/db/schema.ts',
      'docs/harness/checks-internals.md',
    ]);
  });

  it('cites the folder of a call written as a path', () => {
    expect(
      pathsOf(citedPaths('`src/prices/metal-refresh/refreshMetalPrices({ now, fetchImpl })`')),
    ).toEqual(['src/prices/metal-refresh']);
  });

  it('reads a span wrapped across two lines of one paragraph at the line the path is on', () => {
    expect(citedPaths('Line one `node\nscripts/checks/lint.sh` here.\n')).toEqual([
      { line: 2, path: 'scripts/checks/lint.sh' },
    ]);
  });

  it('reads a double-backtick span', () => {
    expect(pathsOf(citedPaths('Use `` `src/i18n/en.ts` `` here.'))).toEqual(['src/i18n/en.ts']);
  });

  it('skips globs, brace forms and placeholders (NEGATIVE)', () => {
    expect(
      citedPaths(
        '`src/**` `rules/fixtures/*.ts` `src/a.{ts,tsx}` `src/screens/<unit>/x.ts` `src/…` `src/.../x.ts` `$PWD/src/x.ts`',
      ),
    ).toEqual([]);
  });

  it('skips a path in a fenced block, in unbackticked prose, or nested in another path', () => {
    const markdown = [
      'Plain src/db/schema.ts prose.',
      '',
      '```',
      'src/holdings/repo/holdings.repo.ts',
      '```',
      '',
      '`~/Developer/Projects/ovpn-ui/.claude/skills/x/SKILL.md` and `@kiko/db/client`.',
    ].join('\n');

    expect(citedPaths(markdown)).toEqual([]);
  });

  it('does not pair a stray backtick with a span in the next paragraph', () => {
    expect(pathsOf(citedPaths('A stray ` tick.\n\nThen `src/db/schema.ts`.'))).toEqual([
      'src/db/schema.ts',
    ]);
  });

  it('cites a path in a sentence that says it is gone, since prose does not exempt it', () => {
    expect(
      pathsOf(citedPaths('The diff engine (`scripts/checks/screenshot-diff/`) was removed.')),
    ).toEqual(['scripts/checks/screenshot-diff/']);
  });
});

describe('repo paths cited in skills, agents and harness docs', () => {
  it('scans every citing file', () => {
    expect(citingFiles()).toEqual(
      expect.arrayContaining([
        'CLAUDE.md',
        '.claude/skills/kiko-linter/SKILL.md',
        'harness/kiko/skills/ops/SKILL.md',
        'harness/kiko/agents/developer.md',
        'docs/harness/documented-exceptions.md',
      ]),
    );
  });

  it('cites only paths that exist', () => {
    const allowed = new Set(KNOWN_STALE_CITATIONS.map(citationKey));
    const missing = citingFiles().flatMap(missingCitations);

    expect(
      missing
        .filter((citation) => !allowed.has(citationKey(citation)))
        .map((citation) => `${citation.file}:${citation.line} ${citation.path}`),
    ).toEqual([]);
  });

  it('lists no allowlisted citation that has since been fixed', () => {
    const stillMissing = new Set(citingFiles().flatMap(missingCitations).map(citationKey));

    expect(KNOWN_STALE_CITATIONS.map(citationKey).filter((key) => !stillMissing.has(key))).toEqual(
      [],
    );
  });
});
