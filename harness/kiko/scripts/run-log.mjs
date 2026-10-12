#!/usr/bin/env node
// Run log for harness sessions. Each run is a folder <root>/<runId>/ holding run.json (written by `start`),
// an append-only events.jsonl (one line per `event`) and summary.json (written by `finish`); `stats` reads
// them back as a table of review chains. Root: ${HARNESS_RUNS_DIR:-$HOME/.claude/harness-runs}.
// git is read locally only (remote url, branch, HEAD); nothing is fetched.
//
// Every command first makes <root>/bin/run-log.mjs a byte-identical copy of this script, so a consumer can
// call the installed copy without knowing where the plugin lives. A failed copy only warns on stderr.
//
// Usage: see USAGE below (printed on stderr for any bad argument).
//
// Exit codes: 0 = success, 1 = unknown run or I/O error, 2 = bad arguments (usage on stderr).

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `usage:
  run-log.mjs start --task <text> --shape build|fix|research|review [--jira <url>] [--orca-task <id>] [--orca-dispatch <id>]
  run-log.mjs event --run <id> --gate <gate> --verdict <verdict> [--phase <text>] [--step N] [--group N]
                    [--role <text>] [--attempt N] [--findings N] [--mechanizable N] [--note <text>]
      gate:    check|test|review|human|commit|deep|stall|retro
      verdict: pass|fail|changes|approve|stall|timeout|skipped
  run-log.mjs finish --run <id> --outcome done|blocked|aborted [--recorded N] [--gaps N] [--archive <dir>]
  run-log.mjs stats [--since YYYY-MM-DD] [--repo <slug>] [--format md|tsv|json]`;

const SELF = fileURLToPath(import.meta.url);
const SHAPES = ['build', 'fix', 'research', 'review'];
const GATES = ['check', 'test', 'review', 'human', 'commit', 'deep', 'stall', 'retro'];
const VERDICTS = ['pass', 'fail', 'changes', 'approve', 'stall', 'timeout', 'skipped'];
const OUTCOMES = ['done', 'blocked', 'aborted'];
const FORMATS = ['md', 'tsv', 'json'];
const RETRY_AFTER = new Set(['fail', 'changes', 'timeout']);
const MARKS = { changes: '✗', fail: '✗', approve: '✓', pass: '✓' };
const TARGET = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEADER = [
  ...['Run', 'Step group', 'Impl', 'Review', 'Verdicts', 'Steps'],
  ...['Minutes', 'Target', 'Check/test retries', 'Stalls', 'Human rounds', 'Outcome'],
];

class Exit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const usage = (message) => new Exit(2, `run-log: ${message}\n${USAGE}`);

// ---- arguments ----

function parseFlags(args, names) {
  const flags = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index].replace(/^--/, '');
    if (!args[index].startsWith('--') || !names.includes(name) || args[index + 1] === undefined) {
      throw usage(`bad argument ${args[index]}`);
    }
    flags[name] = args[index + 1];
  }
  return flags;
}

function required(flags, name) {
  if (!flags[name]) throw usage(`--${name} is required`);
  return flags[name];
}

function oneOf(flags, name, values) {
  if (!values.includes(flags[name])) throw usage(`--${name} must be one of ${values.join('|')}`);
  return flags[name];
}

function integer(flags, name) {
  if (flags[name] === undefined) return null;
  if (!/^-?\d+$/.test(flags[name])) throw usage(`--${name} must be an integer`);
  return Number(flags[name]);
}

// ---- files ----

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readEvents(dir) {
  const file = join(dir, 'events.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        return entry && typeof entry === 'object' && !Array.isArray(entry) ? [entry] : [];
      } catch {
        return [];
      }
    });
}

function runDir(root, flags) {
  const runId = required(flags, 'run');
  const dir = join(root, runId);
  if (basename(runId) !== runId || runId.startsWith('.') || !existsSync(join(dir, 'run.json'))) {
    throw new Exit(1, `run-log: unknown run ${runId}`);
  }
  return dir;
}

function selfCopy(root) {
  const target = join(root, 'bin', 'run-log.mjs');
  try {
    const source = readFileSync(SELF);
    if (existsSync(target) && readFileSync(target).equals(source)) return;
    mkdirSync(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, source);
    renameSync(temp, target);
  } catch (error) {
    process.stderr.write(`run-log: warning: could not update ${target}: ${error.message}\n`);
  }
}

// ---- start ----

function git(...args) {
  try {
    return (
      execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() ||
      null
    );
  } catch {
    return null;
  }
}

const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';

