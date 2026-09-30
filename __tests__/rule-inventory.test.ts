import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// kiko-linter's "Every mechanized finding gets an inventory row": a rule that
// ships without a row leaves the inventory unable to answer "is this finding
// already mechanized?". This makes a missing row fail `make verify` instead of
// waiting for a by-hand audit to find it.
const REPOSITORY_ROOT = join(__dirname, '..');

const RULE_FILES = ['rules/semgrep-mobile.yml', 'rules/semgrep-prewrite.yml'];

const INVENTORY = 'docs/harness/review-to-biome-inventory.md';

const RULE_ID_PATTERN = /^ {2}- id: ([a-z0-9-]+)\s*$/gm;

// A looser count of every `- id:` line, so an id the strict pattern cannot
// read (a new indent, an uppercase letter) fails the count instead of being
// skipped.
const ANY_ID_LINE_PATTERN = /^\s*- id:/gm;

const FIRST_CELL_ID_PATTERN = /^\| `([a-z0-9-]+)` \|/gm;

// kiko-linter's "Adding a pre-write guard rule": a whole-file exclude hides
// the rule from its own motivating file, so a legitimate site in one test file
// takes a per-line override instead. A glob exclude of every test stays fine.
const EXCLUDE_KEY_PATTERN = /^( *)exclude:[ \t]*(.*)$/;

const ANY_EXCLUDE_KEY_PATTERN = /^\s*exclude:/gm;

const BLOCK_ITEM_PATTERN = /^\s*- (.*)$/;

const GLOB_CHARACTER_PATTERN = /[*?[{]/;

const TEST_FILE_PATTERN = /\.test\.tsx?$|\.spec\.[^/]+$|(?:^|\/)(?:__tests__|e2e)\/./;

const unquoted = (item: string): string => item.trim().replace(/^(['"])(.*)\1$/, '$2');

const blockItems = (linesAfterKey: string[], keyIndent: number): string[] => {
  const end = linesAfterKey.findIndex(
    (lineText) => lineText.trim() !== '' && lineText.search(/\S/) <= keyIndent,
  );

  return linesAfterKey
    .slice(0, end < 0 ? linesAfterKey.length : end)
    .flatMap((lineText) => BLOCK_ITEM_PATTERN.exec(lineText)?.slice(1) ?? [])
    .map(unquoted);
};

const excludeLists = (yamlText: string): string[][] => {
  const lines = yamlText.split('\n');

  return lines.flatMap((lineText, lineIndex) => {
    const match = EXCLUDE_KEY_PATTERN.exec(lineText);

    if (match === null) {
      return [];
    }

    return [blockItems(lines.slice(lineIndex + 1), match[1].length)];
  });
};

const excludeEntries = (yamlText: string): string[] => excludeLists(yamlText).flat();

const singleTestFileExcludes = (yamlText: string): string[] =>
  excludeEntries(yamlText).filter(
    (entry) => !GLOB_CHARACTER_PATTERN.test(entry) && TEST_FILE_PATTERN.test(entry),
  );

const readRepositoryFile = (file: string): string =>
  readFileSync(join(REPOSITORY_ROOT, file), 'utf8');

const ruleFileTexts = RULE_FILES.map(readRepositoryFile);

const ruleIds = ruleFileTexts.flatMap((text) =>
  [...text.matchAll(RULE_ID_PATTERN)].map((match) => match[1]),
);

describe('rule inventory (kiko-linter › Every mechanized finding gets an inventory row)', () => {
  it('reads every rule id in the Semgrep rule files', () => {
    const idLineCount = ruleFileTexts.reduce(
      (count, text) => count + (text.match(ANY_ID_LINE_PATTERN)?.length ?? 0),
      0,
    );

    expect(ruleIds.length).toBeGreaterThan(0);
    expect(ruleIds.length).toBe(idLineCount);
  });

  it(`gives every Semgrep rule id a row in ${INVENTORY} whose first cell is the exact id`, () => {
    const firstCellIds = new Set(
      [...readRepositoryFile(INVENTORY).matchAll(FIRST_CELL_ID_PATTERN)].map((match) => match[1]),
    );

    const missing = ruleIds.filter((ruleId) => !firstCellIds.has(ruleId));

    expect(missing).toEqual([]);
  });
});

describe('paths.exclude (kiko-linter › Adding a pre-write guard rule)', () => {
  const yaml = [
    '  - id: kiko-x',
    '    paths:',
    '      exclude:',
    '        - "src/x/x.test.ts"',
    "        - 'e2e/flows/x.yaml'",
    '        - "*.test.ts"',
    '        - "src/x/**"',
    '        - "src/x/x.ts"',
    '    pattern: x',
    '  - id: kiko-y',
    '    paths:',
    '      exclude:',
    '        - "__tests__/y.test.tsx"',
    '        - "*.spec.ts"',
    '        - "src/y.spec.js"',
  ].join('\n');

  it('reads every block list item under exclude', () => {
    expect(excludeEntries(yaml)).toEqual([
      'src/x/x.test.ts',
      'e2e/flows/x.yaml',
      '*.test.ts',
      'src/x/**',
      'src/x/x.ts',
      '__tests__/y.test.tsx',
      '*.spec.ts',
      'src/y.spec.js',
    ]);
  });

  it('reads a flow list as an empty list, which the rule-file check below fails', () => {
    expect(
      excludeLists(['    paths:', '      exclude: ["src/y.test.ts"]', '    pattern: y'].join('\n')),
    ).toEqual([[]]);
  });

  it('flags an exclude that names one test file (POSITIVE), never a glob or a source file', () => {
    expect(singleTestFileExcludes(yaml)).toEqual([
      'src/x/x.test.ts',
      'e2e/flows/x.yaml',
      '__tests__/y.test.tsx',
      'src/y.spec.js',
    ]);
  });

  it('reads an exclude list under every exclude key in the rule files', () => {
    const excludeKeyCount = ruleFileTexts.reduce(
      (count, text) => count + (text.match(ANY_EXCLUDE_KEY_PATTERN)?.length ?? 0),
      0,
    );

    const lists = ruleFileTexts.flatMap(excludeLists);

    expect(excludeKeyCount).toBeGreaterThan(0);
    expect(lists.length).toBe(excludeKeyCount);
    expect(lists.filter((list) => list.length === 0)).toEqual([]);
  });

  it('names no single test file in paths.exclude; use a per-line `nosemgrep: <id> OVERRIDE(<reason>)`', () => {
    expect(ruleFileTexts.flatMap(singleTestFileExcludes)).toEqual([]);
  });
});
