#!/usr/bin/env node

// The pre-write guard (pre-write-guard.sh/.js) sees only an Edit, Write, or
// MultiEdit. A Bash or python write, or a commit of one, reaches disk without
// it. This replays the SAME guard on the Stop tier, once per changed .ts/.tsx
// file, as a Write whose on-disk BEFORE is the file as it was before the
// session changed it. The guard's own new-finding diff, override handling,
// scope filter, conflict handling, and fail-closed handling then decide, so
// there is no second implementation of any rule.
//
// The session's commits are the commits in HEAD that no mark ref
// (refs/kiko/guard-replay/*, each worktree's HEAD when its replay last passed)
// reaches and that are newer than the floor (the time guard-replay.sh
// recorded on the repository's first replay) or have a parent that is a
// session commit. Only a PASSED replay moves a mark, and a mark vouches for
// the working tree at the HEAD it recorded, not for each commit under it
// (kiko-linter's "Known limits"). No branch name hides a commit: a backup
// branch, a `switch -c`, or a worktree made from HEAD leaves every unchecked
// commit selected. That covers a plain commit, an amend, a rebase, a cherry-pick, a
// pull --rebase, and every commit of a topic branch merged in, alike. Commits
// a merge brings in from a branch some worktree's replay passed are reached by
// that worktree's mark and are not replayed; commits from a branch no replay
// ever passed are, down to the floor, which bounds how far back that goes.
//
// BEFORE for a file is its baseline along the history that led to it:
// - the file at the parent of the earliest session commit that touched it on
//   that line of history (a rename there is followed back to the old path);
// - through a session merge, the baseline of the parent whose version the
//   merge kept; for a file the merge left different from every parent (a
//   conflict resolution, a join of both sides, or anything written into the
//   merge before it was committed), both parents' baselines, written as one
//   conflict block, so the guard's own conflicted-BEFORE handling takes the
//   union of both sides' findings;
// - otherwise the file at HEAD;
// - absent when it did not exist there, which is the guard's own new-file
//   case (every finding counts as new).
// AFTER is always the working-tree file, so a violation a later commit or
// edit already fixed does not fail.
//
// `plan [<floor>]` prints one line per file to replay: the path, then one or
// two `<commit>\t<path>` BEFORE sources, tab-separated (an empty commit means
// no parent, so no BEFORE). `run [--deadline [<hook start>]]` reads those
// lines on stdin, runs the guard on each, prints every failing file's guard
// reason, and exits 2 when any file failed. With `--deadline` (the Stop tier)
// it starts no new guard call after `stopTierDeadlineSeconds` and exits 4
// when files were left unchecked. Any other non-zero exit means the replay
// itself could not run; guard-replay.sh fails closed on it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const GUARD = path.join(__dirname, 'pre-write-guard.sh');

// _lib.sh's harness_replay_ref writes one ref per worktree under this prefix.
const MARK_REFS = 'refs/kiko/guard-replay/*';

// Each guard call starts one Semgrep process (about 1.7 s, mostly startup).
// Four at a time keeps a typical session's replay to a few seconds without
// starving the rest of the Stop tier.
const CONCURRENCY = 4;

// The Stop hook is killed at HOOK_BUDGET_SECONDS (hooks.json), and Claude
// Code ends the turn with no error when that happens, so the replay stops
// starting guard calls well before it. The budget is counted from medium.sh's
// own start, so its lock wait and dup.sh count too. What must still fit after
// the last guard call starts: that call's own timeout (pre-write-guard.js's
// 25 s default) and the checks medium.sh runs after the replay (knip, deps,
// the rule fixtures, plist, typecheck: about 20 s cold, measured 2026-09-27,
// reserved three times over). KIKO_GUARD_REPLAY_DEADLINE_SECONDS lowers the
// deadline for the tests; it never raises it.
const STOP_TIER_DEADLINE_SECONDS = 150;
const HOOK_BUDGET_SECONDS = 300;
const GUARD_CALL_TAIL_SECONDS = 25;
const LATER_CHECKS_RESERVE_SECONDS = 60;

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

// Parents before children, so each commit's parents already have their
// baselines. A commit older than the floor is outside the session only when
// none of its parents is in it: git's own `--max-age` would also drop every
// commit under an old-dated one, so a forged committer date on top would hide
// the session beneath it. A floor that is not a whole number of seconds
// bounds nothing.
function sessionCommits(floor) {
  const floorSeconds = /^\d+$/.test(floor ?? '') ? Number(floor) : Number.NEGATIVE_INFINITY;
  const output = git([
    'rev-list',
    '--timestamp',
    '--parents',
    '--topo-order',
    '--reverse',
    'HEAD',
    '--not',
    `--glob=${MARK_REFS}`,
  ]);
  const inSession = new Set();

  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [timestamp, commit, ...parents] = line.split(' ');

      return { timestamp: Number(timestamp), commit, parents };
    })
    .filter(({ timestamp, commit, parents }) => {
      const isInSession =
        timestamp >= floorSeconds || parents.some((parent) => inSession.has(parent));

      if (isInSession) inSession.add(commit);

      return isInSession;
    })
    .map(({ commit, parents }) => ({ commit, parents }));
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

function changedPaths(from, to) {
  const output = git(['diff-tree', '-r', '--name-status', '-z', from, to]);

  return new Map(parseNameStatus(output).map((change) => [change.to, change.status]));
}

