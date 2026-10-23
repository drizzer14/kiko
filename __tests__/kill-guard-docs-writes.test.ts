import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  createFakeRepository,
  decideInEachFolder,
} from './test-support/kill-guard-fake-repository';
import { decideAll } from './test-support/kill-guard-decide';
import { removeTemporaryDirectories } from './test-support/temporary-directory';

// The shell-write deny of scripts/checks/kill-guard.js for docs/superpowers/ (plans, specs): a
// Bash write there skips the pre-write guard like a write into src/, so only Edit/Write may
// change it. Only that folder is guarded: the rest of docs/ (docs/harness/ and every other
// folder; the neutral "not a guarded tree" folder of kill-guard-writes.test.ts) stays writable
// by shell, and those rows there stay as they are.
//
// Every text here is judged, never run: `decide` is called in node as a parser only. A relative
// path is judged from a linked worktree and the main checkout; from a folder outside the project
// it names nothing of the project, so it is allowed there.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard.sh');
const SHELL_WRITE = 'shellWrite';

const repository = createFakeRepository('guard-docs-writes-');
afterAll(removeTemporaryDirectories);

const { main: MAIN, worktree: WORKTREE, outside: OUTSIDE } = repository;

const WRITE_TEMPLATES: Array<(file: string) => string> = [
  (file) => `sed -i '' 's/a/b/' ${file}`,
  (file) => `perl -pi -e 's/a/b/' ${file}`,
  (file) => `echo x > ${file}`,
  (file) => `echo x >> ${file}`,
  (file) => `echo x >| ${file}`,
  (file) => `echo x | tee ${file}`,
  (file) => `echo x | tee -a ${file}`,
  (file) => `cp /tmp/x ${file}`,
  (file) => `mv /tmp/x ${file}`,
  (file) => `python3 -c "open('${file}', 'w').write('x')"`,
  (file) => `python3 - <<'EOF'\nopen('${file}', 'w').write('x')\nEOF`,
  (file) => `node -e "require('fs').writeFileSync('${file}', 'x')"`,
];

// An `xargs sed -i` is denied whatever its target, so only a denied list may use these.
const XARGS_WRITE_TEMPLATES: Array<(file: string) => string> = [
  (file) => `echo ${file} | xargs sed -i '' 's/a/b/'`,
  (file) => `echo x | xargs sed -i '' 's/a/b/' ${file}`,
];

const GUARDED_FILES = ['docs/superpowers/plans/a.md', 'docs/superpowers/a.md'];

const DENIED_ABSOLUTE_PATHS: string[] = GUARDED_FILES.flatMap((file) =>
  [MAIN, WORKTREE].flatMap((root) =>
    [...WRITE_TEMPLATES, ...XARGS_WRITE_TEMPLATES].map((template) => template(`${root}/${file}`)),
  ),
);

