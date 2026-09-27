#!/usr/bin/env node

// The pre-write guard (pre-write-guard.sh/.js) sees only an Edit, Write, or
// MultiEdit. A Bash or python write, or a commit of one, reaches disk without
// it. This replays the SAME guard on the Stop tier, once per changed .ts/.tsx
// file, as a Write whose on-disk BEFORE is the file as it was before the
// session changed it. The guard's own new-finding diff, override handling,
// scope filter, and fail-closed handling then decide, so there is no second
// implementation of any rule.
//
// BEFORE for a file is:
// - the file at the first parent of the EARLIEST commit this worktree made
//   (per its HEAD reflog) since the last passing replay, when such a commit
//   touched it; a rename there is followed back to the old path. With no
//   passing replay yet, the commits are the last day's that no other local
//   branch has;
// - otherwise the file at HEAD;
// - absent when it did not exist there, which is the guard's own new-file
//   case (every finding counts as new).
// AFTER is always the working-tree file, so a violation a later commit or
// edit already fixed does not fail.
//
// `plan [<since>]` prints one `<path>\t<before commit>\t<before path>` line
// per file to replay (an empty commit means no parent, so no BEFORE). `run`
// reads those lines on stdin, runs the guard on each, prints every failing
// file's guard reason, and exits 2 when any file failed. Any other non-zero
// exit means the replay itself could not run; guard-replay.sh fails closed on
// it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const GUARD = path.join(__dirname, 'pre-write-guard.sh');

// The reflog subjects `git commit` writes. A merge, cherry-pick, pull,
// rebase, or reset brings in commits another checkout made and gated, so
// those are not this worktree's own writes.
const SESSION_COMMIT_SUBJECT = /^commit(?: \((?:initial|amend)\))?: /;

// With no earlier pass to start from (a fresh worktree, or lost state), only
// the last day of commits counts, so the first replay in an old worktree does
// not re-check months of history (see sessionCommits for the second bound).
const FIRST_RUN_WINDOW_SECONDS = 24 * 60 * 60;

// Each guard call starts one Semgrep process (about 1.7 s, mostly startup).
// Four at a time keeps a typical session's replay to a few seconds without
// starving the rest of the Stop tier.
const CONCURRENCY = 4;

const REPLAYED_EXTENSION = /\.(ts|tsx)$/;

// Rename detection, so a moved file is compared with its old content rather
// than read as a new file whose every finding is new.
const CHANGES_FLAGS = ['-M', '--name-status', '-z'];

const FINDINGS_EXIT_CODE = 2;
const COULD_NOT_RUN_EXIT_CODE = 3;

function git(gitArguments, encoding = 'utf8') {
  return execFileSync('git', gitArguments, {
    cwd: ROOT,
    encoding,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isAncestorOfHead(commit) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: ROOT });

  if (result.status === 0) return true;

  if (result.status === 1) return false;

  throw new Error(`git merge-base --is-ancestor ${commit} HEAD exited ${result.status}`);
}

