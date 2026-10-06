import {
  rmSync,
  statSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

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
//
// A partial citation drops the root (`design-system/entity-tint/…`,
// `checks/lint.sh`). It counts only when its first segment is a child folder
// of a cited root, which keeps branch names (`feat/…`), lint rule names
// (`lint/…`) and package paths out. It resolves when a file or folder on
// disk that git tracks or would track (see `repositoryFiles`), outside
// `rules/fixtures/`, ends with it (an extension may be left off); several
// matches still resolve, since the text does not say which.
const REPOSITORY_ROOT = join(__dirname, '..');

const CITED_ROOTS = ['src', 'scripts', 'rules', 'docs', '__tests__', 'e2e', 'harness', '.claude'];

const CITATION_PATTERN = new RegExp(
  `(?<![\\w./~$-])(?:${CITED_ROOTS.map((root) => root.replace('.', '\\.')).join('|')})/[^\\s\`'"(),;:#|]*`,
  'g',
);

const PARTIAL_CITATION_PATTERN = /(?<![\w./~$@-])[\w.-]+\/[^\s`'"(),;:#|]*/g;

const PARTIAL_EXTENSIONS = ['', '.ts', '.tsx', '.js'];

const PLACEHOLDER_PATTERN = /[*?{}[\]<>$…]|\.\.\./;

// Tracked plus untracked-but-not-ignored files, kept only when on disk, so a
// partial citation resolves against the same files existsSync gives the
// rooted check: a new file resolves, a deleted one does not.
const repositoryFiles = (root: string): string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => file !== '' && existsSync(join(root, file)));

const presentFiles = repositoryFiles(REPOSITORY_ROOT);

const CHILD_FOLDERS_OF_ROOTS = new Set(
  presentFiles
    .map((file) => file.split('/'))
    .filter((segments) => segments.length > 2 && CITED_ROOTS.includes(segments[0]))
    .map((segments) => segments[1]),
);

const RESOLUTION_TARGETS = [
  ...new Set(
    presentFiles
      .filter((file) => !file.startsWith('rules/fixtures/'))
      .flatMap((file) =>
        file.split('/').map((_, index, segments) => segments.slice(0, index + 1).join('/')),
      ),
  ),
];

const INLINE_CODE_PATTERN = /(?<!`)(`+)(?!`)([\s\S]+?)(?<!`)\1(?!`)/g;

const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

// Stale citations the test tolerates. Empty: a stale citation is fixed in
// the skill or doc text, never added here. An entry whose citation is not
// stale fails the test, so the list can only shrink.
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

const citationsInParagraph =
  (pattern: RegExp) =>
  (paragraph: Paragraph): Citation[] =>
    [...paragraph.text.matchAll(INLINE_CODE_PATTERN)].flatMap((span) => {
      const spanStart = (span.index ?? 0) + span[1].length;

      return [...span[2].matchAll(pattern)]
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
  paragraphsOutsideFences(markdown).flatMap(citationsInParagraph(CITATION_PATTERN));

const citedPartialPaths = (markdown: string): Citation[] =>
  paragraphsOutsideFences(markdown)
    .flatMap(citationsInParagraph(PARTIAL_CITATION_PATTERN))
    .filter((citation) => {
      const firstSegment = citation.path.split('/')[0];

      return !CITED_ROOTS.includes(firstSegment) && CHILD_FOLDERS_OF_ROOTS.has(firstSegment);
    });

const partialCitationResolves = (path: string): boolean => {
  const suffix = `/${path.replace(/\/+$/, '')}`;

  return RESOLUTION_TARGETS.some((target) =>
    PARTIAL_EXTENSIONS.some((extension) => target.endsWith(`${suffix}${extension}`)),
  );
};

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
    join(REPOSITORY_ROOT, 'docs/security/README.md'),
  ].map((file) => file.slice(REPOSITORY_ROOT.length + 1));

const missingCitations = (file: string): Array<{ file: string; line: number; path: string }> =>
  citedPaths(readFileSync(join(REPOSITORY_ROOT, file), 'utf8'))
    .filter((citation) => !existsSync(join(REPOSITORY_ROOT, citation.path)))
    .map((citation) => ({ file, line: citation.line, path: citation.path }));

const unresolvedPartialCitations = (file: string): string[] =>
  citedPartialPaths(readFileSync(join(REPOSITORY_ROOT, file), 'utf8'))
    .filter((citation) => !partialCitationResolves(citation.path))
    .map((citation) => `${file}:${citation.line} ${citation.path}`);

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

describe('repositoryFiles', () => {
  it('lists the files on disk that git tracks or would track, as existsSync sees them', () => {
    const root = mkdtempSync(join(tmpdir(), 'kiko-cited-paths-'));
    const git = (...parameters: string[]) =>
      execFileSync('git', parameters, { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(root, '.gitignore'), 'ignored.ts\n');

    for (const file of ['tracked.ts', 'deleted.ts', 'untracked.ts', 'ignored.ts']) {
      writeFileSync(join(root, file), '');
    }

    git('add', '.gitignore', 'tracked.ts', 'deleted.ts');
    rmSync(join(root, 'deleted.ts'));

    expect(repositoryFiles(root).sort()).toEqual(['.gitignore', 'tracked.ts', 'untracked.ts']);
  });
});

describe('citedPartialPaths', () => {
  it('finds a path whose first segment is a child folder of a cited root (POSITIVE)', () => {
    expect(citedPartialPaths('See `design-system/entity-tint/entity-tint.ts` here.')).toEqual([
      { line: 1, path: 'design-system/entity-tint/entity-tint.ts' },
    ]);
  });

  it('skips a branch name, a lint rule name, a package path and a rooted path (NEGATIVE)', () => {
    expect(
      citedPartialPaths(
        '`feat/assets-debts` `lint/suspicious/noConsole` `@kiko/db/client` `src/design-system/x.ts` `../design-system/x.ts`',
      ),
    ).toEqual([]);
  });

  it('resolves a partial path by its tracked suffix, with or without an extension', () => {
    expect(partialCitationResolves('design-system/entity-tint/entity-tint.ts')).toBe(true);
    expect(partialCitationResolves('design-system/entity-tint')).toBe(true);
    expect(partialCitationResolves('design-system/entity-tint/')).toBe(true);
    expect(partialCitationResolves('design-system/entity-tint/entity-tint')).toBe(true);
  });

  it('reports a partial path no listed file or folder ends with', () => {
    expect(partialCitationResolves('design-system/gone/gone.ts')).toBe(false);
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

  it('cites only partial paths that a listed file or folder ends with', () => {
    expect(citingFiles().flatMap(unresolvedPartialCitations)).toEqual([]);
  });

  it('lists no allowlisted citation that has since been fixed', () => {
    const stillMissing = new Set(citingFiles().flatMap(missingCitations).map(citationKey));

    expect(KNOWN_STALE_CITATIONS.map(citationKey).filter((key) => !stillMissing.has(key))).toEqual(
      [],
    );
  });
});
