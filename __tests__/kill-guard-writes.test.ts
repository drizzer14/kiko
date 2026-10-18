import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// The shell-write deny of scripts/checks/kill-guard.js: a Bash command that
// writes into src/, __tests__/, rules/, e2e/, drizzle/, scripts/, or githooks/ of any worktree of
// this repository, or into a YAML file (final segment .yml/.yaml) anywhere in one except under
// node_modules/ (`sed -i`, `perl -i`, a `>`/`>>` redirect, `tee`, a python or node
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
  'main/drizzle/migrations/meta',
  'main/scripts/checks',
  'main/githooks',
  'main/.maestro',
  'main/docs/src',
  'main/docs/x',
  'main/node_modules/package/src',
  'worktree/src',
  'worktree/scripts/checks',
  'worktree/githooks',
  'worktree/.maestro',
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
  `python3 -c "from pathlib import Path; Path('src/x.ts').open(encoding='utf8', mode='w')"`,
  `python3 -c "from pathlib import Path; Path('src/x.ts').open(newline='', mode = 'a')"`,
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
  "ls src/*.ts | xargs -iR sed -i 's/a/b/' R",
  "ls src/*.ts | xargs -eS sed -i 's/a/b/'",
  "xargs -iR sed -i 's/a/b/' src/x.ts",
  "xargs -eS sed -i 's/a/b/' src/x.ts",
  "ls src/*.ts | xargs --max-args 1 sed -i 's/a/b/'",
  "ls src/*.ts | xargs -0iR sed -i 's/a/b/' R",
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
  'echo src | xargs -eIX cp /tmp/a /tmp/b',
  'echo src | xargs -ei cp /tmp/a /tmp/b',
  'echo src | xargs -lI{} cp /tmp/a /tmp/b',
  // A destination that is a tree folder itself gets what it copies inside it,
  // also when only the source's name makes it one (`src` into `.`).
  'cp -a /tmp/snap/. src/',
  'cp -a /tmp/snap/. ./src',
  'cp -r /tmp/backup/src .',
  'mv /tmp/src .',
  `cp -R /tmp/snap/__tests__ ${MAIN}/`,
  'cp -r /tmp/rules .',
  'cp -rT /tmp/x ./src',
  'cp -Tr /tmp/x src',
  'mv -T /tmp/x src',
  'cp --no-target-directory /tmp/x src',
  'cp -rT /tmp/x "$ROOT/src"',
  // The input xargs hands a cp/mv may carry a tree folder's name.
  'ls | xargs -I{} cp -r {} .',
  'ls /tmp/snap | xargs -I % mv /tmp/snap/% .',
  'ls /tmp/snap | xargs cp -r -t .',
  // A destination the text cannot resolve may hold a folder, so a recursive
  // copy or any move may write a tree folder there; the text itself still
  // names one in `cp -r /tmp/src "$BK"/`.
  'ls | xargs -I{} cp -r {} "$BK"/',
  'ls | xargs -I{} cp -R {} "$BK"/',
  'ls | xargs -I{} cp -ra {} "$BK"/',
  'ls | xargs -I{} cp --recursive {} "$BK"/',
  'ls | xargs -I{} mv {} "$BK"/old/',
  'ls | xargs cp -a -t "$BK"',
  'ls | xargs cp --archive -t "$BK"',
  // GNU reads an abbreviated long option.
  'ls | xargs -I{} cp --recur {} "$BK"/',
  'ls | xargs -I{} gcp --recur {} "$BK"/',
  'ls | xargs -I{} gcp --arch {} "$BK"/',
  'ls | xargs -I{} cp --recursive=x {} "$BK"/',
  'cp -r /tmp/src "$BK"/',
  // The names xargs reads are unknowable, so a cp/mv behind it into any folder of a worktree may
  // write a YAML file there (fail closed), whatever its text shows.
  'ls /tmp/*.yml | xargs cp -t .maestro',
  "printf '%s\\n' /tmp/evil.yml | xargs -I{} cp {} .github/workflows/",
  'ls /tmp/*.yml | xargs mv --target-directory=.maestro',
  'ls /tmp/*.txt | xargs cp -t docs/x',
  'ls /tmp/*.txt | xargs -I{} cp {} docs/',
  `ls /tmp/*.yml | xargs cp -t ${WORKTREE}/.maestro`,
  `ls /tmp/*.yml | xargs -I{} mv {} ${MAIN}/.maestro/`,
];

const ALLOWED_COPY_MOVE: string[] = [
  // A destination outside every worktree, or under node_modules/, holds no project YAML file; a
  // xargs command that is no cp/mv writes nothing.
  'ls /tmp/*.yml | xargs cp -t /tmp/out',
  'ls /tmp/*.yml | xargs -I{} cp {} /tmp/out/',
  'ls /tmp/*.yml | xargs cp -t node_modules/package',
  'ls /tmp/*.yml | xargs -I{} cp {} node_modules/package/',
  `ls /tmp/*.yml | xargs cp -t ${OTHER}/docs`,
  'ls /tmp/*.yml | xargs cat',
  'ls /tmp/*.yml | xargs grep appId',
  "find src -name '*.snap' | xargs cp -t /tmp/snaps",
  'ls src/*.ts | xargs -I{} cp {} /tmp/backup/',
  'ls src/*.ts | xargs -I {} mv {} /tmp/backup/',
  'ls src/*.ts | xargs -J % cp % /tmp/backup/',
  'ls src/*.ts | xargs -i cp {} /tmp/backup/',
  'ls src/*.ts | xargs --rep=R cp R /tmp/backup/',
  'ls src/*.ts | xargs mv --target-directory=/tmp/backup',
  'cp src/a.ts /tmp/',
  'mv src/a.ts /tmp/a.ts',
  'git mv src/a.ts src/b/a.ts',
  `cp x.ts ${OTHER}/src/`,
  `cp x.ts ${PLAIN}/src/`,
  'cp -S src /tmp/x.ts /tmp/y/',
  'cp src/a.ts',
  'cp -r src /tmp/backup',
  'cp /tmp/a /tmp/b',
  'cp -r /tmp/x /tmp/y',
  'cp -r /tmp/srcx .',
  'cp -r /tmp/x ./docs/src',
  `cp -r /tmp/x ${OTHER}/src`,
  // A backup folder outside the project is no tree, whatever name the input
  // carries.
  'ls | xargs -I{} cp {} /tmp/bk/src/',
  'ls | xargs -I % cp % /tmp/bk/src/',
  'ls | xargs -I{} cp -r {} /tmp/bk/',
  'ls | xargs cp -r -t /tmp/bk/src',
  // A plain cp cannot copy a folder, so an unresolved destination holds only
  // plain files.
  'ls *.log | xargs -I{} cp {} "$TMPDIR"/logs/',
  'ls | xargs -I{} cp {} "$BK"/',
  'ls | xargs cp -t "$BK"',
  'cd "$X" && ls | xargs -I{} cp {} bk/',
  'ls | xargs -I{} cp {} "$(mktemp -d)"/',
  'ls | xargs -I{} cp {} /tmp/*/',
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
  `python3 -c "from pathlib import Path; Path('src/x.ts').open(encoding='utf8', mode='r')"`,
  `python3 -c "from pathlib import Path; Path('src/x.ts').open('r', encoding='utf8')"`,
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
  "sed -i 's/a/b/' /tmp/src.txt",
];