const DENIED_RELATIVE_PATHS: string[] = [
  ...GUARDED_FILES.flatMap((file) =>
    [...WRITE_TEMPLATES, ...XARGS_WRITE_TEMPLATES].map((template) => template(file)),
  ),
  'echo x > ./docs/superpowers/a.md',
  'echo x > docs/./superpowers/a.md',
  'echo x > docs//superpowers/a.md',
  'echo x > src/../docs/superpowers/a.md',
  // Case folds as it does for the trees of kill-guard-writes.test.ts.
  'echo x > DOCS/SUPERPOWERS/a.md',
  'echo x > Docs/Superpowers/plans/a.md',
  "sed -i '' 's/a/b/' DOCS/superpowers/a.md",
  'gcp /tmp/x docs/superpowers/a.md',
  'gmv /tmp/x docs/superpowers/a.md',
  'git show HEAD:docs/superpowers/a.md > docs/superpowers/a.md',
  // A destination that is the folder itself, or a folder inside it.
  'cp x docs/superpowers',
  'cp x docs/superpowers/',
  'cp x docs/superpowers/plans',
  'mv x docs/superpowers/',
  'cp -r /tmp/dir docs/superpowers/',
  'cp -r /tmp/x ./docs/superpowers',
  'cp -t docs/superpowers x',
  'cp -t docs/superpowers/plans x',
  'mv -vt docs/superpowers a.md',
  'cp --target-directory=docs/superpowers x',
  'cp --target-directory docs/superpowers/plans x',
  'cp -rT /tmp/x docs/superpowers',
  'mv -T /tmp/x docs/superpowers',
  'cp --no-target-directory /tmp/x docs/superpowers',
  // The names xargs reads are unknowable, so a copy or move behind it into the folder, or one
  // inside it, may write a guarded file.
  'ls /tmp/*.md | xargs cp -t docs/superpowers',
  'ls /tmp/*.md | xargs cp -t docs/superpowers/',
  'ls /tmp/*.md | xargs cp -t docs/superpowers/plans',
  'ls /tmp/*.md | xargs mv --target-directory=docs/superpowers',
  'ls /tmp/*.md | xargs -I{} cp {} docs/superpowers/',
  'ls /tmp/*.md | xargs -I {} mv {} docs/superpowers/plans/',
  'ls /tmp/*.md | xargs cp /tmp/a.md docs/superpowers/plans',
  `ls /tmp/*.md | xargs cp -t ${MAIN}/docs/superpowers`,
  `ls /tmp/*.md | xargs -I{} mv {} ${WORKTREE}/docs/superpowers/plans/`,
  // A folder change into the folder, or into docs/ before the relative write.
  'cd docs/superpowers && echo x > a.md',
  'cd docs/superpowers && echo x >> a.md',
  'cd docs/superpowers/plans && echo x > a.md',
  "cd docs/superpowers && sed -i '' 's/a/b/' a.md",
  'cd docs/superpowers && cp /tmp/x .',
  'cd docs/superpowers && echo x | tee a.md',
  'cd docs && echo x > superpowers/a.md',
  'cd docs && cp a superpowers/b',
  'cd docs && cp -r /tmp/x superpowers',
  'pushd docs/superpowers && echo x > a.md',
  'pushd docs && echo x > superpowers/a.md',
  '(cd docs/superpowers && echo x > a.md)',
  'cd docs && (cd superpowers && echo x > a.md)',
  `cd ${WORKTREE}/docs/superpowers && echo x | tee a.md`,
  `cd ${MAIN}/docs && echo x > superpowers/a.md`,
  // A variable the same command assigns, whole or as the folder in front of the rest.
  'D=docs/superpowers; echo x > $D/a.md',
  'D=docs/superpowers; echo x > "$D/a.md"',
  'D=docs; echo x > $D/superpowers/a.md',
  'D=docs/superpowers; cp /tmp/a $D/x.md',
  "f=docs/superpowers/plans/a.md; sed -i '' 's/a/b/' $f",
  'f=docs/superpowers/a.md; echo x >> "$f"',
  'f=docs/superpowers/a.md; echo x | tee $f',
  `f=${MAIN}/docs/superpowers/a.md; echo x > $f`,
  // A path the text cannot resolve still names the folder.
  'echo x > $X/docs/superpowers/a.md',
  'echo x > "$X/docs/superpowers/a.md"',
  "sed -i '' 's/a/b/' $D/docs/superpowers/plans/a.md",
  'cp /tmp/x $D/docs/superpowers/a.md',
  'echo x | tee $D/docs/superpowers/a.md',
  'echo x > $D/docs/./superpowers/a.md',
  'echo x > $D/docs//superpowers/a.md',
  // Interpreters that name the folder by a join, from the folder it runs in or not.
  `python3 -c "from pathlib import Path; Path('docs/superpowers/a.md').write_text('x')"`,
  `python3 -c "import os; open(os.path.join('docs', 'superpowers', n), 'w')"`,
  `cd docs && python3 -c "import os; open(os.path.join('superpowers', n), 'w')"`,
  `node -e "fs.writeFileSync(path.join('docs/superpowers', n), 'x')"`,
  `cd docs && node -e "fs.writeFileSync(path.join('superpowers', n), 'x')"`,
  "node <<'EOF'\nrequire('fs').writeFileSync('docs/superpowers/a.md', 'x')\nEOF",
  // The same through a nested shell, an eval, a substitution and a list.
  'bash -c "echo x > docs/superpowers/a.md"',
  `sh -c "sed -i 's/a/b/' docs/superpowers/a.md"`,
  'eval "echo x > docs/superpowers/a.md"',
  'echo $(echo x > docs/superpowers/a.md)',
  'true && echo x > docs/superpowers/a.md',
];

