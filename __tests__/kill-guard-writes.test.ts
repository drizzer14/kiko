import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// The shell-write deny of scripts/checks/kill-guard.js: a Bash command that
// writes into src/, __tests__/, or rules/ of any worktree of this repository
// (`sed -i`, `perl -i`, a `>`/`>>` redirect, `tee`, a python or node
// one-liner) skips the pre-write guard, which sees only Edit/Write/MultiEdit,
// so the hook denies it and points at Edit/Write.
//
// Every text here is judged, never run: `decide` is called in node as a
// parser only, and the hook rows only pipe JSON into kill-guard.sh. The
// sentinel is a fake repository in a scratch folder, passed through the
// test-only `projectRoot` option, so no row names a real file to write.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard.sh');
const GUARD = join(__dirname, '../scripts/checks/kill-guard.js');
const REPOSITORY_ROOT = join(__dirname, '..');

const DECIDE_SCRIPT = [
  'const { decide } = require(process.argv[1]);',
  'const finding = decide(process.argv[2], JSON.parse(process.argv[3]));',
  'process.stdout.write(finding === null ? "allow" : finding.kind);',
].join('\n');

// A fake repository: `main` (its own .git folder), `worktree` (a linked
// worktree of main, a .git file), `other` (an unrelated repository), and
// `plain` (no repository at all).
const SCRATCH = mkdtempSync(join(tmpdir(), 'guard-writes-'));
const MAIN = join(SCRATCH, 'main');
const WORKTREE = join(SCRATCH, 'worktree');
const OTHER = join(SCRATCH, 'other');
const PLAIN = join(SCRATCH, 'plain');

for (const folder of [
  'main/.git/worktrees/worktree',
  'main/src',
  'main/__tests__',
  'main/rules',
  'main/scripts',
  'main/docs/src',
  'main/node_modules/package/src',
  'worktree/src',
  'other/.git',
  'other/src',
  'plain/src',
]) {
  mkdirSync(join(SCRATCH, folder), { recursive: true });
}
writeFileSync(join(MAIN, '.git/worktrees/worktree/commondir'), '../..\n');
writeFileSync(join(WORKTREE, '.git'), `gitdir: ${join(MAIN, '.git/worktrees/worktree')}\n`);

const decide = (command: string, options: Record<string, unknown> = {}): string =>
  spawnSync(
    'node',
    ['-e', DECIDE_SCRIPT, GUARD, command, JSON.stringify({ projectRoot: MAIN, ...options })],
    { encoding: 'utf8' },
  ).stdout;

const decideInMain = (command: string): string => decide(command, { cwd: MAIN });

const DETAIL_SCRIPT = [
  'const { decide } = require(process.argv[1]);',
  'const finding = decide(process.argv[2], JSON.parse(process.argv[3]));',
  'process.stdout.write(finding?.detail ?? "allow");',
].join('\n');

const detailOf = (command: string): string =>
  spawnSync(
    'node',
    ['-e', DETAIL_SCRIPT, GUARD, command, JSON.stringify({ projectRoot: MAIN, cwd: MAIN })],
    { encoding: 'utf8' },
  ).stdout;

const DENIED_SED_AND_PERL: string[] = [
  "sed -i 's/a/b/' src/x.ts",
  "sed -i '' 's/a/b/' src/x.ts",
  "sed -i.bak 's/a/b/' src/x.ts",
  "sed -i -e 's/a/b/' __tests__/x.test.ts",
  "sed --in-place 's/a/b/' rules/semgrep-mobile.yml",
  "sed --in-place=.bak -e 's/a/b/' src/x.ts",
  "sed -Ei 's/a/b/' src/x.ts",
  "sed -n -i 's/a/b/p' src/x.ts",
  "gsed -i 's/a/b/' src/x.ts",
  "sed -i 's/a/b/' /tmp/fine.txt src/x.ts",
  "sed -i 's/a/b/' src/*.ts",
  "sed -i 's/a/b/' ./src/x.ts",
  "sed -i 's/a/b/' SRC/x.ts",
  `sed -i 's/a/b/' ${MAIN}/src/x.ts`,
  `sed -i 's/a/b/' ${WORKTREE}/src/x.ts`,
  "sed -i 's/a/b/' ../worktree/src/x.ts",
  "cd src && sed -i 's/a/b/' x.ts",
  'cd $VAR && echo x > src/y.ts',
  "perl -pi -e 's/a/b/' src/x.ts",
  "perl -i -pe 's/a/b/' src/x.ts",
  "perl -pi.bak -e 's/a/b/' src/x.ts",
  "perl -0pi -e 's/a/b/' src/x.ts",
  "perl -i.orig -p -e 's/a/b/' rules/x.yml",
  "perl -pie 's/a/b/' src/x.ts",
];

