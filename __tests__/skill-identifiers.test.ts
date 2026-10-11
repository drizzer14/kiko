import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  lineCountBefore,
  INLINE_CODE_PATTERN,
  paragraphsOutsideFences,
} from './test-support/markdown-code-spans';
import { repositoryFiles } from './test-support/repository-files';

// A rename or a removal leaves a skill naming the old symbol, and a drift pass had to find those by
// hand each round. This makes a stale name fail `make verify` instead; its sibling
// cited-paths.test.ts does the same for repo paths.
//
// What counts as a citation: an inline code span (the same reader as cited-paths) whose whole text
// is an identifier, a dotted member path (`settings.dismissTip`), or either with a trailing `()`.
// A path, a command, a flag, a call with arguments, a rule id (`kiko-...`) or a number is not an
// identifier span, so it is skipped by shape; so is a commit sha (7 to 40 hex digits, at least one
// a digit). A pure ALL_CAPS token is NOT skipped: a stale constant or env var is a stale name, and
// the ones that are not ours (a plist key, a SQL keyword) sit in the exemption lists below.
//
// It resolves when the last dotted part is a whole word somewhere in the code corpus: every file
// under CODE_FOLDERS (ios/ included, so an Apple or native name resolves from the Swift, Obj-C,
// plist or pbxproj that uses it) plus the root config files, as `repositoryFiles` lists them. A
// name in a comment or a string counts as present; the check catches a name that left the tree
// altogether, not one that survives only in a comment.
//
// A doc that names a thing that is gone writes it without backticks, so it is not a citation.
const REPOSITORY_ROOT = join(__dirname, '..');

const CODE_FOLDERS = [
  'src/',
  '__tests__/',
  '__mocks__/',
  'jest/',
  'e2e/',
  'scripts/',
  'rules/',
  'ios/',
  'harness/kiko/scripts/',
];

const IDENTIFIER_SPAN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;

const COMMIT_SHA = /^(?=.*\d)[0-9a-f]{7,40}$/;

const SCOPE_FILE =
  /^(?:\.claude\/skills\/.+|harness\/kiko\/skills\/.+|harness\/kiko\/agents\/[^/]+)\.md$/;

const CODE_FILE_EXCLUDED = /(?:^package-lock\.json|\.(?:png|jpe?g|gif|ttf|otf|woff2?|ico|lock))$/;

const ROOT_CODE_FILE = /^[^/]+\.(?:[cm]?[jt]sx?|json)$/;

// Names of a skill's inline code spans that are not in this repository's code, by category. Each
// name must still be cited in a skill and still be unresolved, or the list test fails, so the lists
// only shrink. A name that left the tree is fixed in the skill text, never added here.
type ExemptionGroup = { reason: string; names: readonly string[] };