// The guard compares a file with at most two BEFORE versions (the two sides
// of one conflict block).
function mergedSources(sources) {
  const seen = new Set();

  return sources
    .filter((source) => {
      const key = `${source.commit}\t${source.path}`;
      const isNew = !seen.has(key);
      seen.add(key);

      return isNew;
    })
    .slice(0, 2);
}

// A path the merge kept as some parent had it keeps that parent's baseline
// (none when that parent's version was already checked). A path the merge
// left different from every parent, the set `diff-tree --cc` lists, gets
// every parent's baseline, so what each side brought is baseline too. A clean
// merge of already-checked parents therefore replays nothing.
function mergeBaseline(merge, parents, sides) {
  const differences = parents.map((parent) => changedPaths(parent, merge));
  const baseline = new Map();

  for (const file of new Set([...differences[0].keys(), ...sides[0].keys()])) {
    if (differences[0].get(file) === 'D') continue;

    const keptFrom = differences.findIndex((difference) => !difference.has(file));

    if (keptFrom >= 0) {
      const kept = sides[keptFrom].get(file);
      if (kept) baseline.set(file, kept);
    } else {
      const sources = parents.flatMap(
        (parent, index) => sides[index].get(file) ?? [{ commit: parent, path: file }],
      );
      baseline.set(file, mergedSources(sources));
    }
  }

  return baseline;
}

// Each session commit's baseline: every path the session changed on the way
// to that commit, with its BEFORE sources. A parent outside the session has
// none, since every file there is as a passed replay (or the floor) left it.
// A parent's last child takes its map; any earlier child takes a copy.
function sessionBaselines(commits) {
  const baselines = new Map();
  const unreadChildren = new Map();

  for (const { parents } of commits) {
    for (const parent of parents) {
      unreadChildren.set(parent, (unreadChildren.get(parent) ?? 0) + 1);
    }
  }

  const takeBaseline = (parent) => {
    const baseline = baselines.get(parent);

    if (!baseline) return new Map();

    const unread = unreadChildren.get(parent) - 1;
    unreadChildren.set(parent, unread);

    if (unread > 0) return new Map(baseline);

    baselines.delete(parent);

    return baseline;
  };

  for (const { commit, parents } of commits) {
    const sides = parents.map(takeBaseline);

    if (parents.length > 1) {
      baselines.set(commit, mergeBaseline(commit, parents, sides));
    } else {
      const baseline = sides[0] ?? new Map();
      const changes = git([...COMMIT_DIFF, ...CHANGES_FLAGS, commit]);
      applyChanges(baseline, parseNameStatus(changes), parents[0] ?? '');
      baselines.set(commit, baseline);
    }
  }

  return baselines;
}

function plan(floor) {
  const baselines = sessionBaselines(sessionCommits(floor));
  const head = git(['rev-parse', 'HEAD']).trim();
  const beforeByPath = baselines.get(head) ?? new Map();
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

// Seconds from now until the replay starts no new guard call. `override` only
// ever lowers the ceiling, so no environment can lift the Stop tier past the
// hook's own timeout. With `hookStarted` (medium.sh's start, in unix seconds)
// it is also what the hook budget has left; zero or less means none.
function stopTierDeadlineSeconds({ override, hookStarted, now }) {
  const requested = Number(override);
  const ceiling =
    requested > 0 && Number.isFinite(requested)
      ? Math.min(requested, STOP_TIER_DEADLINE_SECONDS)
      : STOP_TIER_DEADLINE_SECONDS;

  if (!/^\d+$/.test(hookStarted ?? '')) return ceiling;

  const budgetLeft =
    HOOK_BUDGET_SECONDS -
    (now - Number(hookStarted)) -
    GUARD_CALL_TAIL_SECONDS -
    LATER_CHECKS_RESERVE_SECONDS;

  return Math.min(ceiling, budgetLeft);
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
      `stopped at the Stop-tier replay deadline, ${Math.max(0, Math.floor(deadlineSeconds))} s ` +
        `after the replay started (at most ${STOP_TIER_DEADLINE_SECONDS} s; less when the lock ` +
        `wait and earlier checks already spent the hook's ${HOOK_BUDGET_SECONDS} s): ` +
        `${uncheckedCount} of ${entries.length} changed files were not replayed`,
    );
    process.exitCode = DEADLINE_EXIT_CODE;
  } else if (reports.length > 0) {
    process.exitCode = FINDINGS_EXIT_CODE;
  }

  if (reports.length > 0) process.stdout.write(`${reports.join('\n\n')}\n`);
}

async function main() {
  const [command, option, hookStarted] = process.argv.slice(2);

  if (command === 'plan') {
    const lines = plan(option);
    process.stdout.write(lines.map((line) => `${line}\n`).join(''));

    return;
  }

  if (command === 'run') {
    const deadlineSeconds = stopTierDeadlineSeconds({
      override: process.env.KIKO_GUARD_REPLAY_DEADLINE_SECONDS,
      hookStarted,
      now: Date.now() / 1000,
    });
    await run(option === '--deadline' ? deadlineSeconds : undefined);

    return;
  }

  throw new Error('usage: guard-replay.js plan [<floor>] | run [--deadline [<hook start>]]');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`guard replay could not run: ${error.stack ?? error.message}\n`);
    process.exitCode = COULD_NOT_RUN_EXIT_CODE;
  });
}

module.exports = { stopTierDeadlineSeconds };
