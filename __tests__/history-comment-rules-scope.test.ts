import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

// kiko-code-style's "Comments: WHY only, never history" is mechanized by three rules for `//` and
// `/* */` comments and three for `#` comment lines of shell scripts. The first three read every
// TypeScript and JavaScript file except the e2e and harness trees and the two root files; the
// shell rules read every .sh file except the harness tree. This suite runs the real rule files
// against a throwaway tree, once, and names the rule ids that fire on each probe file.
const ROOT = join(__dirname, '..');
const RULE_FILES = ['rules/semgrep-prewrite.yml', 'rules/semgrep-mobile.yml'];
const SLASH_RULES = [
  'kiko-no-history-id-comment',
  'kiko-no-history-word-comment',
  'kiko-no-history-date-comment',
];
const SHELL_RULES = [
  'kiko-no-history-id-shell-comment',
  'kiko-no-history-word-shell-comment',
  'kiko-no-history-date-shell-comment',
];
const HISTORY_TEXT = [
  'Bug 12 is why this branch exists.',
  'The sheet no longer pushes a duplicate.',
  'Ruled 2026-10-14 for the picker.',
];
const WHY_TEXT = ['The picker keeps focus so the keyboard stays open.'];

type Probe = { path: string; marker: '//' | '#'; extension: string; code: string };

const IN_SCOPE_PROBES: Probe[] = [
  { path: 'src/probe', marker: '//', extension: 'ts', code: 'export const value = 1;' },
  { path: '__tests__/probe', marker: '//', extension: 'ts', code: 'export const value = 1;' },
  { path: 'scripts/probe', marker: '//', extension: 'js', code: 'module.exports = 1;' },
  { path: 'scripts/checks/probe', marker: '//', extension: 'js', code: 'module.exports = 1;' },
  { path: 'scripts/checks/probe', marker: '#', extension: 'sh', code: 'value=1' },
];

const OUT_OF_SCOPE_PROBES: Probe[] = [
  { path: 'e2e/probe', marker: '//', extension: 'ts', code: 'export const value = 1;' },
  { path: 'harness/kiko/probe', marker: '//', extension: 'js', code: 'module.exports = 1;' },
  { path: 'harness/kiko/hooks/probe', marker: '#', extension: 'sh', code: 'value=1' },
];

type Variant = 'bad' | 'good';

const probeFile = ({ path, extension }: Probe, variant: Variant): string =>
  `${path}-${variant}.${extension}`;

const probeText = ({ marker, code }: Probe, lines: string[]): string =>
  `${lines.map((line) => `${marker} ${line}`).join('\n')}\n${code}\n`;

let fired: Map<string, Set<string>>;

const firedRules = (probe: Probe, variant: Variant): string[] =>
  [...(fired.get(probeFile(probe, variant)) ?? [])].sort();

beforeAll(() => {
  const tree = createTemporaryDirectory('history-comment-rules-scope-');

  for (const probe of [...IN_SCOPE_PROBES, ...OUT_OF_SCOPE_PROBES]) {
    for (const [variant, lines] of [
      ['bad', HISTORY_TEXT],
      ['good', WHY_TEXT],
    ] as const) {
      const file = join(tree, probeFile(probe, variant));
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, probeText(probe, lines));
    }
  }

  const result = spawnSync(
    'semgrep',
    [
      '--metrics=off',
      '--quiet',
      '--json',
      ...RULE_FILES.flatMap((file) => ['--config', join(ROOT, file)]),
      tree,
    ],
    { encoding: 'utf8', cwd: tree, maxBuffer: 64 * 1024 * 1024 },
  );
  const report = JSON.parse(result.stdout) as { results: { path: string; check_id: string }[] };

  fired = new Map();

  for (const finding of report.results) {
    const path = finding.path.replace(`${tree}/`, '');
    fired.set(path, (fired.get(path) ?? new Set()).add(finding.check_id.split('.').pop() ?? ''));
  }
}, 180000);

afterAll(removeTemporaryDirectories);

describe('the comment-history rules read the trees they are meant to', () => {
  it.each(IN_SCOPE_PROBES)('fire on a history comment in $path ($marker comments)', (probe) => {
    const expected = probe.marker === '#' ? SHELL_RULES : SLASH_RULES;

    expect(firedRules(probe, 'bad')).toEqual([...expected].sort());
  });

  it.each(IN_SCOPE_PROBES)('stay quiet on a comment that states why in $path', (probe) => {
    expect(firedRules(probe, 'good')).toEqual([]);
  });

  it.each(OUT_OF_SCOPE_PROBES)('leave $path ($marker comments) alone', (probe) => {
    expect(firedRules(probe, 'bad')).toEqual([]);
  });
});