const NON_PROJECT_NAMES: readonly ExemptionGroup[] = [
  {
    reason:
      'react-native, react-native-sortables, RNGH, Unistyles, drizzle, a clipboard hook and ' +
      'jest-haste-map internals that the skill cites to explain a behavior; the code never calls them',
    names: [
      'PlatformColor',
      'UnistylesRuntime.setTheme',
      'useClipboard()',
      'useMigrations',
      'updateProps',
      '_shouldAnimatePresentation',
      'ensurePresentedOnlyIfNeeded',
      'handleTouchStart',
      'cancelsJSResponder',
      'JEST_EXTENSIONS_RE',
    ],
  },
  {
    reason:
      'Apple names the Swift and plist in ios/ do not use: UIKit, and a key Xcode writes into the ' +
      'built Info.plist (the source plist has none; the project sets TARGETED_DEVICE_FAMILY)',
    names: ['UIBarButtonItem', 'UIDeviceFamily'],
  },
  {
    reason: 'the Intl.Locale weekInfo getter, a Hermes/V8 runtime API the code deliberately avoids',
    names: ['weekInfo'],
  },
  {
    reason:
      'fnts exports and type parameters (node_modules/fnts), cited where the skill explains them',
    names: ['Maybe', 'fmap', 'curry', 'RightValue', 'LeftValue'],
  },
  {
    reason:
      'a TypeScript compiler option the repo leaves at its default, so tsconfig.json omits it',
    names: ['isolatedModules'],
  },
  {
    reason: 'a SQL statement keyword (the app never runs it, which is the point of the sentence)',
    names: ['ANALYZE'],
  },
  {
    reason:
      'shell and OS tools, a python module and a node API that the kill-guard text lists as ' +
      'writers or process scanners it does not see; no repo file invokes them',
    names: [
      '$CMD',
      'rsync',
      'ditto',
      'truncate',
      'shutil',
      'fs.writeSync',
      'pidof',
      'lsof',
      'du',
      'curl',
    ],
  },
  {
    reason: 'Semgrep taint-mode and --time JSON keys, written in prose about a Semgrep behavior',
    names: ['propagator', 'match_times'],
  },
  {
    reason: 'a conventional-commit scope word in the release skill',
    names: ['chore'],
  },
  {
    reason: 'a Claude Code tool name and a devicectl output field, neither in repo code',
    names: ['Monitor()', 'installationURL'],
  },
  {
    reason:
      'the drizzer14/harness repo (a different repository): its harness.config.json keys and its ' +
      'wait-load env var, which harness-sync ports',
    names: [
      'killGuard.denyStash',
      'killGuard.denyUnquotedHeredoc',
      'killGuard.protectedDirs',
      'killGuard.waitLoopJobs',
      'HARNESS_WAIT_LOAD_INTERVAL',
    ],
  },
];

// A deliberate bad-name or bad-id example, exempt per (skill file, name) like
// full-word-identifiers' EXEMPTIONS: the same name cited as a real symbol in another skill
// still has to resolve.
type ExampleGroup = { file: string; reason: string; names: readonly string[] };

const EXAMPLE_NAMES: readonly ExampleGroup[] = [
  {
    file: '.claude/skills/kiko-code-style/SKILL.md',
    reason: 'a deliberately wrong name shown beside the rule it breaks',
    names: [
      'isX',
      'counterIBAN',
      'isBtcEntry',
      'fetchBtcPrice',
      'makeCreateTransaction',
      'Anonymous',
    ],
  },
  {
    file: '.claude/skills/kiko-code-style/SKILL.md',
    reason: 'a task id, the example of the history id a comment may not carry',
    names: ['T28'],
  },
  {
    file: '.claude/skills/kiko-linter/SKILL.md',
    reason: 'a task id and a mis-split name, quoted as input of the history-id and full-word rules',
    names: ['T32', 'PANValue'],
  },
];

type Exemption = { file?: string; name: string };

const EXEMPTIONS: readonly Exemption[] = [
  ...NON_PROJECT_NAMES.flatMap(({ names }) => names.map((name) => ({ name }))),
  ...EXAMPLE_NAMES.flatMap(({ file, names }) => names.map((name) => ({ file, name }))),
];

type Citation = { line: number; name: string };

const identifierCitations = (markdown: string): Citation[] =>
  paragraphsOutsideFences(markdown)
    .flatMap((paragraph) =>
      [...paragraph.text.matchAll(INLINE_CODE_PATTERN)].map((span) => ({
        line: paragraph.firstLine + lineCountBefore(paragraph.text, span.index ?? 0),
        name: span[2].trim(),
      })),
    )
    .filter(({ name }) => IDENTIFIER_SPAN.test(name) && !COMMIT_SHA.test(name));

const lastPart = (name: string): string => name.replace(/\(\)$/, '').split('.').pop() ?? name;

const presentFiles = repositoryFiles(REPOSITORY_ROOT);

// This file is left out of the corpus: it spells every exempt name, so it would resolve them all.
const THIS_FILE = relative(REPOSITORY_ROOT, __filename);

const corpusWords = new Set(
  presentFiles
    .filter(
      (file) =>
        (CODE_FOLDERS.some((folder) => file.startsWith(folder)) || ROOT_CODE_FILE.test(file)) &&
        file !== THIS_FILE &&
        !CODE_FILE_EXCLUDED.test(file),
    )
    .flatMap((file) => readFileSync(join(REPOSITORY_ROOT, file), 'utf8').match(/[\w$]+/g) ?? []),
);