// The commits in HEAD's history that no other local branch has: work not yet
// merged anywhere.
function unmergedCommits() {
  // `--exclude` before `--branches` takes the name without `refs/heads/`.
  const currentBranch = spawnSync('git', ['symbolic-ref', '-q', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (currentBranch.status !== 0 && currentBranch.status !== 1) {
    throw new Error(`git symbolic-ref -q --short HEAD exited ${currentBranch.status}`);
  }

  const branchName = currentBranch.stdout.trim();
  const excluded = branchName ? [`--exclude=${branchName}`] : [];
  const commits = git(['rev-list', 'HEAD', '--not', ...excluded, '--branches']);

  return new Set(commits.split('\n').filter(Boolean));
}

// Oldest first. An amended-away or reset-away commit is no longer in HEAD's
// history, so it is skipped; its replacement has its own reflog entry. With
// no earlier pass (`since` undefined), a commit also has to be unmerged: an
// old worktree's already-merged history was gated where it merged, and
// replaying a day of it would outlast the Stop hook.
function sessionCommits(since) {
  const isFirstRun = since === undefined;
  const start = isFirstRun ? Math.floor(Date.now() / 1000) - FIRST_RUN_WINDOW_SECONDS : since;
  const unmerged = isFirstRun ? unmergedCommits() : null;
  const isInHistory = (commit) => (isFirstRun ? unmerged.has(commit) : isAncestorOfHead(commit));
  const commits = [];
  const reflog = git(['reflog', '--date=unix', '--format=%H%x09%gd%x09%gs', 'HEAD']);

  for (const line of reflog.split('\n')) {
    const [commit, selector = '', subject = ''] = line.split('\t');
    const time = Number(/\{(\d+)\}/.exec(selector)?.[1]);
    const isCandidate = Boolean(commit) && time >= start && SESSION_COMMIT_SUBJECT.test(subject);

    if (isCandidate && !commits.includes(commit) && isInHistory(commit)) {
      commits.push(commit);
    }
  }

  return commits.reverse();
}

function firstParent(commit) {
  return git(['rev-list', '--parents', '-n', '1', commit]).trim().split(' ')[1] ?? '';
}

// `-z --name-status` output: a status token, then one path, or two (old, new)
// for a rename or copy.
function parseNameStatus(output) {
  const tokens = output.split('\0').filter(Boolean);
  const changes = [];
  let index = 0;

  while (index < tokens.length) {
    const status = tokens[index][0];
    const hasTwoPaths = status === 'R' || status === 'C';
    const from = tokens[index + 1];
    const to = hasTwoPaths ? tokens[index + 2] : from;
    changes.push({ status, from, to });
    index += hasTwoPaths ? 3 : 2;
  }

  return changes;
}

// Keeps the earliest BEFORE per current path: a later change to a path that
// already has one leaves it alone, and a rename carries it to the new path.
function applyChanges(beforeByPath, changes, beforeCommit) {
  for (const change of changes) {
    if (change.status === 'D') {
      beforeByPath.delete(change.to);
    } else if (change.status === 'R') {
      const earlier = beforeByPath.get(change.from) ?? { commit: beforeCommit, path: change.from };
      beforeByPath.delete(change.from);
      beforeByPath.set(change.to, earlier);
    } else if (!beforeByPath.has(change.to)) {
      beforeByPath.set(change.to, { commit: beforeCommit, path: change.to });
    }
  }
}

function plan(since) {
  const beforeByPath = new Map();

  for (const commit of sessionCommits(since)) {
    const changes = git(['diff-tree', '-r', '--root', '--no-commit-id', ...CHANGES_FLAGS, commit]);
    applyChanges(beforeByPath, parseNameStatus(changes), firstParent(commit));
  }

  const head = git(['rev-parse', 'HEAD']).trim();
  const workingTreeChanges = git(['diff', ...CHANGES_FLAGS, 'HEAD']);
  applyChanges(beforeByPath, parseNameStatus(workingTreeChanges), head);
  const untrackedOutput = git(['ls-files', '--others', '--exclude-standard', '-z']);
  const untracked = untrackedOutput.split('\0').filter(Boolean);
  applyChanges(
    beforeByPath,
    untracked.map((file) => ({ status: 'A', from: file, to: file })),
    head,
  );

  return [...beforeByPath]
    .filter(([file]) => REPLAYED_EXTENSION.test(file) && fs.existsSync(path.join(ROOT, file)))
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([file, before]) => `${file}\t${before.commit}\t${before.path}`);
}

// null when the path did not exist at `commit` (or there is no commit).
function beforeContent(commit, beforePath) {
  if (!commit) return null;

  const entry = git(['ls-tree', '-z', commit, '--', beforePath]).split('\0')[0];

  if (!entry) return null;

  const blob = entry.split('\t')[0].split(' ')[2];

  return git(['cat-file', 'blob', blob], 'buffer');
}

function spawnGuard(payload, projectDirectory) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [GUARD], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDirectory },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) =>
      resolve({ code: signal ? `signal ${signal}` : code, stderr }),
    );
    child.stdin.end(payload);
  });
}

// The guard reads BEFORE from the file on disk and relativizes against
// CLAUDE_PROJECT_DIR, so a scratch project holding BEFORE at the same
// relative path makes a Write of the working-tree content a replay of the
// whole change. Path-scoped rules still see the real relative path.
async function replayFile({ file, beforeCommit, beforePath }) {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-guard-replay-'));

  try {
    const filePath = path.join(projectDirectory, file);
    const before = beforeContent(beforeCommit, beforePath);

    if (before !== null) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, before);
    }

    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: fs.readFileSync(path.join(ROOT, file), 'utf8') },
    });
    const { code, stderr } = await spawnGuard(payload, projectDirectory);
    const baseline = before === null ? 'a new file' : `${beforeCommit.slice(0, 12)}:${beforePath}`;

    return { passed: code === 0, report: `${file} (compared with ${baseline}):\n${stderr.trim()}` };
  } finally {
    fs.rmSync(projectDirectory, { recursive: true, force: true });
  }
}

async function mapWithConcurrency(items, limit, task) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
}

async function run() {
  const entries = fs
    .readFileSync(0, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [file, beforeCommit, beforePath] = line.split('\t');

      return { file, beforeCommit, beforePath };
    });
  const failures = (await mapWithConcurrency(entries, CONCURRENCY, replayFile)).filter(
    (result) => !result.passed,
  );

  if (failures.length === 0) return;

  process.stdout.write(`${failures.map((failure) => failure.report).join('\n\n')}\n`);
  process.exitCode = FINDINGS_EXIT_CODE;
}

async function main() {
  const [command, since] = process.argv.slice(2);

  if (command === 'plan') {
    const lines = plan(since ? Number(since) : undefined);
    process.stdout.write(lines.map((line) => `${line}\n`).join(''));

    return;
  }

  if (command === 'run') {
    await run();

    return;
  }

  throw new Error('usage: guard-replay.js plan [<since>] | run');
}

main().catch((error) => {
  process.stderr.write(`guard replay could not run: ${error.stack ?? error.message}\n`);
  process.exitCode = COULD_NOT_RUN_EXIT_CODE;
});