const ALLOWED_BESIDE_THE_FOLDER: string[] = [
  ...[
    'docs/a.md',
    'docs/harness/a.md',
    'docs/harness/plans/a.md',
    'docs/x/a.md',
    'docs/superpowersx/a.md',
    'docs/superpowers-notes/a.md',
    'docs/superpowers.md',
    'docs/notsuperpowers/a.md',
    'mydocs/superpowers/a.md',
    'superpowers/a.md',
    '.superpowers/sdd/a.md',
    '/tmp/docs/superpowers/a.md',
    `${OUTSIDE}/docs/superpowers/a.md`,
  ].flatMap((file) => WRITE_TEMPLATES.map((template) => template(file))),
  'cat docs/superpowers/a.md',
  'grep -rn foo docs/superpowers/',
  "sed -n '1,5p' docs/superpowers/plans/a.md",
  'cp docs/superpowers/a.md /tmp/a.md',
  'cp -r docs/superpowers /tmp/backup',
  'git mv docs/superpowers/a.md docs/superpowers/b.md',
  'git add docs/superpowers/a.md',
  "git commit -m 'docs: x'",
  'git checkout -- docs/superpowers/a.md',
  'npx prettier --write docs/superpowers/a.md',
  'mkdir -p docs/superpowers/new',
  'touch docs/superpowers/a.md',
  'rm docs/superpowers/a.md',
  'echo "x > docs/superpowers/a.md"',
  'echo "docs/superpowers/a.md" > /tmp/names.txt',
  `python3 -c "print(open('docs/superpowers/a.md').read())"`,
  `python3 -c "open('/tmp/x', 'w').write(open('docs/superpowers/a.md').read())"`,
  `python3 -c "open('docs/harness/a.md', 'w').write('x')"`,
  `node -e "require('fs').writeFileSync('docs/harness/a.md', 'x')"`,
  // A folder beside it, or its parent, as a destination or a working folder.
  'cp -r /tmp/x docs/',
  'cp -r /tmp/x ./docs/harness',
  'cp x docs/harness/',
  'cp -t docs/harness x',
  'cp --target-directory=docs x',
  'cp -rT /tmp/x docs/harness',
  'ls /tmp/*.md | xargs cp -t /tmp/out/superpowers',
  'ls docs/superpowers | xargs cat',
  'ls docs/superpowers | xargs -I{} cp {} /tmp/backup/',
  'cd docs/superpowers && cat a.md',
  'cd docs/superpowers && echo x > /tmp/a',
  'cd docs/superpowers && cp a.md /tmp/a.md',
  'cd docs && echo x > a.md',
  'cd docs && echo x > harness/a.md',
  'cd docs && cp a harness/b',
  'cd docs/harness && echo x > a.md',
  'cd /tmp && echo x > docs/superpowers/a.md',
  'D=docs/harness; echo x > $D/a.md',
  'D=docs; echo x > $D/harness/a.md',
  'D=docs/superpowers; cat $D/a.md',
  'f=docs/superpowers/a.md; cat $f',
  'f=docs/superpowers/a.md; cp $f /tmp/backup.md',
  'f=docs/superpowers/a.md; f=/tmp/a; echo x > $f',
  'echo x > $X/docs/harness/a.md',
  'echo x > $X/docs/superpowersx/a.md',
  `cd docs && python3 -c "import os; open(os.path.join('harness', n), 'w')"`,
  `cd docs && node -e "fs.writeFileSync(path.join('harness', n), 'x')"`,
];