// e2e/ holds TypeScript the pre-write guard reads like src/.
const DENIED_E2E: string[] = [
  'echo x > e2e/screenshot/seed/demo-text.ts',
  'echo x >> e2e/x.ts',
  "sed -i 's/a/b/' e2e/x.ts",
  'cp /tmp/x.ts e2e/x.ts',
  'mv /tmp/x.ts e2e/',
  'echo x | tee e2e/x.ts',
  `python3 -c "open('e2e/screenshot/seed/demo-text.ts', 'w').write('x')"`,
  "python3 - <<'EOF'\nfrom pathlib import Path\nPath('e2e/x.ts').write_text('x')\nEOF",
  `echo x > ${WORKTREE}/e2e/x.ts`,
  'cd e2e && echo x > y.ts',
  'echo x > E2E/x.ts',
];

const ALLOWED_E2E: string[] = [
  'cat e2e/x.ts',
  'cat e2e/x.ts > /tmp/out.txt',
  "sed -n '1p' e2e/x.ts",
  "grep -rn seed e2e | sed 's/a/b/' > /tmp/out.txt",
  'git mv e2e/a.ts e2e/b.ts',
  'echo x > /tmp/e2e-like/x.ts',
  "sed -i 's/a/b/' /tmp/e2e.txt",
  'echo x > docs/e2e/x.md',
  `echo x > ${OTHER}/e2e/x.ts`,
  `echo x > ${PLAIN}/e2e/x.ts`,
];

// The repository config holds core.hooksPath, which switches the pre-commit typecheck on, so a
// shell write into `.git/config` (or a worktree's `config.worktree`) is a way to switch it off. A
// path the text cannot resolve that names `.git/config` denies (fail closed).
const DENIED_GIT_CONFIG: string[] = [
  'echo x > .git/config',
  'echo x >> .git/config',
  'echo x >| .git/config',
  'echo x | tee -a .git/config',
  "sed -i '' 's/a/b/' .git/config",
  "sed -i.bak 's/a/b/' .git/config",
  "perl -pi -e 's/a/b/' .git/config",
  'cp /tmp/x .git/config',
  'cp -t .git /tmp/config',
  'cp /tmp/config .git/',
  'mv /tmp/x .git/config',
  'echo x > .git/config.worktree',
  'echo x > .GIT/CONFIG',
  'cd .git && echo x > config',
  'echo x > ./.git/config',
  `echo x >> ${MAIN}/.git/config`,
  `echo x >> ${MAIN}/.git/worktrees/worktree/config.worktree`,
  `echo x > ${WORKTREE}/.git/config`,
  'echo x > ../main/.git/config',
  'echo x > ../main/.git/worktrees/worktree/config.worktree',
  'echo x > /tmp/other/.git/config',
  'echo x > "$D/.git/config"',
  'echo x >> $D/.git/config',
  'echo x | tee -a "$ROOT"/.git/config',
  "sed -i '' 's/a/b/' \"$D/.git/config\"",
  'cp /tmp/x "$D"/.git/config',
  `python3 -c "open('.git/config', 'a').write('x')"`,
  `python3 -c "open('${MAIN}/.git/config', 'w')"`,
  `node -e "require('fs').appendFileSync('.git/config', 'x')"`,
  `node -e "require('fs').writeFileSync('${MAIN}/.git/worktrees/worktree/config.worktree', 'x')"`,
  "python3 - <<'EOF'\nfrom pathlib import Path\nPath('.git/config').write_text('x')\nEOF",
  'bash -c "echo x >> .git/config"',
  'true && echo x > .git/config',
];

const ALLOWED_GIT_CONFIG: string[] = [
  'cat .git/config',
  'cat .git/config > /tmp/config.bak',
  'git config --get core.hooksPath',
  'git config user.name x',
  'echo x > /tmp/x/config',
  'echo x > config',
  'echo x > .github/config',
  'echo x > .gitignore',
  'echo x > docs/.git-notes/config',
  'echo x > .git/info/exclude',
  'echo x >> .git/COMMIT_EDITMSG',
  'cp .git/config /tmp/config.bak',
  'cp .git/config /tmp/snap/',
  'mv .git/config.bak /tmp/config.bak',
  "sed -n '1p' .git/config",
  'grep hooksPath .git/config',
  'echo x > "$D/config"',
  'echo x > "$D/gitconfig"',
  `python3 -c "print(open('.git/config').read())"`,
  `python3 -c "open('/tmp/x', 'w').write(open('.git/config').read())"`,
  'echo ".git/config" > /tmp/names.txt',
  `echo x > ${MAIN}/.gitconfig`,
];

// A variable the SAME command assigns (`f=<path>`, `export f=`, `declare f=`, `local f=`) is
// resolved where `$f` or `${f}` is used, so a write through it is judged by its path; a later
// reassignment wins. The first row is a `sed -i` on a path held in a variable, which the text
// alone does not reveal as a write into `src/`.
const DENIED_SAME_COMMAND_VARIABLE: string[] = [
  `f=src/navigation/title-measurer/title-measurer.component.test.tsx && sed -i '' "s/a/b/g" $f && sed -i '' "s|^const LINE_HEIGHT = |x|" $f && ./node_modules/.bin/biome check --write $f`,
  `f=src/x.ts; sed -i '' 's/a/b/' "$f"`,
  `f=src/x.ts; sed -i 's/a/b/' \${f}`,
  `f=src/x.ts; sed -i '' 's/a/b/' "\${f}"`,
  `f=src/x.ts; sed -i '' 's/a/b/' $f.bak`,
  `export f=src/x.ts && sed -i '' 's/a/b/' $f`,
  `declare f=src/x.ts; sed -i '' 's/a/b/' $f`,
  `declare -x f=src/x.ts; sed -i '' 's/a/b/' $f`,
  `local f=src/x.ts; sed -i '' 's/a/b/' $f`,
  `typeset f=src/x.ts; sed -i '' 's/a/b/' $f`,
  `readonly f=src/x.ts; sed -i '' 's/a/b/' $f`,
  `g=1 f=src/x.ts; sed -i '' 's/a/b/' $f`,
  'f=src/x.ts; echo x > $f',
  'f=src/x.ts; echo x >> "$f"',
  'f=src/x.ts; echo x | tee $f',
  'f=src/x.ts; echo x | tee -a "$f"',
  'f=src/x.ts; cp /tmp/a $f',
  'f=src/x.ts; mv /tmp/a "$f"',
  `f=src/x.ts; perl -pi -e 's/a/b/' $f`,
  `f=__tests__/x.test.ts; sed -i '' 's/a/b/' $f`,
  `f=rules/x.yml; sed -i '' 's/a/b/' $f`,
  `f=e2e/x.ts; sed -i '' 's/a/b/' $f`,
  `f=${MAIN}/src/x.ts; sed -i '' 's/a/b/' $f`,
  `f=${WORKTREE}/src/x.ts; sed -i '' 's/a/b/' $f`,
  `f=/tmp/a; f=src/x.ts; sed -i '' 's/a/b/' $f`,
  `d=src; f=$d/x.ts; sed -i '' 's/a/b/' $f`,
  `d=src; sed -i '' 's/a/b/' $d/x.ts`,
  `d=src; sed -i '' 's/a/b/' "$d"/x.ts`,
  'd=src; cp /tmp/a $d/y.ts',
  'd=src; cp -r /tmp/a $d',
  `f=src/x.ts && python3 -c "open('$f', 'w').write('x')"`,
  `f=src/x.ts; node -e "require('fs').writeFileSync('$f', 'x')"`,
  `cd src && f=x.ts && sed -i '' 's/a/b/' $f`,
  `f=x.ts; cd src && sed -i '' 's/a/b/' $f`,
  `f=src/x.ts; true && sed -i '' 's/a/b/' $f`,
  `f=src/x.ts\nsed -i '' 's/a/b/' $f`,
  `f=src/x.ts; (sed -i '' 's/a/b/' $f)`,
  `f=src/x.ts; echo $(sed -i '' 's/a/b/' $f)`,
  `f=src/x.ts; bash -c "sed -i '' s/a/b/ $f"`,
  `export f=src/x.ts; bash -c 'sed -i "" s/a/b/ $f'`,
  `f=src/x.ts; eval "sed -i '' s/a/b/ $f"`,
  `f=src/x.ts; ls src/*.ts | xargs sed -i '' 's/a/b/'`,
  `f=src/x.ts; for g in a; do sed -i '' 's/a/b/' $f; done`,
];

