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
import { execFileSync } from 'node:child_process';
import { dirname, basename, join } from 'node:path';

import {
  type Paragraph,
  lineCountBefore,
  INLINE_CODE_PATTERN,
  paragraphsOutsideFences,
} from './test-support/markdown-code-spans';
import {
  type Citation,
  sourceComments,
  sourceCommentCitations,
} from './test-support/source-comment-citations';
import { repositoryFiles } from './test-support/repository-files';

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

// A partial citation resolves against the files `repositoryFiles` lists, the same ones existsSync
// gives the rooted check.
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

// Stale citations the test tolerates. Empty: a stale citation is fixed in
// the skill or doc text, never added here. An entry whose citation is not
// stale fails the test, so the list can only shrink.
const KNOWN_STALE_CITATIONS: ReadonlyArray<{ file: string; path: string }> = [];

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

const startsInChildFolderOfRoot = (citation: Citation): boolean => {
  const firstSegment = citation.path.split('/')[0];

  return !CITED_ROOTS.includes(firstSegment) && CHILD_FOLDERS_OF_ROOTS.has(firstSegment);
};

const citedPartialPaths = (markdown: string): Citation[] =>
  paragraphsOutsideFences(markdown)
    .flatMap(citationsInParagraph(PARTIAL_CITATION_PATTERN))
    .filter(startsInChildFolderOfRoot);

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

// A migration regenerates under a new name and a moved file leaves a src comment naming the old
// one, with nothing to fail until a reader follows it. A comment names a path under src, docs,
// rules, e2e, drizzle, scripts or __tests__, or a migration file name on its own
// (`0012_name.sql`); either must exist.
const presentBasenames = new Set(presentFiles.map((file) => basename(file)));

// A comment also names a path without its root (`monobank/sync/sync.ts`), which resolves the way a
// partial citation in a doc does. Prose is not backticked there, so only a path that ends in a file
// extension is a claim about a file; `accounts/holdings` is two words with a slash.
const FILE_EXTENSION_PATTERN = /\.\w+$/;

const partialCommentCitations = (fileName: string, text: string): Citation[] =>
  sourceComments(fileName, text).flatMap((comment) =>
    [...comment.text.matchAll(PARTIAL_CITATION_PATTERN)]
      .map((match) => ({
        line: comment.line + lineCountBefore(comment.text, match.index ?? 0),
        path: match[0].replace(/\.+$/, ''),
      }))
      .filter((citation) => FILE_EXTENSION_PATTERN.test(citation.path))
      .filter((citation) => !PLACEHOLDER_PATTERN.test(citation.path))
      .filter(startsInChildFolderOfRoot),
  );

const unresolvedSourceCitations = (fileName: string, text: string): Citation[] => [
  ...sourceCommentCitations(fileName, text).filter((citation) =>
    citation.path.includes('/')
      ? !existsSync(join(REPOSITORY_ROOT, citation.path))
      : !presentBasenames.has(citation.path),
  ),
  ...partialCommentCitations(fileName, text).filter(
    (citation) => !partialCitationResolves(citation.path),
  ),
];

describe('sourceCommentCitations', () => {
  it('finds a tree path and a bare migration name in a line comment (POSITIVE)', () => {
    expect(
      sourceCommentCitations('a.ts', '// see src/db/schema.ts and 0012_add_note.sql\n'),
    ).toEqual([
      { line: 1, path: 'src/db/schema.ts' },
      { line: 1, path: '0012_add_note.sql' },
    ]);
  });

  it('reports a path in a block comment at its own line, once for a migration path', () => {
    expect(
      sourceCommentCitations(
        'a.ts',
        'const a = 1;\n/**\n * Reads drizzle/migrations/0002_seed_categories.sql here.\n */\n',
      ),
    ).toEqual([{ line: 3, path: 'drizzle/migrations/0002_seed_categories.sql' }]);
  });

  it('finds a path in a comment that trails code', () => {
    expect(sourceCommentCitations('a.ts', 'const a = 1; // docs/harness/x.md\n')).toEqual([
      { line: 1, path: 'docs/harness/x.md' },
    ]);
  });

  it('skips a path in a string, a template or JSX text (NEGATIVE)', () => {
    expect(
      sourceCommentCitations(
        'a.tsx',
        "const a = 'src/gone/missing.ts';\nconst b = `docs/gone.md`;\nconst c = <Text>// src/gone/x.ts</Text>;\n",
      ),
    ).toEqual([]);
  });

  it('skips a glob, a brace form, a placeholder and a directory (NEGATIVE)', () => {
    expect(
      sourceCommentCitations(
        'a.ts',
        '// src/**/*.ts src/a.{ts,tsx} src/<unit>/x.ts src/screens/ drizzle/migrations/\n',
      ),
    ).toEqual([]);
  });

  it('finds a path under the test, rule and end-to-end roots', () => {
    expect(
      sourceCommentCitations(
        'a.ts',
        '// __tests__/a.test.ts, rules/semgrep-prewrite.yml and e2e/screenshot/b.ts\n',
      ),
    ).toEqual([
      { line: 1, path: '__tests__/a.test.ts' },
      { line: 1, path: 'rules/semgrep-prewrite.yml' },
      { line: 1, path: 'e2e/screenshot/b.ts' },
    ]);
  });
});

