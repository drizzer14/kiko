#!/usr/bin/env node

// The pre-write guard (pre-write-guard.sh/.js) sees only an Edit, Write, or
// MultiEdit. A Bash or python write, or a commit of one, reaches disk without
// it. This replays the SAME guard on the Stop tier, once per changed .ts/.tsx
// file, as a Write whose on-disk BEFORE is the file as it was before the
// session changed it. The guard's own new-finding diff, override handling,
// scope filter, conflict handling, and fail-closed handling then decide, so
// there is no second implementation of any rule.
//
// The session's commits are the commits on HEAD's first-parent line that
// neither the mark (HEAD when the replay last passed) nor any other local
// branch can reach. That covers a plain commit, an amend, a rebase, a
// cherry-pick, and a pull --rebase alike: each makes new commits no other
// branch has. Commits a merge brings in through its second parent were gated
// on their own branch and are not replayed. With no mark yet (a fresh
// worktree, or lost state), only commits from the last day count, so the
// first replay in an old worktree does not re-check months of history.
//
// BEFORE for a file is:
// - the file at the parent of the EARLIEST session commit that touched it (a
//   rename there is followed back to the old path), otherwise at HEAD;
// - for a file a session merge commit left different from every parent (a
//   conflict resolution, or anything written into the merge before it was
//   committed), a conflict block of the first two parents' versions, so the
//   guard's own conflicted-BEFORE handling takes the union of both sides'
//   findings as the baseline;
// - absent when it did not exist there, which is the guard's own new-file
//   case (every finding counts as new).
// AFTER is always the working-tree file, so a violation a later commit or
// edit already fixed does not fail.
//
// `plan [<mark>]` prints one line per file to replay: the path, then one or
// two `<commit>\t<path>` BEFORE sources, tab-separated (an empty commit means
// no parent, so no BEFORE). `run [--deadline]` reads those lines on stdin,
// runs the guard on each, prints every failing file's guard reason, and exits
// 2 when any file failed. With `--deadline` (the Stop tier) it starts no new
// guard call after STOP_TIER_DEADLINE_SECONDS and exits 4 when files were left
// unchecked. Any other non-zero exit means the replay itself could not run;
// guard-replay.sh fails closed on it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const GUARD = path.join(__dirname, 'pre-write-guard.sh');

const FIRST_RUN_WINDOW_SECONDS = 24 * 60 * 60;

// Each guard call starts one Semgrep process (about 1.7 s, mostly startup).
// Four at a time keeps a typical session's replay to a few seconds without
// starving the rest of the Stop tier.
const CONCURRENCY = 4;

// The Stop hook is killed at 300 s, and Claude Code ends the turn with no
// error when that happens, so the replay stops starting guard calls well
// before it: an in-flight call still has its own 25 s budget, and dup.sh and
// the lock wait share the rest. KIKO_GUARD_REPLAY_DEADLINE_SECONDS overrides
// it for the tests only.
const STOP_TIER_DEADLINE_SECONDS = 150;

const REPLAYED_EXTENSION = /\.(ts|tsx)$/;

// Rename detection, so a moved file is compared with its old content rather
// than read as a new file whose every finding is new.
const CHANGES_FLAGS = ['-M', '--name-status', '-z'];

// One commit against its parent; `--no-commit-id` keeps the commit's own id
// out of the `-z` path list.
const COMMIT_DIFF = ['diff-tree', '--no-commit-id', '-r', '--root'];

const FINDINGS_EXIT_CODE = 2;
const COULD_NOT_RUN_EXIT_CODE = 3;
const DEADLINE_EXIT_CODE = 4;