// The command's own assignments only ADD denies. A path that still names a guarded folder through
// an unresolved `$D` denies, whatever the command assigned to `D` first: a loop variable, `read`,
// `+=`, `eval`, `printf -v`, `select`, and `unset` all change it unseen.
const DENIED_WHATEVER_THE_VARIABLE_HOLDS: string[] = [
  `D=/tmp; sed -i '' s/a/b/ $D/src/x.ts`,
  `D=/tmp; sed -i '' s/a/b/ "\${D}/src/x.ts"`,
  'D=/tmp; echo x > $D/src/x.ts',
  'D=/tmp; echo x | tee "$D/src/x.ts"',
  `D=/tmp; for D in .; do sed -i '' s/a/b/ $D/src/x.ts; done`,
  `D=/tmp; read D <<< .; sed -i '' s/a/b/ $D/src/x.ts`,
  `D=/tmp; D+=x; sed -i '' s/a/b/ $D/src/x.ts`,
  `D=/tmp; eval D=.; sed -i '' s/a/b/ $D/src/x.ts`,
  `D=/tmp; printf -v D %s .; sed -i '' s/a/b/ $D/src/x.ts`,
  `D=/tmp; select D in .; do break; done; sed -i '' s/a/b/ $D/src/x.ts`,
  `D=/tmp; unset D; sed -i '' s/a/b/ $D/src/x.ts`,
];

const ALLOWED_SAME_COMMAND_VARIABLE: string[] = [
  `f=/tmp/x.ts; sed -i '' 's/a/b/' $f`,
  `f=docs/x.md; sed -i '' 's/a/b/' "$f"`,
  'f=/tmp/out.txt; echo x | tee $f',
  'f=/tmp/a; cp /tmp/b $f',
  `f=src/x.ts; f=/tmp/a; sed -i '' 's/a/b/' $f`,
  `f=src/x.ts; sed -n 1p $f`,
  'f=src/x.ts; cat $f',
  'f=src/x.ts; grep a "$f"',
  `f=src/x.ts; sed 's/a/b/' $f > /tmp/out.txt`,
  'f=src/x.ts; cp $f /tmp/backup.ts',
  'f=src/x.ts; mv "$f" /tmp/x.ts',
  'f=src/x.ts; ./node_modules/.bin/biome check --write $f',
  'f=src/x.ts; npx biome check --write $f',
  'f=src/x.ts',
  'f=src/x.ts; echo $f',
  `f=src/x.ts g=1 true; sed -i '' 's/a/b/' $f`,
  `g=src/x.ts; sed -i '' 's/a/b/' $f`,
  `f=src/x.ts; sed -i '' 's/a/b/' "$other"`,
  `f=src/x.ts; echo "sed -i '' s/a/b/ $f"`,
  `f=/tmp/x.ts; python3 -c "open('$f', 'w').write('x')"`,
  `d=/tmp; cd $d && sed -i '' 's/a/b/' x.txt`,
  `d=src; f=/tmp/$d.ts; sed -i '' 's/a/b/' $f`,
  `(f=src/x.ts); echo done`,
];

// drizzle/ holds the shipped SQL migrations and their journal; the pre-write guard sees no shell
// write into it, so it is guarded like the trees above. The files are the real case: a migration
// and the journal that lists it.
const MIGRATION_FILES = [
  'drizzle/migrations/0059_usdt_scale_8.sql',
  'drizzle/migrations/meta/_journal.json',
];

const WRITE_TEMPLATES: Array<(file: string) => string> = [
  (file) => `sed -i '' 's/a/b/' ${file}`,
  (file) => `echo x > ${file}`,
  (file) => `echo x >> ${file}`,
  (file) => `echo x | tee ${file}`,
  (file) => `cp /tmp/x ${file}`,
  (file) => `mv /tmp/x ${file}`,
  (file) => `python3 - <<'EOF'\nopen('${file}', 'w').write('x')\nEOF`,
  (file) => `node -e "require('fs').writeFileSync('${file}', 'x')"`,
];

const DENIED_DRIZZLE: string[] = MIGRATION_FILES.flatMap((file) =>
  [file, `${WORKTREE}/${file}`].flatMap((target) =>
    WRITE_TEMPLATES.map((template) => template(target)),
  ),
);

const ALLOWED_DRIZZLE: string[] = [
  ...MIGRATION_FILES.flatMap((file) => [
    `cat ${file}`,
    `grep -n usdt ${file}`,
    `git mv ${file} ${file}.old`,
  ]),
  'npx drizzle-kit generate',
  ...['docs/drizzle', '/tmp/drizzle', `${OTHER}/drizzle`, `${PLAIN}/drizzle`].map(
    (folder) => `echo x > ${folder}/migrations/0059_usdt_scale_8.sql`,
  ),
];

// scripts/ and githooks/ hold the harness shell and JavaScript; Edit/Write runs the fast tier on
// them, a Bash write skips it, and guard-replay replays only .ts/.tsx, so they are guarded like
// the trees above (worktree-root folders, resolved in any worktree of this repository).
const SCRIPT_AND_HOOK_FILES = ['scripts/checks/x.sh', 'scripts/x.js', 'githooks/pre-commit'];

const DIRECT_WRITE_TEMPLATES: Array<(file: string) => string> = [
  ...WRITE_TEMPLATES,
  (file) => `perl -pi -e 's/a/b/' ${file}`,
  (file) => `echo x >| ${file}`,
  (file) => `python3 -c "open('${file}', 'w').write('x')"`,
];

// An `xargs sed -i` is denied whatever its target, as the DENIED_NESTED rows show, so only a
// denied list may use these.
const XARGS_WRITE_TEMPLATES: Array<(file: string) => string> = [
  (file) => `echo ${file} | xargs sed -i '' 's/a/b/'`,
  (file) => `echo x | xargs sed -i '' 's/a/b/' ${file}`,
];

const ALL_WRITE_TEMPLATES = [...DIRECT_WRITE_TEMPLATES, ...XARGS_WRITE_TEMPLATES];