const DENIED_REDIRECTS: string[] = [
  'echo x > src/x.ts',
  'echo x >> src/x.ts',
  'echo x 1> src/x.ts',
  'echo x &> src/x.ts',
  'echo x &>> src/x.ts',
  'echo x >| src/x.ts',
  'echo x >& src/x.ts',
  'echo x 2> src/log.txt',
  'echo x <> src/x.ts',
  'echo x >src/x.ts',
  'echo x > "src/x.ts"',
  'printf x>>__tests__/a.test.ts',
  ': > rules/a.yml',
  '> src/x.ts',
  'echo x >! src/x.ts',
  "cat <<'EOF' > src/x.ts\nbody\nEOF",
  "cat > src/x.ts <<'EOF'\nbody\nEOF",
  'git show HEAD:src/x.ts > src/x.ts',
  `echo x > ${WORKTREE}/__tests__/x.test.ts`,
  'echo x > "$ROOT/src/x.ts"',
];

const DENIED_TEE: string[] = [
  'echo x | tee src/x.ts',
  'tee -a src/x.ts < /tmp/in.txt',
  'echo x | tee /tmp/a.txt src/b.ts >/dev/null',
  'echo x | sudo tee src/x.ts',
  'echo x | tee --append rules/x.yml',
];

const DENIED_INTERPRETERS: string[] = [
  `python3 -c "open('src/x.ts','w').write('x')"`,
  `python -c "open('src/x.ts', 'a').write('x')"`,
  `python3.12 -c "open('rules/x.yml', mode='w')"`,
  `python3 -c "from pathlib import Path; Path('src/x.ts').write_text('x')"`,
  `python3 -c "import sys; open(sys.argv[1], 'w').write('x')" src/x.ts`,
  `python3 -c "p = 'src/x.ts'; open(p, 'w').write('x')"`,
  `python3 -c "import os; open(os.path.join('src', 'x.ts'), 'w')"`,
  `python3 -c "open(f'src/{name}.ts', 'w')"`,
  "python3 - <<'EOF'\nopen('src/x.ts', 'w').write('x')\nEOF",
  "python3 <<'EOF'\nopen('__tests__/x.test.ts', 'w').write('x')\nEOF",
  `python3 <<< "open('src/x.ts', 'w').write('x')"`,
  `node -e "require('fs').writeFileSync('src/x.ts', 'x')"`,
  `node -e "require('fs').appendFileSync('__tests__/x.test.ts', 'x')"`,
  `node -e "require('fs').promises.writeFile('src/x.ts', 'x')"`,
  `node --eval "fs.writeFileSync('src/x.ts', 'x')"`,
  `node --eval="fs.writeFileSync('src/x.ts', 'x')"`,
  `node -e "require('fs').createWriteStream('rules/x.yml')"`,
  `node -e "require('fs').writeFileSync(process.argv[1], 'x')" src/x.ts`,
  `node -e 'require("fs").writeFileSync(\`src/\${name}.ts\`, "x")'`,
  "node <<'EOF'\nrequire('fs').writeFileSync('src/x.ts', 'x')\nEOF",
  "node - <<'EOF'\nrequire('fs').writeFileSync('src/x.ts', 'x')\nEOF",
  `node -e "require('fs').writeFileSync(process.cwd() + '/src/x.ts', 'x')"`,
  `python3 - <<'EOF'\nopen('${WORKTREE}/__tests__/x.test.ts', 'w').write('x')\nEOF`,
  `python3 - <<"EOF"\nopen('src/x.ts', 'w').write('x')\nEOF`,
  "python3 - <<\\EOF\nopen('src/x.ts', 'w').write('x')\nEOF",
  "python3 - <<-'EOF'\n\topen('src/x.ts', 'w').write('x')\n\tEOF",
  "python3 - <<EOF\nopen('src/x.ts', 'w').write('x')\nEOF",
  "python3 - <<'EOF' | tail -n 5\nopen('src/x.ts', 'w').write('x')\nEOF",
  "cd src && python3 - <<'EOF'\nopen('x.ts', 'w').write('x')\nEOF",
  "python3 - <<'EOF'\nfrom pathlib import Path\nPath('src/x.ts').open('w').write('x')\nEOF",
  "python3 - <<'EOF'\nfrom pathlib import Path\nPath('src/x.ts').open(mode='w').write('x')\nEOF",
  "python3 - <<'EOF'\nfrom pathlib import Path\nfor name in ['src/x.ts']:\n    Path(name).write_text('x')\nEOF",
  "python3 - <<'EOF'\nfiles = ['src/x.ts']\nfor name in files:\n    open(os.path.join(root, name), 'w')\nEOF",
  "python3 - <<'EOF'\nroot = '/tmp'\nopen(f'{root}/src/x.ts', 'w').write('x')\nEOF",
  `python3 -c "open('{}/__tests__/x.test.ts'.format(root), 'w')"`,
  `python3 -c "import os; open(os.path.join(root, 'src', name), 'w')"`,
  `python3 -c "root = '/tmp'; open(root + '/src/x.ts', 'w')"`,
];