function git(gitArguments, encoding = 'utf8') {
  return execFileSync('git', gitArguments, {
    cwd: ROOT,
    encoding,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// A git query whose exit 1 is an answer, not a failure.
function gitAnswer(gitArguments) {
  const result = spawnSync('git', gitArguments, { cwd: ROOT, encoding: 'utf8' });

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git ${gitArguments.join(' ')} exited ${result.status}`);
  }

  return { found: result.status === 0, output: result.stdout.trim() };
}

// A mark whose commit is gone (garbage-collected after a reset) bounds
// nothing, so the run falls back to the first-run window.
function sessionCommits(mark) {
  const hasMark = Boolean(mark) && gitAnswer(['cat-file', '-e', `${mark}^{commit}`]).found;
  const window = hasMark
    ? []
    : [`--max-age=${Math.floor(Date.now() / 1000) - FIRST_RUN_WINDOW_SECONDS}`];
  const reachedByMark = hasMark ? [mark] : [];
  // `--exclude` before `--branches` takes the name without `refs/heads/`.
  const branch = gitAnswer(['symbolic-ref', '-q', '--short', 'HEAD']).output;
  const excluded = branch ? [`--exclude=${branch}`] : [];
  const commits = git([
    'rev-list',
    '--first-parent',
    '--reverse',
    ...window,
    'HEAD',
    '--not',
    ...reachedByMark,
    ...excluded,
    '--branches',
  ]);

  return commits.split('\n').filter(Boolean);
}

function parentsOf(commit) {
  return git(['rev-list', '--parents', '-n', '1', commit]).trim().split(' ').slice(1);
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
      const earlier = beforeByPath.get(change.from) ?? [
        { commit: beforeCommit, path: change.from },
      ];
      beforeByPath.delete(change.from);
      beforeByPath.set(change.to, earlier);
    } else if (!beforeByPath.has(change.to)) {
      beforeByPath.set(change.to, [{ commit: beforeCommit, path: change.to }]);
    }
  }
}

// Only the paths the merge left different from every parent: a clean merge
// lists none. A path the session already changed keeps its own BEFORE and
// gains the merged-in parent's version, so what the merge brought is part of
// the baseline too.
function applyMerge(beforeByPath, merge, [firstParent, secondParent]) {
  const output = git(['diff-tree', '--cc', '-r', '--no-commit-id', '--name-only', '-z', merge]);

  for (const file of output.split('\0').filter(Boolean)) {
    const earlier = beforeByPath.get(file) ?? [{ commit: firstParent, path: file }];
    beforeByPath.set(file, [earlier[0], { commit: secondParent, path: file }]);
  }
}

function plan(mark) {
  const beforeByPath = new Map();

  for (const commit of sessionCommits(mark)) {
    const parents = parentsOf(commit);

    if (parents.length > 1) {
      applyMerge(beforeByPath, commit, parents);
    } else {
      const changes = git([...COMMIT_DIFF, ...CHANGES_FLAGS, commit]);
      applyChanges(beforeByPath, parseNameStatus(changes), parents[0] ?? '');
    }
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
    .map(([file, sources]) =>
      [file, ...sources.flatMap((source) => [source.commit, source.path])].join('\t'),
    );
}

// null when the path did not exist at `commit` (or there is no commit).
function sourceContent({ commit, path: sourcePath }) {
  if (!commit) return null;

  const entry = git(['ls-tree', '-z', commit, '--', sourcePath]).split('\0')[0];

  if (!entry) return null;

  const blob = entry.split('\t')[0].split(' ')[2];

  return git(['cat-file', 'blob', blob]);
}

function withTrailingNewline(text) {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`;
}

// One source is the file as it was; two are a merge's parents, written as
// one conflict block the guard splits back into its two sides.
function beforeContent(sources) {
  const contents = sources.map(sourceContent);

  if (contents.length === 1 || contents.every((content) => content === null)) {
    return contents[0];
  }

  const [ours, theirs] = contents.map((content) => withTrailingNewline(content ?? ''));

  return `<<<<<<< first parent\n${ours}=======\n${theirs}>>>>>>> second parent\n`;
}

function describeSources(sources, before) {
  if (before === null) return 'a new file';

  return sources.map((source) => `${source.commit.slice(0, 12)}:${source.path}`).join(' + ');
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
async function replayFile({ file, sources }) {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-guard-replay-'));

  try {
    const filePath = path.join(projectDirectory, file);
    const before = beforeContent(sources);

    if (before !== null) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, before);
    }

    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: fs.readFileSync(path.join(ROOT, file), 'utf8') },
    });
    const { code, stderr } = await spawnGuard(payload, projectDirectory);
    const baseline = describeSources(sources, before);

    return { passed: code === 0, report: `${file} (compared with ${baseline}):\n${stderr.trim()}` };
  } finally {
    fs.rmSync(projectDirectory, { recursive: true, force: true });
  }
}

// An item not started before `deadline` stays undefined in the result.
async function mapWithConcurrency(items, limit, deadline, task) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length && Date.now() < deadline) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return Array.from({ length: items.length }, (_, index) => results[index]);
}

function parsePlanLine(line) {
  const [file, ...sourceFields] = line.split('\t');
  const sources = [];

  for (let index = 0; index < sourceFields.length; index += 2) {
    sources.push({ commit: sourceFields[index], path: sourceFields[index + 1] });
  }

  return { file, sources };
}

async function run(deadlineSeconds) {
  const entries = fs.readFileSync(0, 'utf8').split('\n').filter(Boolean).map(parsePlanLine);
  const deadline =
    deadlineSeconds === undefined ? Number.POSITIVE_INFINITY : Date.now() + deadlineSeconds * 1000;
  const results = await mapWithConcurrency(entries, CONCURRENCY, deadline, replayFile);
  const reports = results
    .filter((result) => result && !result.passed)
    .map((result) => result.report);
  const uncheckedCount = results.filter((result) => result === undefined).length;

  if (uncheckedCount > 0) {
    reports.unshift(
      `stopped at the ${deadlineSeconds} s Stop-tier replay deadline: ` +
        `${uncheckedCount} of ${entries.length} changed files were not replayed`,
    );
    process.exitCode = DEADLINE_EXIT_CODE;
  } else if (reports.length > 0) {
    process.exitCode = FINDINGS_EXIT_CODE;
  }

  if (reports.length > 0) process.stdout.write(`${reports.join('\n\n')}\n`);
}

async function main() {
  const [command, option] = process.argv.slice(2);

  if (command === 'plan') {
    const lines = plan(option);
    process.stdout.write(lines.map((line) => `${line}\n`).join(''));

    return;
  }

  if (command === 'run') {
    const deadlineSeconds =
      Number(process.env.KIKO_GUARD_REPLAY_DEADLINE_SECONDS) || STOP_TIER_DEADLINE_SECONDS;
    await run(option === '--deadline' ? deadlineSeconds : undefined);

    return;
  }

  throw new Error('usage: guard-replay.js plan [<mark>] | run [--deadline]');
}

main().catch((error) => {
  process.stderr.write(`guard replay could not run: ${error.stack ?? error.message}\n`);
  process.exitCode = COULD_NOT_RUN_EXIT_CODE;
});