const DENIED_SCRIPTS_AND_GITHOOKS: string[] = [
  ...SCRIPT_AND_HOOK_FILES.flatMap((file) =>
    [file, `${MAIN}/${file}`, `${WORKTREE}/${file}`].flatMap((target) =>
      ALL_WRITE_TEMPLATES.map((template) => template(target)),
    ),
  ),
  "cd scripts && sed -i '' 's/a/b/' x.js",
  'cd scripts && echo x > x.js',
  'cd scripts/checks && echo x > x.sh',
  'cd githooks && echo x >> pre-commit',
  'cd scripts && cp /tmp/x .',
  "cd githooks && perl -pi -e 's/a/b/' pre-commit",
  `cd ${WORKTREE}/scripts && echo x | tee x.js`,
  'echo x > "$D/scripts/a.sh"',
  'echo x > "$D/githooks/pre-commit"',
  "sed -i '' 's/a/b/' $D/scripts/checks/x.sh",
  'cp -rT /tmp/x ./scripts',
  'echo x > scripts/out.txt',
  `sed -i 's/a/b/' ${MAIN}/scripts/x.sh`,
  'echo x > scripts/e2e.sh',
  'echo x > scripts/config',
  'f=scripts/out.txt; echo x > $f',
  'f=scripts/src/out.txt; echo x >> "$f"',
];

const ALLOWED_SCRIPTS_AND_GITHOOKS: string[] = [
  ...SCRIPT_AND_HOOK_FILES.flatMap((file) => [
    `cat ${file}`,
    `grep -n foo ${file}`,
    `sed -n '1,5p' ${file}`,
    `bash ${file}`,
    `bash ${file} > /dev/null 2>&1`,
    `git mv ${file} ${file}.old`,
    `git checkout -- ${file}`,
    `echo x > /tmp/${file}`,
    `./node_modules/.bin/biome check --write ${file}`,
  ]),
  'echo x > /dev/null',
  `echo x > ${OTHER}/scripts/x.sh`,
  `echo x > ${PLAIN}/githooks/pre-commit`,
  'echo x > docs/scripts/x.sh',
];

// .claude/skills/, .claude/agents/ and all of harness/kiko/ (scripts, hooks, skills, agents, the
// plugin manifest) hold the harness itself; they are guarded like the trees above, as a path
// prefix at the root of a worktree of this repository.
const PREFIX_GUARDED_FILES = [
  'harness/kiko/scripts/run-log.mjs',
  'harness/kiko/hooks/dispatch.sh',
  'harness/kiko/hooks/hooks.json',
  'harness/kiko/.claude-plugin/plugin.json',
  'harness/kiko/skills/ops/SKILL.md',
  'harness/kiko/agents/qa.md',
  '.claude/skills/kiko-linter/SKILL.md',
  '.claude/agents/developer.md',
];

