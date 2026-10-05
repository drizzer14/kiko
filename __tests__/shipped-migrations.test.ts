import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// The medium tier runs these around the check under test. Each exits 2 with a
// marker, so a result of 0 proves the tier never reached it (the early exit) and
// a failure that names the marker proves it ran. guard-replay.sh is the one
// exception: it records this worktree's mark ref the way the real one does, with
// the same helpers from _lib.sh, so the mark moves to HEAD on a pass.
const OTHER_MEDIUM_WRAPPERS = [
  'dup.sh',
  'override-guard.sh',
  'knip.sh',
  'deps.sh',
  'semgrep-rules.sh',
  'plist.sh',
  'typecheck.sh',
];

const RECORDING_REPLAY = [
  '#!/usr/bin/env bash',
  'DIR="$(cd "$(dirname "$0")" && pwd)"',
  'source "$DIR/_lib.sh"',
  'ROOT="$(cd "$DIR/../.." && pwd)"',
  'git -C "$ROOT" update-ref "$(harness_replay_ref "$ROOT")" "$(harness_replay_mark "$ROOT")"',
  'exit 0',
  '',
].join('\n');

const copyWrapper = (root: string): void => {
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });

  for (const name of ['shipped-migrations.sh', 'shipped-migrations.js', '_lib.sh', 'medium.sh']) {
    copyFileSync(join(CHECKS, name), join(root, 'scripts/checks', name));
  }

  writeExecutable(join(root, 'scripts/checks/guard-replay.sh'), RECORDING_REPLAY);

  for (const name of OTHER_MEDIUM_WRAPPERS) {
    writeExecutable(
      join(root, 'scripts/checks', name),
      `#!/usr/bin/env bash\necho "stub ${name} ran" >&2\nexit 2\n`,
    );
  }
};

// `main` ships the first and second migrations. `nextMode` decides what `next`
// is: absent, equal to main, an older commit than main (only the first
// migration), a newer commit than main (it also shipped the third), or an edited
// commit (it rewrote `nextFiles`, files main already shipped). HEAD is a
// `feature` branch cut from main, or from next when next is newer or edited.
type NextMode = 'missing' | 'same' | 'older' | 'newer' | 'edited';