const resolves = (name: string): boolean => corpusWords.has(lastPart(name));

const scopeFiles = presentFiles.filter((file) => SCOPE_FILE.test(file));

const citedUnresolved = (file: string): Citation[] =>
  identifierCitations(readFileSync(join(REPOSITORY_ROOT, file), 'utf8')).filter(
    ({ name }) => !resolves(name),
  );

const isExempt = (file: string, name: string): boolean =>
  EXEMPTIONS.some((exemption) => exemption.name === name && (exemption.file ?? file) === file);

describe('identifierCitations', () => {
  it('finds an identifier, a dotted member path and a call with empty parentheses (POSITIVE)', () => {
    expect(
      identifierCitations(
        '# Title\n\nUse `holdingsRepo.update`, `resolveColor()` and `MODE_BEHAVIOR`.\n',
      ),
    ).toEqual([
      { line: 3, name: 'holdingsRepo.update' },
      { line: 3, name: 'resolveColor()' },
      { line: 3, name: 'MODE_BEHAVIOR' },
    ]);
  });

  it('reads a span wrapped across two lines at the line it starts on', () => {
    expect(identifierCitations('First line `use\nLiveQuery` and `second`.\n')).toEqual([
      { line: 2, name: 'second' },
    ]);
  });

  it('skips a path, a command, a flag, a call with arguments, a rule id and a number (NEGATIVE)', () => {
    expect(
      identifierCitations(
        '`src/db/schema.ts` `npm run check:all` `--write` `f(a, b)` `kiko-no-switch` `0055` `a.b.`',
      ),
    ).toEqual([]);
  });

  it('skips a commit sha but keeps a plain hex-looking word', () => {
    expect(identifierCitations('`f3908902` `cc5cd0f` `deadbeef` `facade`')).toEqual([
      { line: 1, name: 'deadbeef' },
      { line: 1, name: 'facade' },
    ]);
  });

  it('skips a span in a fenced block', () => {
    expect(identifierCitations('```\n`staleName`\n```\n\nThen `liveName`.\n')).toEqual([
      { line: 5, name: 'liveName' },
    ]);
  });
});

describe('resolves', () => {
  it('matches the last dotted part as a whole word in the code corpus (POSITIVE)', () => {
    expect(resolves('useLiveQuery')).toBe(true);
    expect(resolves('Anything.useLiveQuery')).toBe(true);
    expect(resolves('useLiveQuery()')).toBe(true);
    expect(resolves('TARGETED_DEVICE_FAMILY')).toBe(true);
  });

  it('does not match a substring or a first dotted part (NEGATIVE)', () => {
    expect(resolves('useLiveQuer')).toBe(false);
    expect(resolves(`useLiveQuery.${['zzz', 'Unknown', 'Member'].join('')}`)).toBe(false);
  });
});

describe('identifiers named in skills, agents and harness skills', () => {
  it('scans every skill and agent file', () => {
    expect(scopeFiles).toEqual(
      expect.arrayContaining([
        '.claude/skills/kiko-code-style/SKILL.md',
        'harness/kiko/skills/ops/SKILL.md',
        'harness/kiko/agents/developer.md',
      ]),
    );
  });

  it('names only identifiers that exist in the code, or are listed as exempt', () => {
    expect(
      scopeFiles.flatMap((file) =>
        citedUnresolved(file)
          .filter(({ name }) => !isExempt(file, name))
          .map(({ line, name }) => `${file}:${line} ${name}`),
      ),
    ).toEqual([]);
  });

  it('lists no exemption that is no longer cited or now resolves', () => {
    const stillUnresolved = scopeFiles.flatMap((file) =>
      citedUnresolved(file).map(({ name }) => ({ file, name })),
    );

    expect(
      EXEMPTIONS.filter(
        (exemption) =>
          !stillUnresolved.some(
            ({ file, name }) =>
              name === exemption.name && (exemption.file === undefined || exemption.file === file),
          ),
      ),
    ).toEqual([]);
  });
});