const DENIED_PREFIX_GUARDED: string[] = [
  ...PREFIX_GUARDED_FILES.flatMap((file) =>
    [file, `${MAIN}/${file}`, `${WORKTREE}/${file}`].flatMap((target) =>
      ALL_WRITE_TEMPLATES.map((template) => template(target)),
    ),
  ),
  ...['harness/kiko/scripts/a.sh', '.claude/skills/a/SKILL.md', '.claude/agents/a.md'].flatMap(
    (file) => [
      `gcp /tmp/x ${file}`,
      `gmv /tmp/x ${file}`,
      `cp -t ${file.slice(0, file.lastIndexOf('/'))} /tmp/x`,
      `echo x &> ${file}`,
      `echo x >& ${file}`,
      `echo x | sudo tee ${file}`,
      `echo x | tee -a ${file}`,
      `sed --in-place 's/a/b/' ${file}`,
      `perl -pi.bak -e 's/a/b/' ${file}`,
    ],
  ),
  // Case folds as it does for the trees above.
  'echo x > HARNESS/KIKO/scripts/a.sh',
  'echo x > Harness/Kiko/hooks/hooks.json',
  'echo x > .CLAUDE/skills/a.md',
  'echo x > .claude/AGENTS/a.md',
  "sed -i 's/a/b/' HARNESS/kiko/hooks/dispatch.sh",
  // A destination that is a prefix folder itself, or a folder inside it.
  'cp x harness/kiko/',
  'cp x harness/kiko',
  'cp x harness/kiko/hooks',
  'cp x harness/kiko/scripts/',
  'cp x .claude/skills',
  'mv x .claude/skills/',
  'mv x .claude/agents',
  'mv x .claude/agents/',
  'cp -r /tmp/dir harness/kiko/',
  'cp -r /tmp/dir .claude/skills/',
  'cp -t harness/kiko/scripts x',
  'cp -t harness/kiko x',
  'cp -t .claude/skills x',
  'mv -vt .claude/agents a.md',
  'cp --target-directory=harness/kiko/hooks x',
  'cp --target-directory .claude/skills x',
  'cp -rT /tmp/x harness/kiko',
  'cp -Tr /tmp/x .claude/skills',
  'mv -T /tmp/x .claude/agents',
  'cp --no-target-directory /tmp/x harness/kiko',
  `cp x ${MAIN}/harness/kiko/`,
  `cp x ${WORKTREE}/harness/kiko/hooks`,
  `mv x ${MAIN}/.claude/skills/`,
  `cp -t ${WORKTREE}/.claude/agents x`,
  // A source named after the prefix's last segment lands inside it when the destination is its
  // parent folder.
  'cp -r /tmp/kiko harness/',
  'cp -a /tmp/kiko harness',
  'mv /tmp/skills .claude/',
  'cp -r /tmp/agents .claude',
  `cp -r /tmp/kiko ${MAIN}/harness/`,
  // The same through xargs, whose input names are unknowable: a destination folder inside a
  // prefix, and a recursive copy or a move into the parent of one.
  'ls /tmp/*.sh | xargs cp -t harness/kiko/scripts',
  'ls /tmp/*.sh | xargs cp -t harness/kiko/scripts/',
  'ls /tmp/*.md | xargs mv --target-directory=.claude/skills',
  'ls /tmp/*.md | xargs mv --target-directory=.claude/agents',
  'ls /tmp/*.json | xargs cp -t harness/kiko/.claude-plugin',
  'ls /tmp/*.sh | xargs -I{} cp {} harness/kiko/hooks/',
  'ls /tmp/*.md | xargs -I {} mv {} .claude/skills/',
  'ls /tmp/*.md | xargs -I{} cp {} .claude/agents/',
  'ls /tmp/*.sh | xargs -I{} cp {} harness/kiko/',
  'ls /tmp/*.sh | xargs cp /tmp/a.sh harness/kiko/hooks',
  `ls /tmp/*.sh | xargs cp -t ${MAIN}/harness/kiko/scripts`,
  `ls /tmp/*.md | xargs -I{} mv {} ${WORKTREE}/.claude/skills/`,
  `ls /tmp/*.md | xargs mv --target-directory=${MAIN}/.claude/agents`,
  'ls | xargs -I{} cp -r {} harness/',
  'ls | xargs -I{} cp -r {} harness',
  'ls | xargs -I{} cp -r {} .claude/',
  'ls | xargs -I{} cp -R {} .claude',
  'ls | xargs -I{} mv {} harness/',
  'ls | xargs -I{} mv {} .claude/',
  'ls /tmp/snap | xargs cp -r -t harness',
  'ls /tmp/snap | xargs cp -r -t .claude',
  `ls | xargs -I{} cp -r {} ${MAIN}/harness/`,
  `ls | xargs -I{} mv {} ${WORKTREE}/.claude/`,
  // A folder change into a prefix, or into the folder above it, judges the relative write after.
  'cd harness/kiko && echo x > a.sh',
  'cd harness/kiko && echo x >> a.sh',
  'cd harness/kiko/hooks && echo x > hooks.json',
  "cd harness/kiko/hooks && sed -i '' 's/a/b/' hooks.json",
  'cd harness/kiko/scripts && cp /tmp/x .',
  'cd harness/kiko && cp /tmp/x .',
  'cd harness/kiko && echo x | tee a.sh',
  'cd harness/kiko && cp -r /tmp/x hooks',
  'cd .claude/skills && echo x > a.md',
  'cd .claude/agents && cp /tmp/x qa.md',
  'cd .claude/skills && cp /tmp/x .',
  'cd .claude && echo x > skills/a.md',
  'cd .claude && echo x > agents/a.md',
  'cd .claude && cp /tmp/x skills/a.md',
  'cd .claude && cp -r /tmp/x skills',
  'cd harness && cp a kiko/b',
  'cd harness && echo x > kiko/a.sh',
  "cd harness && sed -i '' 's/a/b/' kiko/hooks/hooks.json",
  'cd harness && cp -r /tmp/x kiko',
  'cd harness && cp -r /tmp/kiko .',
  'cd harness && mv /tmp/kiko .',
  'cd .claude && cp -r /tmp/skills .',
  'pushd harness/kiko && echo x > a.sh',
  'pushd .claude && echo x > skills/a.md',
  'pushd harness && cp a kiko/b',
  'pushd .claude/skills && echo x > a.md',
  `cd ${WORKTREE}/harness/kiko && echo x | tee a.sh`,
  `cd ${MAIN}/.claude && echo x > agents/a.md`,
  `cd ${MAIN}/harness && cp a kiko/b`,
  '(cd harness/kiko && echo x > a.sh)',
  'cd harness && (cd kiko && echo x > a.sh)',
  // A variable the same command assigns, whole or as the folder in front of the rest.
  'D=harness/kiko; echo x > $D/a',
  'D=harness/kiko; echo x > "$D/a.sh"',
  'D=harness; echo x > $D/kiko/a.sh',
  'D=.claude/skills; cp /tmp/a $D/x.md',
  'D=.claude/agents; mv /tmp/a "$D/x.md"',
  'D=.claude; echo x > $D/agents/qa.md',
  'D=.claude; echo x > $D/skills/a/SKILL.md',
  'D=harness/kiko; cp /tmp/a $D',
  'D=harness/kiko; cp -r /tmp/a $D/',
  `f=harness/kiko/hooks/hooks.json; sed -i '' 's/a/b/' $f`,
  'f=harness/kiko/scripts/x.mjs; echo x >> "$f"',
  'f=.claude/skills/a/SKILL.md; echo x | tee $f',
  'f=.claude/agents/a.md; echo x > $f',
  'f=harness/kiko/hooks/dispatch.sh; cp /tmp/a $f',
  `f=${MAIN}/harness/kiko/skills/ops/SKILL.md; sed -i '' 's/a/b/' $f`,
  `f=${WORKTREE}/.claude/skills/a.md; echo x > $f`,
  `f=harness/kiko/scripts/a.mjs; node -e "require('fs').writeFileSync('$f', 'x')"`,
  `f=.claude/skills/a.md; python3 -c "open('$f', 'w').write('x')"`,
  'f=harness/kiko/a.sh; true && echo x > $f',
  'cd harness/kiko && f=a.sh && echo x > $f',
  'f=a.sh; cd harness/kiko && echo x > $f',
  // A path the text cannot resolve still names the prefix, whatever the command assigned.
  'echo x > $X/harness/kiko/a',
  'echo x > "$X/harness/kiko/a"',
  'echo x > ~/w/.claude/skills/a',
  'echo x > $X/.claude/agents/a',
  'echo x > "$X/.claude/skills/a/SKILL.md"',
  "sed -i '' 's/a/b/' $D/harness/kiko/skills/ops/SKILL.md",
  'cp /tmp/x $D/.claude/skills/a.md',
  'echo x | tee $D/harness/kiko/hooks/hooks.json',
  `echo x > \${X}/harness/kiko/a`,
  'echo x > $(pwd)/.claude/agents/a',
  'D=/tmp; echo x > $D/harness/kiko/a',
  'D=/tmp; echo x > $D/.claude/skills/a',
  'D=/tmp; echo x | tee "$D/.claude/agents/a.md"',
  `D=/tmp; sed -i '' s/a/b/ $D/harness/kiko/hooks/hooks.json`,
  `D=/tmp; for D in .; do echo x > $D/harness/kiko/a; done`,
  `D=/tmp; unset D; echo x > $D/.claude/skills/a`,
  // Interpreters, certain and possible.
  `python3 -c "open('harness/kiko/scripts/a.mjs','w').write('x')"`,
  `python3 -c "open('harness/kiko/hooks/hooks.json', 'a').write('x')"`,
  `python3 -c "open('.claude/skills/a/SKILL.md', mode='w')"`,
  `python3 -c "open('${MAIN}/.claude/agents/a.md', 'w')"`,
  `python3 -c "open('${WORKTREE}/harness/kiko/.claude-plugin/plugin.json', 'w')"`,
  `python3 -c "from pathlib import Path; Path('harness/kiko/skills/ops/SKILL.md').write_text('x')"`,
  `python3 -c "from pathlib import Path; Path('.claude/skills/a.md').open(mode='w')"`,
  `python3 -c "p = '/tmp/x'; open(p, 'w').write(open('harness/kiko/hooks/a.sh').read())"`,
  `python3 -c "p = '/tmp/x'; open(p, 'w').write(open('.claude/skills/a.md').read())"`,
  `python3 -c "import sys; open(sys.argv[1], 'w').write('x')" harness/kiko/scripts/a.mjs`,
  `python3 -c "open(f'harness/kiko/hooks/{name}.sh', 'w')"`,
  `python3 -c "import os; open(os.path.join('.claude', 'skills', 'a.md'), 'w')"`,
  `python3 -c "root = '/tmp'; open(root + '/harness/kiko/hooks/a.sh', 'w')"`,
  `python3 -c "open('.claude/agents/{}.md'.format(name), 'w')"`,
  "python3 - <<'EOF'\nopen('harness/kiko/scripts/a.mjs', 'w').write('x')\nEOF",
  "python3 - <<'EOF'\nfrom pathlib import Path\nfor name in ['harness/kiko/hooks/a.sh']:\n    Path(name).write_text('x')\nEOF",
  "python3 - <<'EOF'\nfrom pathlib import Path\nPath('.claude/skills/a.md').open('w').write('x')\nEOF",
  `python3 <<< "open('.claude/agents/a.md', 'w').write('x')"`,
  "cd harness/kiko && python3 - <<'EOF'\nopen('a.sh', 'w').write('x')\nEOF",
  `node -e "require('fs').writeFileSync('.claude/skills/a/SKILL.md', 'x')"`,
  `node -e "fs.writeFileSync('harness/kiko/scripts/a.mjs', 'x')"`,
  `node -e "require('fs').appendFileSync('harness/kiko/hooks/hooks.json', 'x')"`,
  `node -e "require('fs').promises.writeFile('.claude/agents/a.md', 'x')"`,
  `node --eval="fs.writeFileSync('harness/kiko/skills/a.md', 'x')"`,
  `node -e "require('fs').createWriteStream('harness/kiko/scripts/a.mjs')"`,
  `node -e "require('fs').writeFileSync(process.argv[1], 'x')" .claude/skills/a.md`,
  `node -e "require('fs').writeFileSync(process.cwd() + '/harness/kiko/a.sh', 'x')"`,
  `node -e 'require("fs").writeFileSync(\`.claude/skills/\${name}.md\`, "x")'`,
  `node -e "require('fs').writeFileSync('${MAIN}/harness/kiko/hooks/hooks.json', 'x')"`,
  "node - <<'EOF'\nrequire('fs').writeFileSync('harness/kiko/scripts/a.mjs', 'x')\nEOF",
  "node <<'EOF'\nrequire('fs').writeFileSync('.claude/agents/a.md', 'x')\nEOF",
  `bash -c "echo x > harness/kiko/a.sh"`,
  `sh -c "sed -i 's/a/b/' .claude/skills/a.md"`,
  'eval "echo x > .claude/agents/a.md"',
  'echo $(echo x > harness/kiko/a.sh)',
  'true && echo x > harness/kiko/a.sh',
  "bash <<'EOF'\necho x > .claude/skills/a.md\nEOF",
];

