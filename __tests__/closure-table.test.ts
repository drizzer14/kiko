import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { type SpawnSyncReturns, execFileSync, spawnSync } from 'node:child_process';

import { commitAll, writeFile } from './test-support/mutation-repository';

// scripts/checks/closure-table.js checks the closure table a round writes at its end: one row
// per finding id, each with a fix commit in HEAD's history and a pinning test that exists. It
// runs here against a throwaway git repository, because the sha checks read that repository's
// history and the test checks read its working tree.
const CHECKS = join(__dirname, '../scripts/checks');
const CHECKER = join(CHECKS, 'closure-table.js');
const TABLE_PATH = 'closure.md';
const PINNED_TEST = 'tests/pinned.test.ts';
const PINNED_TEST_LINES = 10;
const HEADER =
  '| Id | Status | Fix sha | Pinning test file:line | Fails on pre-fix source |\n| --- | --- | --- | --- | --- |';

const git = (cwd: string, ...gitArguments: string[]): string =>
  execFileSync('git', gitArguments, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

let root: string;
let fixSha: string;
let strayCommit: string;

// The fix lives in the first commit and a later commit moves HEAD on, so the fix is an ancestor
// of HEAD but not HEAD itself. A commit made with commit-tree hangs off no branch, which makes
// it a sha that resolves but is not an ancestor of HEAD.
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'closure-table-test-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  writeFile(root, PINNED_TEST, `${'it();\n'.repeat(PINNED_TEST_LINES)}`);
  commitAll(root, 'fix');
  fixSha = git(root, 'rev-parse', 'HEAD');
  writeFile(root, 'later.txt', 'later\n');
  commitAll(root, 'later');
  strayCommit = git(root, 'commit-tree', 'HEAD^{tree}', '-m', 'stray');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const row = (id: string, status: string, sha: string, test: string, proof: string): string =>
  `| ${id} | ${status} | ${sha} | ${test} | ${proof} |`;

const tableOf = (...rows: string[]): string => `${HEADER}\n${rows.join('\n')}\n`;

const runChecker = (table: string): SpawnSyncReturns<string> => {
  writeFile(root, TABLE_PATH, table);

  return spawnSync('node', [CHECKER, TABLE_PATH], { encoding: 'utf8', cwd: root });
};

const findingLines = (result: SpawnSyncReturns<string>): string[] =>
  result.stdout.split('\n').filter((line) => line !== '');

const closed = (id: string): string =>
  row(id, 'CLOSED', fixSha, `${PINNED_TEST}:3`, 'yes, scratch copy with the fix reverted');

describe('scripts/checks/closure-table.js: a table that holds up', () => {
  it('passes one row per id with a resolving ancestor sha and an existing pinning test', () => {
    const result = runChecker(
      tableOf(
        closed('STAT-N4'),
        closed('SEC-C1'),
        closed('CS1'),
        closed('TX-C6a'),
        closed('12'),
        row('P5', 'CLOSED', fixSha.slice(0, 12), `\`${PINNED_TEST}:${PINNED_TEST_LINES}\``, 'Yes'),
      ),
    );

    expect(result.stderr).toBe('');
    expect(findingLines(result)).toEqual([]);
    expect(result.status).toBe(0);
  });

  it('lets an OPEN row leave its sha, test and proof empty', () => {
    const result = runChecker(
      tableOf(row('A1', 'OPEN', '', '', ''), row('A2', 'OPEN', '-', 'n/a', 'none')),
    );

    expect(findingLines(result)).toEqual([]);
    expect(result.status).toBe(0);
  });

  it('lets a CLOSED-UNPROVEN row say the test was not proven', () => {
    const result = runChecker(
      tableOf(row('A1', 'CLOSED-UNPROVEN', fixSha, `${PINNED_TEST}:1`, 'not proven')),
    );

    expect(findingLines(result)).toEqual([]);
    expect(result.status).toBe(0);
  });

  it('reads every table in the file and ignores the prose between them', () => {
    const result = runChecker(
      `Intro text.\n\n${tableOf(closed('A1'))}\nMore text.\n\n${tableOf(closed('A2'))}`,
    );

    expect(findingLines(result)).toEqual([]);
    expect(result.status).toBe(0);
  });
});

describe('scripts/checks/closure-table.js: an id cell', () => {
  it.each([
    ['a dot range', 'STAT-N1..N5'],
    ['a hyphen range', 'N1-N5'],
    ['a comma list', 'A1, A2'],
    ['a slash list', 'A1/A2'],
    ['a word', 'later'],
    ['two trailing letters', 'TX-C6ab'],
    ['an uppercase trailing letter', 'TX-C6A'],
    ['an empty cell', ''],
  ])('fails %s instead of one id', (_name, id) => {
    const result = runChecker(tableOf(closed(id)));

    expect(findingLines(result)).toEqual([expect.stringContaining('is not one id')]);
    expect(result.status).toBe(1);
  });

  it('fails an id that appears twice and names the first line', () => {
    const result = runChecker(tableOf(closed('A1'), closed('A2'), closed('A1')));

    expect(findingLines(result)).toEqual([
      expect.stringContaining('closure.md:5: id A1 appears twice (first at line 3)'),
    ]);
    expect(result.status).toBe(1);
  });
});

describe('scripts/checks/closure-table.js: a fix sha', () => {
  it.each([
    ['does not resolve', 'deadbeefdeadbeef', 'does not resolve to a commit'],
    ['is not hex', 'not-a-sha', 'is not a 7 to 40 digit hex'],
    ['is too short', 'abc', 'is not a 7 to 40 digit hex'],
  ])('fails a sha that %s', (_name, sha, message) => {
    const result = runChecker(tableOf(row('A1', 'CLOSED', sha, `${PINNED_TEST}:1`, 'yes')));

    expect(findingLines(result)).toEqual([expect.stringContaining(message)]);
    expect(result.status).toBe(1);
  });

  it('fails a commit that is not an ancestor of HEAD', () => {
    const result = runChecker(
      tableOf(row('A1', 'CLOSED', strayCommit.slice(0, 12), `${PINNED_TEST}:1`, 'yes')),
    );

    expect(findingLines(result)).toEqual([expect.stringContaining('is not an ancestor of HEAD')]);
    expect(result.status).toBe(1);
  });

  it('checks a sha an OPEN row fills in', () => {
    const result = runChecker(tableOf(row('A1', 'OPEN', 'deadbeefdeadbeef', '', '')));

    expect(findingLines(result)).toEqual([expect.stringContaining('does not resolve')]);
    expect(result.status).toBe(1);
  });
});

describe('scripts/checks/closure-table.js: a pinning test', () => {
  it.each([
    ['a missing file', 'tests/missing.test.ts:1', 'is not a file in the tree'],
    ['a folder', 'tests:1', 'is not a file in the tree'],
    ['a line past the end', `${PINNED_TEST}:${PINNED_TEST_LINES + 1}`, 'past the end of the file'],
    ['line 0', `${PINNED_TEST}:0`, 'past the end of the file'],
    ['no line', PINNED_TEST, 'is not path:line'],
    ['a range of lines', `${PINNED_TEST}:1-3`, 'is not path:line'],
    ['an absolute path', '/etc/hosts:1', 'is outside the repository'],
    ['a path outside the repository', '../outside.test.ts:1', 'is outside the repository'],
  ])('fails %s', (_name, reference, message) => {
    const result = runChecker(tableOf(row('A1', 'CLOSED', fixSha, reference, 'yes')));

    expect(findingLines(result)).toEqual([expect.stringContaining(message)]);
    expect(result.status).toBe(1);
  });

  it('checks a test an OPEN row fills in', () => {
    const result = runChecker(tableOf(row('A1', 'OPEN', '', 'tests/missing.test.ts:1', '')));

    expect(findingLines(result)).toEqual([expect.stringContaining('is not a file in the tree')]);
    expect(result.status).toBe(1);
  });
});

describe('scripts/checks/closure-table.js: a status', () => {
  it.each([
    ['CLOSED', 'CLOSED row has no fix sha'],
    ['CLOSED-UNPROVEN', 'CLOSED-UNPROVEN row has no fix sha'],
  ])('fails a %s row without a fix sha', (status, message) => {
    const result = runChecker(tableOf(row('A1', status, '', `${PINNED_TEST}:1`, 'yes')));

    expect(findingLines(result)).toEqual([expect.stringContaining(message)]);
    expect(result.status).toBe(1);
  });

  it.each([
    ['CLOSED', 'CLOSED row has no pinning test'],
    ['CLOSED-UNPROVEN', 'CLOSED-UNPROVEN row has no pinning test'],
  ])('fails a %s row without a pinning test', (status, message) => {
    const result = runChecker(tableOf(row('A1', status, fixSha, '-', 'yes')));

    expect(findingLines(result)).toEqual([expect.stringContaining(message)]);
    expect(result.status).toBe(1);
  });

  it.each([['not proven'], ['no'], ['']])(
    'fails a CLOSED row whose last cell says %p instead of yes',
    (proof) => {
      const result = runChecker(tableOf(row('A1', 'CLOSED', fixSha, `${PINNED_TEST}:1`, proof)));

      expect(findingLines(result)).toEqual([expect.stringContaining('CLOSED-UNPROVEN?')]);
      expect(result.status).toBe(1);
    },
  );

  it('fails a status that is not OPEN, CLOSED or CLOSED-UNPROVEN', () => {
    const result = runChecker(tableOf(row('A1', 'DONE', fixSha, `${PINNED_TEST}:1`, 'yes')));

    expect(findingLines(result)).toEqual([expect.stringContaining("status 'DONE' is not one of")]);
    expect(result.status).toBe(1);
  });
});

describe('scripts/checks/closure-table.js: the table shape', () => {
  it('fails a row with the wrong number of cells', () => {
    const result = runChecker(tableOf('| A1 | CLOSED | abc |'));

    expect(findingLines(result)).toEqual([expect.stringContaining('row has 3 cells, expected 5')]);
    expect(result.status).toBe(1);
  });

  it('fails a file with no table, so a missing table never reads as a pass', () => {
    const result = runChecker('No table here.\n');

    expect(findingLines(result)).toEqual([expect.stringContaining('no closure table rows')]);
    expect(result.status).toBe(1);
  });

  it('fails a table whose header is not the closure columns', () => {
    const result = runChecker(`| Id | Status |\n| --- | --- |\n| A1 | OPEN |\n`);

    expect(findingLines(result)).toEqual([expect.stringContaining('no closure table rows')]);
    expect(result.status).toBe(1);
  });

  it('reports every bad row, one finding each', () => {
    const result = runChecker(tableOf(closed('A1..A3'), closed('B1'), closed('C1-C2')));

    expect(findingLines(result)).toHaveLength(2);
    expect(result.status).toBe(1);
  });

  it('exits 2 for no argument and for an unreadable table', () => {
    const noArgument = spawnSync('node', [CHECKER], { encoding: 'utf8', cwd: root });
    const unreadable = spawnSync('node', [CHECKER, 'missing.md'], { encoding: 'utf8', cwd: root });

    expect(noArgument.status).toBe(2);
    expect(unreadable.status).toBe(2);
    expect(unreadable.stderr).toContain('cannot read missing.md');
  });
});

describe('scripts/checks/closure-table.sh', () => {
  // The wrapper computes its ROOT as scripts/checks/../.., so it runs as a copy inside the
  // throwaway repository.
  // npm runs a script at the package root and keeps the caller's folder in INIT_CWD; an inherited
  // INIT_CWD would otherwise decide where a relative path starts in every row here.
  const runWrapperIn = (
    cwd: string,
    initialDirectory: string | undefined,
    ...wrapperArguments: string[]
  ): SpawnSyncReturns<string> => {
    mkdirSync(join(root, 'scripts/checks'), { recursive: true });

    for (const name of ['closure-table.sh', 'closure-table.js', '_lib.sh']) {
      copyFileSync(join(CHECKS, name), join(root, 'scripts/checks', name));
    }

    const { INIT_CWD: _inherited, ...environment } = process.env;

    return spawnSync('bash', [join(root, 'scripts/checks/closure-table.sh'), ...wrapperArguments], {
      encoding: 'utf8',
      cwd,
      env:
        initialDirectory === undefined
          ? environment
          : { ...environment, INIT_CWD: initialDirectory },
    });
  };

  const runWrapper = (...wrapperArguments: string[]): SpawnSyncReturns<string> =>
    runWrapperIn(root, undefined, ...wrapperArguments);

  it('reads a relative table path from where the caller stands, not from the repository root', () => {
    writeFile(root, 'notes/closure.md', tableOf(closed('A1')));

    const result = runWrapperIn(join(root, 'notes'), undefined, 'closure.md');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('reads a relative table path from INIT_CWD when npm has moved the script to the root', () => {
    writeFile(root, 'notes/closure.md', tableOf(closed('A1')));

    const result = runWrapperIn(root, join(root, 'notes'), 'closure.md');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('is silent and exits 0 for a good table', () => {
    writeFile(root, TABLE_PATH, tableOf(closed('A1')));

    const result = runWrapper(TABLE_PATH);

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('prints the structured block with the findings and exits 2 for a bad table', () => {
    writeFile(root, TABLE_PATH, tableOf(closed('A1..A3')));

    const result = runWrapper(TABLE_PATH);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: Closure table');
    expect(result.stderr).toContain('closure.md:3: id');
  });

  it('exits 2 with the block when it gets no table path', () => {
    const result = runWrapper();

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: Closure table');
  });

  it('exits 2 with the block when the checker cannot read the table', () => {
    const result = runWrapper('missing.md');

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/cannot read .*missing\.md/);
  });
});
