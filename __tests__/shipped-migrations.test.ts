import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';

import { commitAll, writeFile, writeExecutable } from './test-support/mutation-repository';

// scripts/checks/shipped-migrations.sh fails when a drizzle/migrations file that
// already shipped (present at the merge-base with main or next) is modified,
// deleted or renamed. It runs here as a COPY inside a throwaway git repository,
// because the wrapper computes its ROOT as scripts/checks/../.. and reads the
// local main and next branches.
const CHECKS = join(__dirname, '../scripts/checks');
const MIGRATIONS = 'drizzle/migrations';

const FIRST_SQL = `${MIGRATIONS}/0000_init.sql`;
const SECOND_SQL = `${MIGRATIONS}/0001_second.sql`;
const THIRD_SQL = `${MIGRATIONS}/0002_third.sql`;
const FIRST_SNAPSHOT = `${MIGRATIONS}/meta/0000_snapshot.json`;
const SECOND_SNAPSHOT = `${MIGRATIONS}/meta/0001_snapshot.json`;
const JOURNAL = `${MIGRATIONS}/meta/_journal.json`;
const RUNNER_MAP = `${MIGRATIONS}/migrations.js`;
const TEST_FILE = `${MIGRATIONS}/0001-second.test.ts`;
const NOTES = `${MIGRATIONS}/notes.txt`;

type JournalEntry = Record<string, unknown>;

// Built by parsing text so the journal's own `idx` key is not an identifier here.
const entryFor = (position: number, tag: string): JournalEntry =>
  JSON.parse(
    `{"idx":${position},"version":"6","when":${1000 + position},"tag":"${tag}","breakpoints":true}`,
  );

const journalOf = (entries: JournalEntry[]): string =>
  `${JSON.stringify({ version: '7', dialect: 'sqlite', entries }, null, 2)}\n`;

const FIRST_ENTRY = entryFor(0, '0000_init');
const SECOND_ENTRY = entryFor(1, '0001_second');
const THIRD_ENTRY = entryFor(2, '0002_third');

const runnerMapOf = (tags: string[]): string =>
  [
    "import journal from './meta/_journal.json';",
    ...tags.map((tag) => `import m${tag.slice(0, 4)} from './${tag}.sql';`),
    '',
    'export default {',
    '  journal,',
    '  migrations: {',
    ...tags.map((tag) => `    m${tag.slice(0, 4)},`),
    '  },',
    '};',
    '',
  ].join('\n');

const FIRST_FILES: Record<string, string> = {
  [FIRST_SQL]: 'CREATE TABLE a (id integer);\n',
  [FIRST_SNAPSHOT]: '{"id":"first"}\n',
  [JOURNAL]: journalOf([FIRST_ENTRY]),
  [RUNNER_MAP]: runnerMapOf(['0000_init']),
  [NOTES]: 'shipped notes\n',
};

const SECOND_FILES: Record<string, string> = {
  [SECOND_SQL]: 'CREATE TABLE b (id integer);\n',
  [SECOND_SNAPSHOT]: '{"id":"second"}\n',
  [JOURNAL]: journalOf([FIRST_ENTRY, SECOND_ENTRY]),
  [RUNNER_MAP]: runnerMapOf(['0000_init', '0001_second']),
  [TEST_FILE]: 'export {};\n',
};

// What drizzle-kit writes when a third migration is added.
const THIRD_FILES: Record<string, string> = {
  [THIRD_SQL]: 'CREATE TABLE c (id integer);\n',
  [`${MIGRATIONS}/meta/0002_snapshot.json`]: '{"id":"third"}\n',
  [JOURNAL]: journalOf([FIRST_ENTRY, SECOND_ENTRY, THIRD_ENTRY]),
  [RUNNER_MAP]: runnerMapOf(['0000_init', '0001_second', '0002_third']),
};

const git = (root: string, ...gitArguments: string[]): string =>
  execFileSync('git', gitArguments, { cwd: root, encoding: 'utf8', stdio: 'pipe' });