const ALLOWED_PREFIX_GUARDED: string[] = [
  ...[
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.claude/skillsx/a.md',
    '.claude/skill/a.md',
    '.claude/agentsx/a.md',
    '.claude/agent/a.md',
    '.claude/commands/a.md',
    'harness/kikox/a.sh',
    'harness/kiko-x/a.sh',
    'harness/other/a.sh',
    'harness/a.sh',
    'harness/.claude-plugin/marketplace.json',
    'docs/harness/kiko/a.sh',
    'docs/.claude/skills/a.md',
    'docs/.claude/agents/a.md',
    'node_modules/package/harness/kiko/a.sh',
    'node_modules/package/.claude/skills/a.md',
  ].flatMap((file) =>
    [file, `${MAIN}/${file}`, `${WORKTREE}/${file}`].flatMap((target) =>
      DIRECT_WRITE_TEMPLATES.map((template) => template(target)),
    ),
  ),
  ...PREFIX_GUARDED_FILES.flatMap((file) =>
    [`${OTHER}/${file}`, `${PLAIN}/${file}`, `/tmp/${file}`].flatMap((target) =>
      DIRECT_WRITE_TEMPLATES.map((template) => template(target)),
    ),
  ),
  ...PREFIX_GUARDED_FILES.flatMap((file) => [
    `cat ${file}`,
    `grep -n foo ${file}`,
    `sed -n '1,5p' ${file}`,
    `bash ${file}`,
    `bash ${file} > /dev/null 2>&1`,
    `cp ${file} /tmp/x`,
    `cp ${file} /tmp/x/`,
    `mv ${file} /tmp/x`,
    `git mv ${file} ${file}.old`,
    `git checkout -- ${file}`,
    `echo x > /tmp/${file}`,
    `./node_modules/.bin/biome check --write ${file}`,
    `python3 -c "print(open('${file}').read())"`,
    `python3 -c "open('/tmp/x', 'w').write(open('${file}').read())"`,
    `node -e "fs.writeFileSync('/tmp/x', fs.readFileSync('${file}'))"`,
  ]),
  'cat harness/kiko/hooks/hooks.json',
  'grep x .claude/skills/a/SKILL.md',
  'cp harness/kiko/scripts/run-log.mjs /tmp/x',
  'git mv harness/kiko/a.sh harness/kiko/b.sh',
  'git checkout -- harness/kiko/hooks/hooks.json',
  'git checkout -- .claude/skills/a/SKILL.md',
  'cp -r harness/kiko /tmp/backup',
  'cp -r .claude/skills /tmp/backup/',
  'cp -r /tmp/x ./docs/harness/kiko',
  'cp -r /tmp/kiko docs/harness',
  `cp -r /tmp/kiko ${OTHER}/harness/`,
  `cp -r /tmp/skills ${PLAIN}/.claude/`,
  'cp x harness/other',
  'cp x harness/other/',
  'cp x .claude/commands/',
  'cp x .claude/skillsx',
  'cp -t .claude/commands x',
  'cp -t harness/other x',
  'mv x .claude/settings.json',
  'cp -r /tmp/x harness/kikox',
  'cp -r /tmp/kikox harness/',
  'cp -r /tmp/x .claude/skill',
  'ls /tmp/*.md | xargs cp -t /tmp/out/skills',
  'ls /tmp/*.md | xargs mv --target-directory=/tmp/backup',
  `ls /tmp/*.sh | xargs cp -t ${OTHER}/harness/kiko/scripts`,
  `ls /tmp/*.md | xargs -I{} mv {} ${PLAIN}/.claude/skills/`,
  'ls | xargs -I{} cp -r {} /tmp/bk/harness/',
  'ls | xargs -I{} cp -r {} /tmp/bk/.claude/',
  'ls | xargs -I{} cp -r {} /tmp/bk/harness/kiko/',
  'ls harness/kiko | xargs -I{} cp {} /tmp/backup/',
  'ls harness/kiko | xargs cat',
  'ls .claude/skills | xargs grep foo',
  'ls | xargs -I{} cp {} "$BK"/harness/',
  'cd harness && echo x > other/a',
  'cd harness && echo x > /tmp/a',
  'cd harness && cp a other/b',
  'cd harness && cat kiko/hooks/hooks.json',
  'cd .claude && echo x > settings.json',
  'cd .claude && echo x > commands/a.md',
  'cd .claude && cp /tmp/x settings.local.json',
  'cd .claude && cat skills/a.md',
  'cd harness/kiko && cat hooks/hooks.json',
  'cd harness/kiko && echo x > /tmp/a',
  'cd harness/kiko && cp a.sh /tmp/a.sh',
  'cd .claude/skills && grep x a/SKILL.md',
  'cd harness/other && echo x > a',
  'pushd harness && echo x > other/a',
  'pushd .claude && echo x > settings.json',
  `cd ${OTHER} && echo x > harness/kiko/a.sh`,
  `cd ${PLAIN} && echo x > .claude/skills/a.md`,
  `cd ${PLAIN}/harness && cp a kiko/b`,
  'cd docs/harness/kiko && echo x > a.sh',
  'cd docs && echo x > harness/kiko/a.sh',
  'cd /tmp && echo x > harness/kiko/a.sh',
  'D=harness/other; echo x > $D/a',
  'D=harness; echo x > $D/other/a.sh',
  'D=.claude; echo x > $D/settings.json',
  'D=.claude; cp /tmp/x $D/commands/a.md',
  'D=/tmp; echo x > $D/a',
  'f=harness/other/a.sh; echo x > $f',
  'f=.claude/settings.json; echo x > $f',
  'f=.claude/skillsx/a.md; echo x >> "$f"',
  'f=harness/kiko/hooks/hooks.json; cat $f',
  'f=.claude/skills/a.md; grep x "$f"',
  'f=harness/kiko/a.sh; cp $f /tmp/backup.sh',
  'f=harness/kiko/a.sh; f=/tmp/a; echo x > $f',
  `f=${OTHER}/harness/kiko/a.sh; echo x > $f`,
  'D=harness/kiko; cat $D/a',
  'D=harness/kiko; cp $D/a /tmp/a',
  'echo x > $X/harness/other/a',
  'echo x > $X/harness/kikox/a',
  'echo x > $X/.claude/settings.json',
  'echo x > $X/.claude/commands/a.md',
  'echo x > $X/.claude/skillsx/a',
  'echo "x > harness/kiko/a.sh"',
  "echo 'x >> .claude/skills/a.md'",
  `echo ".claude/skills/a.md" > /tmp/names.txt`,
  `python3 -c "open('.claude/settings.json', 'w').write('x')"`,
  `python3 -c "open('harness/other/a.sh', 'w').write('x')"`,
  `node -e "require('fs').writeFileSync('.claude/commands/a.md', 'x')"`,
  `node -e "require('fs').writeFileSync('harness/kikox/a.sh', 'x')"`,
  `python3 -c "open('${OTHER}/harness/kiko/a.sh', 'w').write('x')"`,
  `node -e "require('fs').writeFileSync('${PLAIN}/.claude/skills/a.md', 'x')"`,
  "python3 - <<'EOF'\nopen('/tmp/out.txt', 'w').write(open('harness/kiko/a.sh').read())\nEOF",
  "node - <<'EOF'\nconsole.log(require('fs').readFileSync('.claude/skills/a.md', 'utf8'))\nEOF",
];