const DENIED_NESTED: string[] = [
  `sh -c "sed -i 's/a/b/' src/x.ts"`,
  "bash -c 'echo x > src/x.ts'",
  "bash -lc 'echo x | tee src/x.ts'",
  "bash <<'EOF'\necho x > src/x.ts\nEOF",
  'eval "echo x > src/x.ts"',
  'echo $(echo x > src/x.ts)',
  'true && echo x > src/x.ts',
  '(cd src && echo x > y.ts)',
  'echo x | tee >(cat > src/x.ts)',
  `bash -c "python3 -c \\"open('src/x.ts', 'w')\\""`,
  "grep -rl foo src | xargs sed -i 's/foo/bar/'",
  "$(which sed) -i 's/a/b/' src/x.ts",
];

// A plain `mv` or `cp` into a tree reads as a new file to guard-replay, so
// every finding already in the moved text would read as new; `git mv` keeps
// the rename, so it stays allowed.
const DENIED_COPY_MOVE: string[] = [
  'cp /tmp/x.ts src/a/x.ts',
  'cp x.ts src',
  'mv a.ts __tests__/',
  'cp -t rules/fixtures x.good.ts',
  'cp --target-directory=src x.ts',
  'cp --target-directory src x.ts',
  'mv -vt src a.ts',
  'mv src/a.ts src/b.ts',
  'cp -r /tmp/dir src/',
  'cp /tmp/a.ts /tmp/b.ts src/',
  'mv -T /tmp/a.ts src/a.ts',
  'cp -S .bak /tmp/x.ts src/x.ts',
  'gcp /tmp/x.ts src/x.ts',
  'gmv /tmp/x.ts src/x.ts',
  `cp /tmp/x.ts ${WORKTREE}/src/`,
  'cd src && cp /tmp/x.ts .',
  'ls /tmp/*.ts | xargs cp -t src',
  'ls /tmp/*.ts | xargs cp -t src/',
  'ls /tmp/*.ts | xargs mv --target-directory=__tests__',
  'ls /tmp/*.ts | xargs -I{} cp {} src/',
  'ls /tmp/*.ts | xargs -I {} mv {} rules/fixtures/',
  'ls /tmp/*.ts | xargs -J % cp % src/',
  'ls /tmp/*.ts | xargs --replace=@ cp @ src/',
  'ls src/*.ts | xargs -I {} cp {} {}.bak',
  'ls /tmp/*.ts | xargs -I {} cp -t {} x.ts',
  'ls /tmp/*.ts | xargs cp /tmp/a.ts',
  'ls /tmp/*.ts | xargs cp /tmp/a.ts /tmp/b/',
];

const ALLOWED_COPY_MOVE: string[] = [
  "find src -name '*.snap' | xargs cp -t /tmp/snaps",
  'ls src/*.ts | xargs -I{} cp {} /tmp/backup/',
  'ls src/*.ts | xargs -I {} mv {} /tmp/backup/',
  'ls src/*.ts | xargs -J % cp % /tmp/backup/',
  'ls src/*.ts | xargs -i cp {} /tmp/backup/',
  'ls src/*.ts | xargs mv --target-directory=/tmp/backup',
  'cp src/a.ts /tmp/',
  'mv src/a.ts /tmp/a.ts',
  'git mv src/a.ts src/b/a.ts',
  `cp x.ts ${OTHER}/src/`,
  `cp x.ts ${PLAIN}/src/`,
  'cp -S src /tmp/x.ts /tmp/y/',
  'cp src/a.ts',
  'cp -r src /tmp/backup',
];

