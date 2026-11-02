import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const GUARD = join(__dirname, '../../scripts/checks/kill-guard.js');

const DECIDE_SCRIPT = [
  'const { decide } = require(process.argv[1]);',
  'const cases = JSON.parse(process.argv[2]);',
  'const kinds = cases.map(([command, options]) => {',
  '  const finding = decide(command, options);',
  '  return finding === null ? "allow" : finding.kind;',
  '});',
  'process.stdout.write(JSON.stringify(kinds));',
].join('\n');

export type DecideOptions = Record<string, unknown>;

// A path outside the main checkout that holds no `.git`: it is no worktree, only a folder the
// guard has no repository to read in, so a commit run from it is judged as one outside the main
// checkout.
export const PLAIN_FOLDER_OUTSIDE_MAIN =
  '/Users/drizzer14/orca/workspaces/pff-ios/shares-assets-research';

export const COMMIT_WORD = /\bcommit(?![-\w])/;

// A commit with no cwd is judged as one in the main checkout and denied, so a row that holds a
// `git commit` (also after a `-c` option) and pins another finding runs from a plain folder
// outside the main checkout; any other row names no cwd.
export const optionsOutsideMain = (command: string): DecideOptions =>
  COMMIT_WORD.test(command) ? { cwd: PLAIN_FOLDER_OUTSIDE_MAIN } : {};

export const payloadOutsideMain = (command: string): string =>
  JSON.stringify({ ...optionsOutsideMain(command), tool_input: { command } });

// A case is `[command, options]`; every case is judged in one node process, as a parser only.
export const decideAll = (cases: [string, DecideOptions][]): string[] =>
  JSON.parse(
    spawnSync('node', ['-e', DECIDE_SCRIPT, GUARD, JSON.stringify(cases)], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }).stdout,
  );

const STEPS_SCRIPT = [
  'const { decide } = require(process.argv[1]);',
  'const workCounter = { steps: 0 };',
  'const finding = decide(process.argv[2], { ...JSON.parse(process.argv[3]), workCounter });',
  'process.stdout.write(JSON.stringify({',
  '  decision: finding === null ? "allow" : finding.kind,',
  '  steps: workCounter.steps,',
  '}));',
].join('\n');

// The finding kind of one command and the guard's own scan steps to judge it, which a linearity
// row counts instead of reading a clock.
export const stepsFor = (
  command: string,
  options: DecideOptions = {},
): { decision: string; steps: number } =>
  JSON.parse(
    spawnSync('node', ['-e', STEPS_SCRIPT, GUARD, command, JSON.stringify(options)], {
      encoding: 'utf8',
    }).stdout,
  );

// The finding kind of one command, or 'allow'.
export const decide = (command: string, options: DecideOptions = {}): string =>
  decideAll([[command, options]])[0];