function repoName() {
  const origin = git('remote', 'get-url', 'origin');
  if (origin)
    return origin
      .replace(/\/+$/, '')
      .split(/[/:]/)
      .pop()
      .replace(/\.git$/, '');
  return basename(git('rev-parse', '--show-toplevel') ?? process.cwd());
}

// mkdir without `recursive` fails with EEXIST on a taken id, which moves on to the next suffix.
function claimRunId(root, base) {
  mkdirSync(root, { recursive: true });
  for (let suffix = 1; ; suffix++) {
    const runId = suffix === 1 ? base : `${base}-${suffix}`;
    try {
      mkdirSync(join(root, runId));
      return runId;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

function start(root, args) {
  const flags = parseFlags(args, ['task', 'shape', 'jira', 'orca-task', 'orca-dispatch']);
  const task = required(flags, 'task');
  const shape = oneOf(flags, 'shape', SHAPES);
  const now = new Date();
  const repo = slug(repoName());
  const branch = slug(git('branch', '--show-current') ?? 'detached');
  const minute = now.toISOString().replace(/[-:]/g, '').slice(0, 13);
  const runId = claimRunId(root, `${minute}-${repo}-${branch}`);
  const hasOrca = flags['orca-task'] !== undefined || flags['orca-dispatch'] !== undefined;
  const orca = hasOrca
    ? { taskId: flags['orca-task'] ?? null, dispatchId: flags['orca-dispatch'] ?? null }
    : null;
  const run = {
    ...{ v: 1, runId, repo, branch, baseSha: git('rev-parse', 'HEAD'), cwd: process.cwd() },
    ...{ task, jira: flags.jira ?? null, shape, orca, startedAt: now.toISOString() },
  };
  writeFileSync(join(root, runId, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  process.stdout.write(`${runId}\n`);
}

// ---- event ----

function event(root, args) {
  const texts = ['run', 'gate', 'verdict', 'phase', 'role', 'note'];
  const numbers = ['step', 'group', 'attempt', 'findings', 'mechanizable'];
  const flags = parseFlags(args, [...texts, ...numbers]);
  const gate = oneOf(flags, 'gate', GATES);
  const verdict = oneOf(flags, 'verdict', VERDICTS);
  const [step, group, attempt, findings, mechanizable] = numbers.map((name) =>
    integer(flags, name),
  );
  const dir = runDir(root, flags);
  const line = {
    ...{ v: 1, ts: new Date().toISOString(), phase: flags.phase ?? null, step, group, gate },
    ...{
      role: flags.role ?? null,
      attempt,
      verdict,
      findings,
      mechanizable,
      note: flags.note ?? null,
    },
  };
  appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify(line)}\n`);
}

// ---- finish ----

const isStall = (entry) => entry.gate === 'stall' || entry.verdict === 'stall';

// A retry is an event whose previous event on the same step and gate ended in fail, changes or timeout.
function countRetries(events) {
  const last = new Map();
  let retries = 0;
  for (const entry of events) {
    const key = `${entry.step}|${entry.gate}`;
    if (RETRY_AFTER.has(last.get(key))) retries++;
    last.set(key, entry.verdict);
  }
  return retries;
}

function totals(events) {
  const byGate = {};
  for (const { gate, verdict } of events) {
    byGate[gate] ??= {};
    byGate[gate][verdict] = (byGate[gate][verdict] ?? 0) + 1;
  }
  return {
    events: events.length,
    byGate,
    stalls: events.filter(isStall).length,
    retries: countRetries(events),
  };
}

function move(source, target) {
  try {
    renameSync(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    copyFileSync(source, target);
    unlinkSync(source);
  }
}

// Moves the regular files directly in `from` (no subfolders) into `to`; a missing `from` moves nothing.
function archive(from, to) {
  let entries;
  try {
    entries = readdirSync(from, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  const files = entries.filter((entry) => entry.isFile());
  if (files.length > 0) mkdirSync(to, { recursive: true });
  for (const file of files) move(join(from, file.name), join(to, file.name));
  return files.length;
}

function finish(root, args) {
  const flags = parseFlags(args, ['run', 'outcome', 'recorded', 'gaps', 'archive']);
  const outcome = oneOf(flags, 'outcome', OUTCOMES);
  const recorded = integer(flags, 'recorded');
  const gaps = integer(flags, 'gaps');
  const dir = runDir(root, flags);
  const runId = basename(dir);
  const retro = recorded === null && gaps === null ? null : { recorded, gaps };
  const finishedAt = new Date().toISOString();
  const summary = { v: 1, runId, outcome, finishedAt, totals: totals(readEvents(dir)), retro };
  writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (flags.archive !== undefined) {
    process.stdout.write(`${archive(resolve(flags.archive), join(dir, 'artifacts'))}\n`);
  }
}

// ---- stats ----

function runOutcome(dir, run, events) {
  const summary = readJson(join(dir, 'summary.json'));
  if (summary?.outcome) return summary.outcome;
  const times = [run.startedAt, ...events.map((entry) => entry.ts)].map(
    (ts) => Date.parse(ts) || 0,
  );
  return Date.now() - Math.max(...times) > DAY_MS ? 'abandoned' : 'running';
}

function verdictChain(reviews) {
  let chain = '';
  for (const review of reviews) {
    const mark = MARKS[review.verdict];
    if (!mark) continue;
    chain += mark;
    if (mark === '✓') break;
  }
  return chain;
}

const count = (events, test) => events.filter(test).length;

// Impl counts one implementation round per rejected review in the chain, plus the first one.
function groupRow(runId, key, events, outcome) {
  const reviews = events.filter((entry) => entry.gate === 'review');
  const chain = verdictChain(reviews);
  const times = events.map((entry) => Date.parse(entry.ts)).filter(Number.isFinite);
  const minutes =
    times.length > 0 ? Math.round((Math.max(...times) - Math.min(...times)) / 60000) : 0;
  const steps = new Set(events.map((entry) => entry.step).filter((step) => step != null));
  const checksAndTests = events.filter((entry) => entry.gate === 'check' || entry.gate === 'test');
  return {
    ...{
      Run: runId,
      'Step group': String(key),
      Impl: count([...chain], (mark) => mark === '✗') + 1,
    },
    ...{
      Review: reviews.length,
      Verdicts: chain,
      Steps: steps.size,
      Minutes: minutes,
      Target: TARGET,
    },
    'Check/test retries': countRetries(checksAndTests),
    Stalls: count(events, isStall),
    'Human rounds': count(events, (entry) => entry.gate === 'human'),
    Outcome: outcome,
  };
}

function runRows(dir, run) {
  const time = (entry) => Date.parse(entry.ts) || 0;
  const events = readEvents(dir).sort((first, second) => time(first) - time(second));
  const outcome = runOutcome(dir, run, events);
  const groups = new Map();
  for (const entry of events) {
    const key = entry.group ?? entry.step ?? '-';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  if (groups.size === 0) groups.set('-', []);
  return [...groups].map(([key, members]) =>
    groupRow(run.runId ?? basename(dir), key, members, outcome),
  );
}

function render(rows, format) {
  if (format === 'json') return `${JSON.stringify(rows, null, 2)}\n`;
  const body = rows.map((row) => HEADER.map((name) => String(row[name])));
  if (format === 'tsv') return `${[HEADER, ...body].map((cells) => cells.join('\t')).join('\n')}\n`;
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return `${[line(HEADER), line(HEADER.map(() => '---')), ...body.map(line)].join('\n')}\n`;
}

function stats(root, args) {
  const flags = parseFlags(args, ['since', 'repo', 'format']);
  const format = flags.format === undefined ? 'md' : oneOf(flags, 'format', FORMATS);
  if (flags.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(flags.since)) {
    throw usage('--since must be YYYY-MM-DD');
  }
  const since = flags.since === undefined ? null : Date.parse(`${flags.since}T00:00:00Z`);
  const names = existsSync(root) ? readdirSync(root, { withFileTypes: true }) : [];
  const rows = names
    .filter((entry) => entry.isDirectory() && entry.name !== 'bin')
    .map((entry) => entry.name)
    .sort()
    .flatMap((name) => {
      const run = readJson(join(root, name, 'run.json'));
      if (!run) return [];
      if (since !== null && !(Date.parse(run.startedAt) >= since)) return [];
      if (flags.repo !== undefined && run.repo !== flags.repo) return [];
      return runRows(join(root, name), run);
    });
  process.stdout.write(render(rows, format));
}

// ---- main ----

const COMMANDS = { start, event, finish, stats };

function main([command, ...args]) {
  if (!Object.hasOwn(COMMANDS, command ?? ''))
    throw usage(command ? `unknown command ${command}` : 'no command');
  const root = process.env.HARNESS_RUNS_DIR || join(homedir(), '.claude', 'harness-runs');
  selfCopy(root);
  COMMANDS[command](root, args);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    error instanceof Exit ? `${error.message}\n` : `run-log: ${error.message}\n`,
  );
  process.exitCode = error instanceof Exit ? error.code : 1;
}