const FOLDER_LEVEL_CWDS: [string, string, string][] = [
  ['the folder itself', join(MAIN, 'docs/superpowers'), 'echo x > a.md'],
  ['a folder inside it', join(WORKTREE, 'docs/superpowers/plans'), 'echo x > a.md'],
  ['its parent', join(MAIN, 'docs'), 'echo x > superpowers/a.md'],
];

describe('kill-guard docs/superpowers shell-write deny (parser only, fake repository)', () => {
  it.each(DENIED_ABSOLUTE_PATHS)(
    'denies a write by absolute path in every folder: %s',
    (command) => {
      expect(decideInEachFolder(repository, command)).toEqual([
        SHELL_WRITE,
        SHELL_WRITE,
        SHELL_WRITE,
      ]);
    },
  );

  it.each(DENIED_RELATIVE_PATHS)(
    'denies a relative write from a worktree and the main checkout: %s',
    (command) => {
      expect(decideInEachFolder(repository, command).slice(0, 2)).toEqual([
        SHELL_WRITE,
        SHELL_WRITE,
      ]);
    },
  );

  it.each(ALLOWED_BESIDE_THE_FOLDER)(
    'allows a read, a write beside the folder or one outside the project: %s',
    (command) => {
      expect(decideInEachFolder(repository, command)).toEqual(['allow', 'allow', 'allow']);
    },
  );

  it.each(FOLDER_LEVEL_CWDS)('denies a write judged from %s', (_label, directory, command) => {
    expect(decideAll([[command, { projectRoot: MAIN, cwd: directory }]])).toEqual([SHELL_WRITE]);
  });

  it.each([
    ['docs/', join(MAIN, 'docs'), 'echo x > a.md'],
    ['docs/harness/', join(WORKTREE, 'docs/harness'), 'echo x > a.md'],
    ['docs/superpowers/ read', join(MAIN, 'docs/superpowers'), 'cat a.md'],
  ])('allows a write judged from %s', (_label, directory, command) => {
    expect(decideAll([[command, { projectRoot: MAIN, cwd: directory }]])).toEqual(['allow']);
  });

  it('allows a relative write from a folder outside the project', () => {
    expect(
      decideAll([
        ['echo x > docs/superpowers/a.md', { projectRoot: MAIN, cwd: OUTSIDE }],
        ['cp /tmp/x docs/superpowers/plans/a.md', { projectRoot: MAIN, cwd: OUTSIDE }],
      ]),
    ).toEqual(['allow', 'allow']);
  });
});

describe('scripts/checks/kill-guard.sh docs/superpowers shell-write deny (hook entry)', () => {
  const run = (command: string) =>
    spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ cwd: join(__dirname, '..'), tool_input: { command } }),
      encoding: 'utf8',
    });

  it('denies a write into docs/superpowers/ and names the folder and Edit/Write', () => {
    const result = run('echo x > docs/superpowers/plans/a.md');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe('');
    const { hookSpecificOutput } = JSON.parse(result.stdout.trim());
    const reason: string = hookSpecificOutput.permissionDecisionReason;
    expect(hookSpecificOutput.permissionDecision).toBe('deny');
    expect(reason).toContain(join(__dirname, '..', 'docs/superpowers/plans/a.md'));
    expect(reason).toContain('docs/superpowers/');
    expect(reason).toContain('Edit or Write');
  });

  it('allows a write into docs/harness/', () => {
    const result = run('echo x > docs/harness/a.md');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});