const ALLOWED: string[] = [
  "grep '>' src/x.ts",
  'echo "a > src/b"',
  "echo 'x >> src/y'",
  'echo a \\> src/b',
  'cat src/x.ts 2>/dev/null',
  'grep foo src/x.ts > /tmp/out.txt',
  'cat src/x.ts > /tmp/out.txt',
  "sed -n '1,5p' src/x.ts",
  "sed 's/a/b/' src/x.ts > /tmp/x.ts",
  "sed -i '' 's/a/b/' /tmp/x.txt",
  "sed -e 's/src/lib/' src/x.ts",
  "perl -ne 'print' src/x.ts",
  "perl -pe 's/a/b/' src/x.ts > /tmp/x.ts",
  'tee /tmp/log.txt < src/x.ts',
  'cat src/x.ts | tee /tmp/copy.ts',
  'echo x > /dev/null',
  'echo x 2>&1',
  'echo x >&2',
  'ls >&-',
  'echo x > scripts/out.txt',
  'echo x > docs/src/x.md',
  'echo x > node_modules/package/src/x.js',
  `echo x > ${OTHER}/src/x.ts`,
  `echo x > ${PLAIN}/src/x.ts`,
  `echo x > ${SCRATCH}/rules.txt`,
  'git diff > /tmp/change.diff',
  'git show HEAD:src/x.ts',
  'npx biome check --write src/x.ts',
  'npm run check:import-order -- --write',
  'node scripts/checks/import-order.js --write src/x.ts',
  `python3 -c "print(open('src/x.ts').read())"`,
  `python3 -c "open('/tmp/x.ts', 'w').write(open('src/x.ts').read())"`,
  `node -e "console.log(require('fs').readFileSync('src/x.ts', 'utf8'))"`,
  `node -e "require('fs').writeFileSync('/tmp/x.ts', require('fs').readFileSync('src/a.ts'))"`,
  `node -e "fs.writeFileSync(path.join(os.tmpdir(), 'x'), fs.readFileSync('src/a.ts'))"`,
  `python3 -c "import sys; open(sys.argv[1] + '.bak', 'w').write(open('src/a.ts').read())" /tmp/x`,
  `node -e "fs.writeFileSync(out, 'x')" src/a.ts`,
  'python3 scripts/tool.py src/a.ts',
  "python3 - <<'EOF'\nprint(open('src/x.ts').read())\nEOF",
  `python3 - <<'EOF'\nopen('${SCRATCH}/out.txt', 'w').write(open('src/x.ts').read())\nEOF`,
  "python3 - <<'EOF'\nopen('/tmp/out.txt', 'w').write('x')\nEOF",
  "python3 - <<'EOF'\nfrom pathlib import Path\nPath('/tmp/out.txt').write_text(Path('src/x.ts').read_text())\nEOF",
  "python3 - <<'EOF'\nfrom pathlib import Path\nfor name in ['/tmp/a.txt']:\n    Path(name).write_text('x')\nEOF",
  "python3 - <<'EOF'\nfrom pathlib import Path\nwith Path('src/x.ts').open('r') as source:\n    print(source.read())\nEOF",
  "python3 - <<'EOF'\nroot = '/tmp'\nopen(f'{root}/out.txt', 'w').write('x')\nEOF",
  "node - <<'EOF'\nrequire('fs').writeFileSync('/tmp/x.txt', require('fs').readFileSync('src/x.ts'))\nEOF",
  "node - <<'EOF'\nconsole.log(require('fs').readFileSync('src/x.ts', 'utf8'))\nEOF",
  "cat > /tmp/notes.md <<'EOF'\necho x > src/x.ts\nsed -i 's/a/b/' src/x.ts\nEOF",
  'git commit -m "$(cat <<\'EOF\'\nfix: stop > src/x redirects\nEOF\n)"',
  'npx jest __tests__/x.test.ts > /tmp/out.txt 2>&1',
  'diff <(cat src/a.ts) <(cat src/b.ts)',
  'cat <<< "x > src/y"',
  "find src -name '*.ts' -exec grep -l foo {} +",
  "find /tmp/x -exec sed -i 's/a/b/' {} +",
  `sed -i 's/a/b/' ${MAIN}/scripts/x.sh`,
  "sed -i 's/a/b/' /tmp/src.txt",
];