const writeAll = (root: string, files: Record<string, string>): void => {
  for (const [relativePath, body] of Object.entries(files)) {
    writeFile(root, relativePath, body);
  }
};

// The medium tier runs these before and after the check under test; each is a
// pass here, so only shipped-migrations.sh decides the medium tier's result.
const OTHER_MEDIUM_WRAPPERS = [
  'dup.sh',
  'override-guard.sh',
  'guard-replay.sh',
  'knip.sh',
  'deps.sh',
  'semgrep-rules.sh',
  'plist.sh',
  'typecheck.sh',
];

const copyWrapper = (root: string): void => {
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });

  for (const name of ['shipped-migrations.sh', 'shipped-migrations.js', '_lib.sh', 'medium.sh']) {
    copyFileSync(join(CHECKS, name), join(root, 'scripts/checks', name));
  }

  for (const name of OTHER_MEDIUM_WRAPPERS) {
    writeExecutable(join(root, 'scripts/checks', name), '#!/usr/bin/env bash\nexit 0\n');
  }
};

// `main` ships the first and second migrations. `nextMode` decides what `next`
// is: absent, equal to main, an older commit than main (only the first
// migration), or a newer commit than main (it also shipped the third). HEAD is a
// `feature` branch cut from main, or from next when next is newer.
type NextMode = 'missing' | 'same' | 'older' | 'newer';

const buildRepository = (root: string, nextMode: NextMode, mainName = 'main'): void => {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  copyWrapper(root);
  writeAll(root, FIRST_FILES);

  if (nextMode !== 'older') {
    writeAll(root, SECOND_FILES);
  }

  commitAll(root, 'base');

  if (nextMode === 'older') {
    git(root, 'branch', 'next');
    writeAll(root, SECOND_FILES);
    commitAll(root, 'main ships the second migration');
  }

  if (nextMode === 'same') {
    git(root, 'branch', 'next');
  }

  if (nextMode === 'newer') {
    git(root, 'switch', '-q', '-c', 'next');
    writeAll(root, THIRD_FILES);
    commitAll(root, 'next ships the third migration');
  }

  git(root, 'switch', '-q', '-c', 'feature');

  if (mainName !== 'main') {
    git(root, 'branch', '-m', 'main', mainName);
  }
};

type Run = { code: number | null; stdout: string; stderr: string };

let temporaryDirectory: string;
let root: string;
let state: string;

const freshRepository = (nextMode: NextMode = 'same', mainName = 'main'): void => {
  buildRepository(root, nextMode, mainName);
};