const buildRepository = (
  root: string,
  nextMode: NextMode,
  mainName = 'main',
  nextFiles: Record<string, string> = {},
): void => {
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

  if (nextMode === 'edited') {
    git(root, 'switch', '-q', '-c', 'next');
    writeAll(root, nextFiles);
    commitAll(root, 'next edits files main shipped');
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
let shimDirectory: string | undefined;

const freshRepository = (
  nextMode: NextMode = 'same',
  mainName = 'main',
  nextFiles: Record<string, string> = {},
): void => {
  buildRepository(root, nextMode, mainName, nextFiles);
};

// Puts a `git` ahead of the real one that exits 128 for `git merge-base HEAD
// <tip>` and runs the real git for every other call.
const breakMergeBaseWith = (tip: string): void => {
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  shimDirectory = join(temporaryDirectory, 'shims');
  mkdirSync(shimDirectory);
  writeExecutable(
    join(shimDirectory, 'git'),
    [
      '#!/usr/bin/env bash',
      `if [ "$1" = merge-base ] && [ "$3" = "${tip}" ]; then exit 128; fi`,
      `exec "${realGit}" "$@"`,
      '',
    ].join('\n'),
  );
};

const check = (script = 'shipped-migrations.sh'): Run => {
  const shimmedPath =
    shimDirectory === undefined ? process.env.PATH : `${shimDirectory}:${process.env.PATH}`;
  const result = spawnSync('bash', [join(root, 'scripts/checks', script)], {
    cwd: root,
    env: { ...process.env, TMPDIR: state, PATH: shimmedPath },
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
  shimDirectory = undefined;
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

describe('the earliest base that has a file decides', () => {
  const NEXT_COMMENT_EDIT = '-- edited on next\nCREATE TABLE a (id integer);\n';

  it('passes when the branch restores the main bytes of a file next edited', () => {
    freshRepository('edited', 'main', { [FIRST_SQL]: NEXT_COMMENT_EDIT });
    writeFile(root, FIRST_SQL, FIRST_FILES[FIRST_SQL] as string);

    expect(check()).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('fails with the next bytes of that file, naming the main base', () => {
    freshRepository('edited', 'main', { [FIRST_SQL]: NEXT_COMMENT_EDIT });
    const mainSha = git(root, 'rev-parse', 'main').trim().slice(0, 12);

    expectFailureNaming(
      check(),
      FIRST_SQL,
      'modified',
      `base ${mainSha}`,
      `git show ${mainSha}:${FIRST_SQL} > ${FIRST_SQL}`,
    );
  });

  it('passes when the branch restores a journal entry next changed, and fails without', () => {
    const changedJournal = journalOf([FIRST_ENTRY, { ...SECOND_ENTRY, when: 5 }]);
    freshRepository('edited', 'main', { [JOURNAL]: changedJournal });
    const mainSha = git(root, 'rev-parse', 'main').trim().slice(0, 12);

    expectFailureNaming(check(), JOURNAL, 'journal entry 1 changed', `base ${mainSha}`);

    writeFile(root, JOURNAL, SECOND_FILES[JOURNAL] as string);

    expect(check().code).toBe(0);
  });

  it('passes when the branch restores a runner-map line next changed, and fails without', () => {
    freshRepository('edited', 'main', {
      [RUNNER_MAP]: (SECOND_FILES[RUNNER_MAP] as string).replace('    m0001,', '    m0001x,'),
    });
    const mainSha = git(root, 'rev-parse', 'main').trim().slice(0, 12);

    expectFailureNaming(check(), RUNNER_MAP, 'line removed or changed', `base ${mainSha}`);

    writeFile(root, RUNNER_MAP, SECOND_FILES[RUNNER_MAP] as string);

    expect(check().code).toBe(0);
  });

  it('still protects the entries only next shipped, naming the next base', () => {
    freshRepository('newer');
    const nextSha = git(root, 'rev-parse', 'next').trim().slice(0, 12);
    writeFile(root, JOURNAL, journalOf([FIRST_ENTRY, SECOND_ENTRY]));

    expectFailureNaming(check(), JOURNAL, 'journal entry 2 removed', `base ${nextSha}`);
  });
});

describe('a change both bases decide', () => {
  it('is reported once, with the first base hint, while a next-only change keeps the next base', () => {
    freshRepository('newer');
    const mainSha = git(root, 'rev-parse', 'main').trim().slice(0, 12);
    const nextSha = git(root, 'rev-parse', 'next').trim().slice(0, 12);
    writeFile(
      root,
      JOURNAL,
      journalOf([{ ...FIRST_ENTRY, when: 7 }, SECOND_ENTRY, { ...THIRD_ENTRY, when: 8 }]),
    );

    const run = check();

    expectFailureNaming(run, 'journal entry 0 changed', 'journal entry 2 changed');
    expect(run.stderr.split('journal entry 0 changed').length - 1).toBe(1);
    expect(run.stderr).toMatch(new RegExp(`journal entry 0 changed[^\\n]*base ${mainSha}`));
    expect(run.stderr).toMatch(new RegExp(`journal entry 2 changed[^\\n]*base ${nextSha}`));
  });
});

describe('the failure hint for the journal and the runner map', () => {
  it('keeps the appended entries: it names the entry to restore, not the whole file', () => {
    freshRepository();
    writeFile(
      root,
      JOURNAL,
      journalOf([FIRST_ENTRY, { ...SECOND_ENTRY, when: 99999 }, THIRD_ENTRY]),
    );
    const run = check();

    expectFailureNaming(run, 'journal entry 1 changed', JSON.stringify(SECOND_ENTRY), 'keep');
    expect(run.stderr).not.toContain(`> ${JOURNAL}`);
  });

  it('keeps the inserted lines: it shows the base text of the line', () => {
    freshRepository();
    writeFile(
      root,
      RUNNER_MAP,
      readFileSync(join(root, RUNNER_MAP), 'utf8').replace('    m0001,', '    m0001x,'),
    );
    const run = check();

    expectFailureNaming(run, 'line removed or changed', '"    m0001,"', 'keep');
    expect(run.stderr).not.toContain(`> ${RUNNER_MAP}`);
  });
});

describe('the baseline resolution', () => {
  it('treats a next that shares no history with HEAD as no next base', () => {
    freshRepository('missing');
    git(root, 'switch', '-q', '--orphan', 'next');
    git(root, 'switch', '-q', 'feature');

    expect(check()).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('fails closed when merge-base with next fails for a reason other than no history', () => {
    freshRepository('newer');
    breakMergeBaseWith(git(root, 'rev-parse', 'next').trim());

    expectFailureNaming(check(), 'baseline');
  });

  it('fails closed when merge-base with main fails for a reason other than no history', () => {
    freshRepository('newer');
    breakMergeBaseWith(git(root, 'rev-parse', 'main').trim());

    expectFailureNaming(check(), 'baseline');
  });
});

describe('a journal that is not an object with an entries array', () => {
  it.each([
    ['null', 'null\n'],
    ['an array', '[]\n'],
    ['no entries array', '{"entries":5}\n'],
  ])('fails closed with a clear message for %s', (_name, body) => {
    freshRepository();
    writeFile(root, JOURNAL, body);

    expectFailureNaming(check(), JOURNAL, 'is not a journal object with an entries array');
  });
});

describe('the runner map subsequence', () => {
  it('fails when a changed line reappears later, so its original text is found only after its neighbours', () => {
    freshRepository();
    writeFile(
      root,
      RUNNER_MAP,
      readFileSync(join(root, RUNNER_MAP), 'utf8')
        .replace('    m0001,', '    m0001x,')
        .replace('};\n', '    m0001,\n};\n'),
    );

    expectFailureNaming(check(), RUNNER_MAP, 'line removed or changed');
  });

  it('fails when one of two identical base lines is removed', () => {
    freshRepository();
    const withoutBlankLine = readFileSync(join(root, RUNNER_MAP), 'utf8').replace(
      ';\n\nexport default {',
      ';\nexport default {',
    );
    expect(withoutBlankLine).not.toBe(readFileSync(join(root, RUNNER_MAP), 'utf8'));
    writeFile(root, RUNNER_MAP, withoutBlankLine);

    expectFailureNaming(check(), RUNNER_MAP, 'line removed or changed');
  });
});

describe('the medium tier', () => {
  // The recording stub moves this worktree's mark ref to HEAD, as a passed
  // replay does, so a clean tree then leaves the medium tier nothing to do.
  const recordPassedReplay = (): void => {
    expect(check('guard-replay.sh').code).toBe(0);
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

  it('stays silent when nothing changed, before any other wrapper runs', () => {
    freshRepository();
    recordPassedReplay();

    expect(check('medium.sh')).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('fails again on the next Stop after a committed shipped edit, because the replay mark never moved', () => {
    freshRepository();
    writeFile(root, FIRST_SQL, '-- edited\nCREATE TABLE a (id integer);\n');
    commitAll(root, 'edit a shipped migration');

    expectFailureNaming(check('medium.sh'), FIRST_SQL, 'modified');
    expectFailureNaming(check('medium.sh'), FIRST_SQL, 'modified');
  });

  it('stops after a clean committed turn, before the project-wide wrappers', () => {
    freshRepository();
    writeFile(root, THIRD_SQL, 'CREATE TABLE c (id integer);\n');
    commitAll(root, 'add a migration');

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