describe('kill-guard shell-write deny (parser only, fake repository)', () => {
  it.each([
    ...DENIED_SED_AND_PERL,
    ...DENIED_REDIRECTS,
    ...DENIED_TEE,
    ...DENIED_INTERPRETERS,
    ...DENIED_NESTED,
    ...DENIED_COPY_MOVE,
  ])('denies: %s', (command) => {
    expect(decideInMain(command)).toBe('shellWrite');
  });

  it.each([...ALLOWED, ...ALLOWED_COPY_MOVE])('allows: %s', (command) => {
    expect(decideInMain(command)).toBe('allow');
  });

  // Known limit: perl and ruby code is not read (guard-replay is the backstop).
  it.each([
    `perl -e 'open(F, ">src/x.ts")'`,
    `ruby -e "File.write('src/x.ts', 'x')"`,
    "perl - <<'EOF'\nopen(F, '>', 'src/x.ts');\nEOF",
  ])('does not read interpreter code it has no reader for: %s', (command) => {
    expect(decideInMain(command)).toBe('allow');
  });

  it('reads a relative tree path as a write into it when the payload names no cwd', () => {
    expect(decide('echo x > src/x.ts')).toBe('shellWrite');
    expect(decide('echo x > /tmp/x.ts')).toBe('allow');
  });

  it('denies from a subfolder of a worktree', () => {
    expect(decide('echo x > x.ts', { cwd: join(MAIN, 'src') })).toBe('shellWrite');
    expect(decide('echo x > x.ts', { cwd: join(MAIN, 'scripts') })).toBe('allow');
  });

  // A literal target writes that file; a variable or expression target may
  // write any string the code (for a bare variable) or the expression holds.
  it.each([
    [`python3 -c "open('src/x.ts', 'w')"`, `(writes ${MAIN}/src/x.ts)`],
    [
      `python3 -c "p = '/tmp/x'; open(p, 'w').write(open('src/a.ts').read())"`,
      `(may write ${MAIN}/src/a.ts)`,
    ],
    [`python3 -c "from pathlib import Path; Path('src/x.ts').write_text('x')"`, '(may write'],
    [
      "python3 - <<'EOF'\nfor name in ['src/x.ts']:\n    Path(name).write_text('x')\nEOF",
      `(may write ${MAIN}/src/x.ts)`,
    ],
  ])('names the file in DETAILS: %s', (command, detail) => {
    expect(detailOf(command)).toContain(detail);
  });

  it('judges 3000 write calls through a variable well inside the hook timeout', () => {
    const command = `node -e "${"fs.writeFileSync(p, 'x');".repeat(3000)}"`;
    const started = Date.now();

    expect(decideInMain(command)).toBe('allow');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('counts a tree only at the root of a worktree of this repository', () => {
    expect(decide('echo x > src/x.ts', { cwd: WORKTREE })).toBe('shellWrite');
    expect(decide('echo x > src/x.ts', { cwd: OTHER })).toBe('allow');
    expect(decide('echo x > src/x.ts', { cwd: PLAIN })).toBe('allow');
  });
});

const run = (payload: string): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT], { input: payload, encoding: 'utf8' });

const payloadIn = (directory: string, command: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ cwd: directory, tool_input: { command, ...extra }, ...extra });

const BLOCK_LABELS = ['WHAT FAILED:', 'DETAILS:', 'WHY IT MATTERS:', 'HOW TO FIX:', 'DO NOT:'];

describe('scripts/checks/kill-guard.sh shell-write deny (hook entry)', () => {
  it('denies a write into this repository with the standard block, pointing at Edit/Write', () => {
    const result = run(payloadIn(REPOSITORY_ROOT, "sed -i '' 's/a/b/' src/App.tsx"));

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    const reason: string = parsed.hookSpecificOutput.permissionDecisionReason;
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(BLOCK_LABELS.filter((label) => !reason.includes(label))).toEqual([]);
    expect(reason).toContain(join(REPOSITORY_ROOT, 'src/App.tsx'));
    expect(reason).toContain('Edit or Write');
    expect(reason).toContain('to move a file, use `git mv` (git add a new file first)');
  });

  it.each(['echo x > /tmp/out.txt', 'cat src/App.tsx > /dev/null', "sed -n '1p' src/App.tsx"])(
    'allows: %s',
    (command) => {
      const result = run(payloadIn(REPOSITORY_ROOT, command));

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('');
    },
  );

  it('denies a python write fed by a stdin heredoc and allows one that only reads', () => {
    const written = run(
      payloadIn(
        REPOSITORY_ROOT,
        "python3 - <<'PY'\nopen('__tests__/x.test.ts', 'w').write('x')\nPY",
      ),
    );
    const read = run(
      payloadIn(REPOSITORY_ROOT, "python3 - <<'PY'\nprint(open('__tests__/x.test.ts').read())\nPY"),
    );

    expect(JSON.parse(written.stdout.trim()).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(read.stdout.trim()).toBe('');
  });

  it('ignores a projectRoot option in its payload', () => {
    const result = run(payloadIn(MAIN, 'echo x > src/x.ts', { projectRoot: MAIN }));

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});
