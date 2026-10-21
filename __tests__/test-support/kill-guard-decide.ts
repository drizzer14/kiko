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

// A case is `[command, options]`; every case is judged in one node process, as a parser only.
export const decideAll = (cases: [string, DecideOptions][]): string[] =>
  JSON.parse(
    spawnSync('node', ['-e', DECIDE_SCRIPT, GUARD, JSON.stringify(cases)], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }).stdout,
  );

// The finding kind of one command, or 'allow'.
export const decide = (command: string, options: DecideOptions = {}): string =>
  decideAll([[command, options]])[0];