describe('sourceComments', () => {
  it('lists each comment with the line it starts on, and no string or JSX text (POSITIVE)', () => {
    expect(
      sourceComments(
        'a.tsx',
        "const a = '// not one';\n// one\nconst b = 1; /* two\n three */\nconst c = <Text>// no</Text>;\n",
      ),
    ).toEqual([
      { line: 2, text: '// one' },
      { line: 3, text: '/* two\n three */' },
    ]);
  });
});

describe('repo paths cited in src comments', () => {
  it('reports a planted path and a planted migration name that are not in the tree', () => {
    expect(
      unresolvedSourceCitations(
        'a.ts',
        '// see src/gone/missing.ts, drizzle/migrations/9999_gone.sql and 9998_gone_too.sql\n',
      ),
    ).toEqual([
      { line: 1, path: 'src/gone/missing.ts' },
      { line: 1, path: 'drizzle/migrations/9999_gone.sql' },
      { line: 1, path: '9998_gone_too.sql' },
    ]);
  });

  it('reports a planted test, rule and end-to-end path that are not in the tree', () => {
    expect(
      unresolvedSourceCitations(
        'a.ts',
        '// see __tests__/gone.test.ts, rules/gone.yml and e2e/gone/flow.yaml\n',
      ),
    ).toEqual([
      { line: 1, path: '__tests__/gone.test.ts' },
      { line: 1, path: 'rules/gone.yml' },
      { line: 1, path: 'e2e/gone/flow.yaml' },
    ]);
  });

  it('reports a planted path without its root, in a line, a block and a trailing comment', () => {
    expect(
      unresolvedSourceCitations(
        'a.ts',
        [
          '// see `monobank/gone/missing.ts`.',
          '/**',
          ' * Mirrors currency/gone.ts and design-system/gone.tsx.',
          ' */',
          'const a = 1; // transactions/gone-description.ts',
        ].join('\n'),
      ),
    ).toEqual([
      { line: 1, path: 'monobank/gone/missing.ts' },
      { line: 3, path: 'currency/gone.ts' },
      { line: 3, path: 'design-system/gone.tsx' },
      { line: 5, path: 'transactions/gone-description.ts' },
    ]);
  });

  it('resolves a path without its root that is in the tree, and skips prose and packages', () => {
    expect(
      unresolvedSourceCitations(
        'a.ts',
        [
          '// see design-system/entity-tint/entity-tint.ts and monobank/sync/sync.ts,',
          '// the income/expense split, accounts/holdings, 1/2, @kiko/db/client and lint/suspicious/x.',
          "const a = 'monobank/gone.ts';",
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('resolves a path and a migration name that are in the tree', () => {
    expect(
      unresolvedSourceCitations(
        'a.ts',
        '// see src/db/schema.ts, drizzle/migrations/0002_seed_categories.sql and 0002_seed_categories.sql\n',
      ),
    ).toEqual([]);
  });

  it('cites only paths and migration names that exist', () => {
    const sourceFiles = presentFiles.filter(
      (file) => file.startsWith('src/') && /\.tsx?$/.test(file),
    );

    expect(
      sourceFiles.flatMap((file) =>
        unresolvedSourceCitations(file, readFileSync(join(REPOSITORY_ROOT, file), 'utf8')).map(
          (citation) => `${file}:${citation.line} ${citation.path}`,
        ),
      ),
    ).toEqual([]);
  });
});