const DENIED_YAML: string[] = [
  ...[
    '.maestro/flow.yaml',
    'docs/x/config.yml',
    `${MAIN}/.maestro/flow.yaml`,
    `${WORKTREE}/.maestro/a.YML`,
    '.maestro/a.Yaml',
    '$D/a.yaml',
    '"$D"/b.yml',
    'root.yml',
    `${MAIN}/root.yaml`,
    `${WORKTREE}/root.YML`,
  ].flatMap((file) => ALL_WRITE_TEMPLATES.map((template) => template(file))),
  'echo x > "$D/a.yaml"',
  'cp a.yml .maestro/',
  'mv a.yml .maestro/',
  'cp -t .maestro a.yml',
  'cp --target-directory=docs/x a.yaml',
  `cp a.yml ${MAIN}/.maestro/`,
  'cd .maestro && echo x > flow.yaml',
  'cd docs/x && sed -i "" s/a/b/ config.yml',
  'f=.maestro/flow.yaml; sed -i "" s/a/b/ $f',
  `f=${MAIN}/docs/x/config.yml; echo x >> $f`,
];

const ALLOWED_YAML: string[] = [
  ...[
    '/tmp/x.yml',
    '/tmp/x/config.yaml',
    '/private/tmp/claude-501/-project/session/scratchpad/x.yml',
    `${SCRATCH}/notes/x.yaml`,
    `${OTHER}/a.yml`,
    `${PLAIN}/a.yaml`,
    `${MAIN}/node_modules/package/x.yml`,
    'node_modules/package/x.yml',
    './node_modules/package/deep/x.YAML',
  ].flatMap((file) => DIRECT_WRITE_TEMPLATES.map((template) => template(file))),
  'cat .maestro/flow.yaml',
  'grep -n appId .maestro/flow.yaml',
  "sed -n '1,5p' docs/x/config.yml",
  'cat .maestro/flow.yaml > /tmp/flow.yaml',
  'cp .maestro/flow.yaml /tmp/flow.yaml',
  'git mv .maestro/a.yaml .maestro/b.yaml',
  'npx prettier --write .maestro/flow.yaml',
  'echo x > notes.yml.txt',
  'echo x > .maestro/notes.yml.txt',
  'echo x > docs/x/config.yamlx',
  'echo x > docs/x/yml',
  'echo x > docs/x/config.yml/readme.md',
];