const check = (script = 'shipped-migrations.sh'): Run => {
  const result = spawnSync('bash', [join(root, 'scripts/checks', script)], {
    cwd: root,
    env: { ...process.env, TMPDIR: state },
    encoding: 'utf8',
  });

  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const expectFailureNaming = (run: Run, ...fragments: string[]): void => {
  expect(run.code).toBe(2);
  expect(run.stdout).toBe('');

  for (const fragment of fragments) {
    expect(run.stderr).toContain(fragment);
  }
};

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiko-shipped-migrations-'));
  root = join(temporaryDirectory, 'project');
  state = join(temporaryDirectory, 'state');
  mkdirSync(state);
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('a clean tree', () => {
  it('passes silently', () => {
    freshRepository();

    expect(check()).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('names the base sha, the file, and the way out when a shipped file changes', () => {
    freshRepository();
    const baseSha = git(root, 'rev-parse', 'main').trim().slice(0, 12);
    writeFile(root, FIRST_SQL, 'CREATE TABLE a (id integer, name text);\n');

    expectFailureNaming(
      check(),
      FIRST_SQL,
      'modified',
      `base ${baseSha}`,
      `git show ${baseSha}:${FIRST_SQL} > ${FIRST_SQL}`,
    );
  });
});

describe('a shipped .sql file', () => {
  it('fails when modified', () => {
    freshRepository();
    writeFile(root, FIRST_SQL, 'CREATE TABLE a (id integer, name text);\n');

    expectFailureNaming(check(), FIRST_SQL, 'modified');
  });

  it('fails on a comment-only edit', () => {
    freshRepository();
    writeFile(root, FIRST_SQL, '-- a comment\nCREATE TABLE a (id integer);\n');

    expectFailureNaming(check(), FIRST_SQL, 'modified');
  });

  it('fails when deleted', () => {
    freshRepository();
    rmSync(join(root, FIRST_SQL));

    expectFailureNaming(check(), FIRST_SQL, 'deleted');
  });

  it('fails when renamed, naming the new path', () => {
    freshRepository();
    renameSync(join(root, FIRST_SQL), join(root, `${MIGRATIONS}/0000_renamed.sql`));

    expectFailureNaming(check(), FIRST_SQL, 'renamed', '0000_renamed.sql');
  });

  it('fails on an uncommitted edit', () => {
    freshRepository();
    writeFile(root, FIRST_SQL, 'CREATE TABLE a (id integer, extra text);\n');

    expect(git(root, 'status', '--porcelain')).toContain(FIRST_SQL);
    expectFailureNaming(check(), FIRST_SQL);
  });

  it('fails on an edit committed on the branch', () => {
    freshRepository();
    writeFile(root, FIRST_SQL, 'CREATE TABLE a (id integer, extra text);\n');
    commitAll(root, 'edit a shipped migration');

    expect(git(root, 'status', '--porcelain')).toBe('');
    expectFailureNaming(check(), FIRST_SQL);
  });
});

describe('a shipped snapshot', () => {
  it('fails when modified', () => {
    freshRepository();
    writeFile(root, FIRST_SNAPSHOT, '{"id":"changed"}\n');

    expectFailureNaming(check(), FIRST_SNAPSHOT, 'modified');
  });
});

describe('the journal', () => {
  it('fails when an existing entry changes', () => {
    freshRepository();
    writeFile(root, JOURNAL, journalOf([FIRST_ENTRY, { ...SECOND_ENTRY, when: 99999 }]));

    expectFailureNaming(check(), JOURNAL, 'journal entry 1 changed');
  });

  it('fails when an entry is removed', () => {
    freshRepository();
    writeFile(root, JOURNAL, journalOf([FIRST_ENTRY]));

    expectFailureNaming(check(), JOURNAL, 'journal entry 1 removed');
  });

  it('fails when the entries are reordered', () => {
    freshRepository();
    writeFile(root, JOURNAL, journalOf([SECOND_ENTRY, FIRST_ENTRY]));

    expectFailureNaming(check(), JOURNAL, 'journal entry 0 changed');
  });

  it('fails when a top-level key other than entries changes', () => {
    freshRepository();
    writeFile(
      root,
      JOURNAL,
      JSON.stringify({ version: '8', dialect: 'sqlite', entries: [FIRST_ENTRY, SECOND_ENTRY] }),
    );

    expectFailureNaming(check(), JOURNAL, 'version');
  });

  it('passes when the same journal is only reformatted', () => {
    freshRepository();
    writeFile(
      root,
      JOURNAL,
      JSON.stringify({ version: '7', dialect: 'sqlite', entries: [FIRST_ENTRY, SECOND_ENTRY] }),
    );

    expect(check().code).toBe(0);
  });

  it('fails closed on malformed JSON', () => {
    freshRepository();
    writeFile(root, JOURNAL, '{ "entries": [ ');

    expectFailureNaming(check(), JOURNAL);
  });
});

describe('the migrations.js runner map', () => {
  it('fails when a base line changes', () => {
    freshRepository();
    writeFile(
      root,
      RUNNER_MAP,
      readFileSync(join(root, RUNNER_MAP), 'utf8').replace('    m0001,', '    m0001x,'),
    );

    expectFailureNaming(check(), RUNNER_MAP, 'line removed or changed', 'm0001,');
  });

  it('fails when a base line is removed', () => {
    freshRepository();
    writeFile(
      root,
      RUNNER_MAP,
      readFileSync(join(root, RUNNER_MAP), 'utf8').replace(
        "import m0000 from './0000_init.sql';\n",
        '',
      ),
    );

    expectFailureNaming(check(), RUNNER_MAP, 'line removed or changed', 'm0000');
  });
});

describe('adding a new migration', () => {
  it('passes with a new .sql, a new snapshot, a journal entry and runner-map lines', () => {
    freshRepository();
    writeAll(root, THIRD_FILES);

    expect(check()).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});

describe('files that are free to change', () => {
  it('passes when a migration added only on the branch is edited', () => {
    freshRepository();
    writeFile(root, THIRD_SQL, 'CREATE TABLE c (id integer);\n');
    commitAll(root, 'add a migration on the branch');
    writeFile(root, THIRD_SQL, '-- edited\nCREATE TABLE c (id integer);\n');

    expect(check().code).toBe(0);
  });

  it('passes when a migration test file is edited', () => {
    freshRepository();
    writeFile(root, TEST_FILE, 'export const changed = 1;\n');

    expect(check().code).toBe(0);
  });

  it('fails when an unknown file type that shipped is edited', () => {
    freshRepository();
    writeFile(root, NOTES, 'edited notes\n');

    expectFailureNaming(check(), NOTES, 'modified');
  });
});

describe('the baseline', () => {
  it('protects a file that only the main base has when next is older', () => {
    freshRepository('older');
    writeFile(root, SECOND_SQL, 'CREATE TABLE b (id integer, name text);\n');

    expectFailureNaming(check(), SECOND_SQL, 'modified');
  });

  it('protects a file that only the next base has when next is newer', () => {
    freshRepository('newer');
    writeFile(root, THIRD_SQL, '-- edited\nCREATE TABLE c (id integer);\n');

    expectFailureNaming(check(), THIRD_SQL, 'modified');
  });

  it('protects through main alone when next is missing', () => {
    freshRepository('missing');
    writeFile(root, FIRST_SQL, '-- edited\nCREATE TABLE a (id integer);\n');

    expectFailureNaming(check(), FIRST_SQL, 'modified');
  });

  it('fails closed when main does not resolve', () => {
    freshRepository('same', 'trunk');

    expectFailureNaming(check(), 'main');
  });
});

describe('the medium tier', () => {
  // guard-replay's mark ref for this worktree: once HEAD is recorded there, a
  // clean tree leaves the medium tier nothing to do.
  const recordPassedReplay = (): void => {
    const gitDirectory = git(root, 'rev-parse', '--absolute-git-dir').trim();
    const worktreeId = createHash('sha1').update(gitDirectory).digest('hex').slice(0, 16);
    git(root, 'update-ref', `refs/kiko/guard-replay/${worktreeId}`, 'HEAD');
  };

  it('runs on a turn that only committed an edit to a shipped migration', () => {
    freshRepository();
    writeFile(root, FIRST_SQL, '-- edited\nCREATE TABLE a (id integer);\n');
    commitAll(root, 'edit a shipped migration');

    expectFailureNaming(check('medium.sh'), FIRST_SQL, 'modified');
  });

  it('is not silent when a session touched only a shipped .sql file', () => {
    freshRepository();
    recordPassedReplay();
    writeFile(root, FIRST_SQL, '-- edited\nCREATE TABLE a (id integer);\n');

    expectFailureNaming(check('medium.sh'), FIRST_SQL, 'modified');
  });

  it('stays silent when nothing changed', () => {
    freshRepository();
    recordPassedReplay();

    expect(check('medium.sh')).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});

describe('the dedup skip', () => {
  it('does not hide a later edit', () => {
    freshRepository();

    expect(check().code).toBe(0);
    expect(check().code).toBe(0);

    writeFile(root, FIRST_SQL, '-- edited\nCREATE TABLE a (id integer);\n');

    expectFailureNaming(check(), FIRST_SQL, 'modified');
  });

  it('does not hide an edit that follows a pass over an added migration', () => {
    freshRepository();
    writeFile(root, THIRD_SQL, 'CREATE TABLE c (id integer);\n');

    expect(check().code).toBe(0);

    writeFile(root, SECOND_SQL, '-- edited\nCREATE TABLE b (id integer);\n');

    expectFailureNaming(check(), SECOND_SQL);
  });
});