describe('kill-guard shell-write deny (parser only, fake repository)', () => {
  it.each(DENIED_SCRIPTS_AND_GITHOOKS)(
    'denies a write into scripts/ or githooks/: %s',
    (command) => {
      expect(decideInMain(command)).toBe('shellWrite');
    },
  );

  it.each(ALLOWED_SCRIPTS_AND_GITHOOKS)(
    'allows a read of scripts/ or githooks/, or a write outside them: %s',
    (command) => {
      expect(decideInMain(command)).toBe('allow');
    },
  );

  it.each(DENIED_PREFIX_GUARDED)(
    'denies a write into .claude/skills/, .claude/agents/ or harness/kiko/: %s',
    (command) => {
      expect(decideInMain(command)).toBe('shellWrite');
    },
  );

  it.each(ALLOWED_PREFIX_GUARDED)(
    'allows a read of those prefixes, or a write beside them or outside the project: %s',
    (command) => {
      expect(decideInMain(command)).toBe('allow');
    },
  );

  it('judges a prefix write from a linked worktree, a prefix folder and a cwd outside the project', () => {
    expect(decide('echo x > a.sh', { cwd: join(MAIN, 'harness/kiko/hooks') })).toBe('shellWrite');
    expect(decide('echo x > a.md', { cwd: join(WORKTREE, '.claude/skills') })).toBe('shellWrite');
    expect(decide('echo x > kiko/a.sh', { cwd: join(MAIN, 'harness') })).toBe('shellWrite');
    expect(decide('echo x > agents/a.md', { cwd: join(WORKTREE, '.claude') })).toBe('shellWrite');
    expect(decide('echo x > harness/kiko/a.sh', { cwd: WORKTREE })).toBe('shellWrite');
    expect(decide('echo x > harness/kiko/a.sh', { cwd: OTHER })).toBe('allow');
    expect(decide('echo x > .claude/skills/a.md', { cwd: PLAIN })).toBe('allow');
    expect(decide('echo x > a.json', { cwd: join(MAIN, '.claude') })).toBe('allow');
    expect(decide('echo x > a.sh', { cwd: join(MAIN, 'harness/other') })).toBe('allow');
    expect(decide('echo x > a.sh', { cwd: join(MAIN, 'docs/harness/kiko') })).toBe('allow');
  });

  it('names the prefix file in DETAILS', () => {
    expect(detailOf('echo x > harness/kiko/hooks/a.sh')).toContain(
      `(writes ${MAIN}/harness/kiko/hooks/a.sh)`,
    );
    expect(detailOf('cp /tmp/x .claude/skills/')).toContain(`(writes ${MAIN}/.claude/skills/`);
  });

  it.each(DENIED_YAML)('denies a write into a YAML file: %s', (command) => {
    expect(decideInMain(command)).toBe('shellWrite');
  });

  it.each(ALLOWED_YAML)(
    'allows a read of a YAML file, or a write outside the project or under node_modules: %s',
    (command) => {
      expect(decideInMain(command)).toBe('allow');
    },
  );

  it('judges a YAML write from a linked worktree and a cwd outside the project', () => {
    expect(decide('echo x > a.yml', { cwd: join(WORKTREE, '.maestro') })).toBe('shellWrite');
    expect(decide('echo x > a.yml', { cwd: join(MAIN, 'node_modules/package') })).toBe('allow');
    expect(decide('echo x > a.yml', { cwd: OTHER })).toBe('allow');
    expect(decide('echo x > scripts/a.sh', { cwd: WORKTREE })).toBe('shellWrite');
    expect(decide('echo x > scripts/a.sh', { cwd: OTHER })).toBe('allow');
  });

  it.each(DENIED_DRIZZLE)('denies a write into drizzle/: %s', (command) => {
    expect(decideInMain(command)).toBe('shellWrite');
  });

  it.each(ALLOWED_DRIZZLE)('allows a read of drizzle/ or a write outside it: %s', (command) => {
    expect(decideInMain(command)).toBe('allow');
  });

  it.each(DENIED_SAME_COMMAND_VARIABLE)(
    'denies a write through a variable the command assigns: %s',
    (command) => {
      expect(decideInMain(command)).toBe('shellWrite');
    },
  );

  it.each(ALLOWED_SAME_COMMAND_VARIABLE)(
    'allows a variable that points outside the trees, or a read: %s',
    (command) => {
      expect(decideInMain(command)).toBe('allow');
    },
  );

  it.each(DENIED_WHATEVER_THE_VARIABLE_HOLDS)(
    'denies a guarded folder behind an unresolved variable the command also assigns: %s',
    (command) => {
      expect(decideInMain(command)).toBe('shellWrite');
    },
  );

  it('names the resolved file in DETAILS', () => {
    expect(detailOf(`f=src/x.ts; sed -i '' s/a/b/ $f`)).toContain(`(writes ${MAIN}/src/x.ts)`);
  });

  it.each(DENIED_GIT_CONFIG)('denies a write into a git config file: %s', (command) => {
    expect(decideInMain(command)).toBe('shellWrite');
  });

  it.each(ALLOWED_GIT_CONFIG)(
    'allows a read of a git config file or another path: %s',
    (command) => {
      expect(decideInMain(command)).toBe('allow');
    },
  );

  it('judges a linked worktree and a path with no known directory the same way', () => {
    expect(decide('echo x >> ../main/.git/config', { cwd: WORKTREE })).toBe('shellWrite');
    expect(decide('echo x >> .git/config', { cwd: PLAIN })).toBe('shellWrite');
    expect(decide('echo x >> .git/config')).toBe('shellWrite');
    expect(decide('echo x >> /tmp/x/config')).toBe('allow');
  });

  it('names the config file in DETAILS', () => {
    expect(detailOf('echo x >> .git/config')).toContain(`(writes ${MAIN}/.git/config)`);
  });

  it.each(DENIED_E2E)('denies a write into e2e/: %s', (command) => {
    expect(decideInMain(command)).toBe('shellWrite');
  });

  it.each(ALLOWED_E2E)('allows a read of e2e/ or a write outside the trees: %s', (command) => {
    expect(decideInMain(command)).toBe('allow');
  });

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
    expect(decide('echo x > x.ts', { cwd: join(MAIN, 'scripts') })).toBe('shellWrite');
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
    ['cp -r /tmp/backup/src .', `(writes ${MAIN}/src)`],
    ['cp -a /tmp/snap/. src/', `(writes ${MAIN}/src)`],
  ])('names the file in DETAILS: %s', (command, detail) => {
    expect(detailOf(command)).toContain(detail);
  });

  it('judges 3000 write calls through a variable well inside the hook timeout', () => {
    const command = `node -e "${"fs.writeFileSync(p, 'x');".repeat(3000)}"`;
    const started = Date.now();

    expect(decideInMain(command)).toBe('allow');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  // Copying every earlier assignment per assignment would take seconds of the hook's 10 for 10000.
  it('judges thousands of assignments and plain commands well inside the hook timeout', () => {
    const assignments = Array.from({ length: 10000 }, (_, index) => `v${index}=/tmp/x`).join('; ');
    const plain = Array.from({ length: 6000 }, () => 'echo a').join('; ');
    const command = `f=src/x.ts; ${assignments}; ${plain}; sed -i '' s/a/b/ $f`;
    const started = Date.now();

    expect(decideInMain(command)).toBe('shellWrite');
    expect(Date.now() - started).toBeLessThan(1500);
  });

  // A command that doubles a variable 31 times would build a string past the engine's limit, and
  // the throw must not turn the whole decision into an allow.
  it('judges a command that doubles a variable past any size', () => {
    const doublings = Array.from({ length: 31 }, () => 'v=$v$v').join('; ');

    expect(decideInMain(`v=ab; ${doublings}; pkill node`)).toBe('kill');
    expect(decideInMain(`v=ab; ${doublings}; echo x > $v`)).toBe('allow');
  });

  it('reads a variable value of at most 4 KiB and a longer one as unknown', () => {
    const near = `src/${'a'.repeat(4000)}.ts`;
    const far = `src/${'a'.repeat(5000)}.ts`;

    expect(decideInMain(`f=${near}; sed -i '' s/a/b/ $f`)).toBe('shellWrite');
    expect(decideInMain(`f=${far}; sed -i '' s/a/b/ $f`)).toBe('allow');
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

  it('names scripts/, githooks/ and YAML in the deny text', () => {
    const result = run(payloadIn(REPOSITORY_ROOT, 'echo x > scripts/checks/x.sh'));
    const reason: string = JSON.parse(result.stdout.trim()).hookSpecificOutput
      .permissionDecisionReason;

    expect(reason).toContain('scripts/');
    expect(reason).toContain('githooks/');
    expect(reason).toContain('YAML');
    expect(reason).toContain(
      'into src/, __tests__/, rules/, e2e/, drizzle/, scripts/, or githooks/',
    );
    expect(reason).toContain('into a YAML file (.yml, .yaml)');
  });

  it('names .claude/skills/, .claude/agents/ and harness/kiko/ in the deny text', () => {
    const result = run(payloadIn(REPOSITORY_ROOT, 'echo x > harness/kiko/hooks/hooks.json'));
    const reason: string = JSON.parse(result.stdout.trim()).hookSpecificOutput
      .permissionDecisionReason;

    expect(JSON.parse(result.stdout.trim()).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(reason).toContain('.claude/skills/');
    expect(reason).toContain('.claude/agents/');
    expect(reason).toContain('harness/kiko/');
  });

  it('keeps the allowed scope and the fix hint true for a YAML or xargs deny', () => {
    const result = run(payloadIn(REPOSITORY_ROOT, 'echo x > .maestro/flow.yaml'));
    const reason: string = JSON.parse(result.stdout.trim()).hookSpecificOutput
      .permissionDecisionReason;

    expect(reason).toContain('not a YAML file of a worktree');
    expect(reason).toContain('write the literal path, or use Edit or Write');
    expect(reason).not.toContain('use another folder name');
    expect(reason).not.toContain('outside the worktrees');
  });

  it('denies a write into .git/config and names ensure-git-hooks.sh', () => {
    const result = run(payloadIn(REPOSITORY_ROOT, 'echo x >> .git/config'));

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    const reason: string = parsed.hookSpecificOutput.permissionDecisionReason;
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(BLOCK_LABELS.filter((label) => !reason.includes(label))).toEqual([]);
    expect(reason).toContain(join(REPOSITORY_ROOT, '.git/config'));
    expect(reason).toContain('bash scripts/ensure-git-hooks.sh');
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
