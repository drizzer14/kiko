import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdtempSync } from 'node:fs';

import {
  writeFile,
  runWithStub,
  writeStrykerStub,
  buildMutationRepository,
} from './test-support/mutation-repository';

// scripts/checks/mutation.sh gates a passing Stryker run on the CHANGE SET's own
// score (scripts/checks/mutation-score.js reads the json reporter's output).
// These drive the real wrapper against a stub Stryker that writes (or omits) a
// report, to prove the wrapper turns the scorer's verdict, and a missing or
// stale report, into its own exit code. The scorer's formula is tested directly
// in mutation-score.test.ts.
const REPORT_PATH = 'reports/mutation/mutation.json';

const freshProject = (): { temporaryDirectory: string; root: string } => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiko-mut-gate-'));
  const root = join(temporaryDirectory, 'project');
  buildMutationRepository(root, { 'src/changed.ts': 'export const changed = 1;\n' });

  return { temporaryDirectory, root };
};

const reportOf = (statuses: string[], scope: string[] = ['src/changed.ts']): string =>
  JSON.stringify({
    config: { mutate: scope },
    files: { 'src/changed.ts': { mutants: statuses.map((status) => ({ status })) } },
  });

const stubWritingReport = (report: string): string =>
  [
    '#!/usr/bin/env bash',
    'mkdir -p reports/mutation',
    `printf '%s' '${report}' > ${REPORT_PATH}`,
    'exit 0',
  ].join('\n');

describe('scripts/checks/mutation.sh change-set gate', () => {
  it('exits 2 and names the failing file when the change set scores below the gate', () => {
    const { temporaryDirectory } = freshProject();
    const bin = writeStrykerStub(
      temporaryDirectory,
      stubWritingReport(reportOf(['Killed', 'Survived', 'Survived', 'Survived'])),
    );

    const result = runWithStub(bin, temporaryDirectory, join(temporaryDirectory, 'calls'));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('src/changed.ts: 25.00');
    expect(result.stderr).toContain("CHANGE SET's own mutation score failed");
  });

  it('passes when the change set clears both thresholds', () => {
    const { temporaryDirectory } = freshProject();
    const bin = writeStrykerStub(
      temporaryDirectory,
      stubWritingReport(reportOf(['Killed', 'Killed', 'Killed', 'Survived'])),
    );

    const result = runWithStub(bin, temporaryDirectory, join(temporaryDirectory, 'calls'));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('CHANGE SET TOTAL: 75.00');
  });

  it('exits 2 when the report was written for a different run than this one', () => {
    const { temporaryDirectory } = freshProject();
    const bin = writeStrykerStub(
      temporaryDirectory,
      stubWritingReport(reportOf(['Killed', 'Killed', 'Killed', 'Killed'], ['src/other.ts'])),
    );

    const result = runWithStub(bin, temporaryDirectory, join(temporaryDirectory, 'calls'));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('does not belong to this run');
  });

  it('prints the thresholds from the scorer instead of restating them', () => {
    const { temporaryDirectory } = freshProject();
    const bin = writeStrykerStub(
      temporaryDirectory,
      stubWritingReport(reportOf(['Killed', 'Survived', 'Survived', 'Survived'])),
    );

    const result = runWithStub(bin, temporaryDirectory, join(temporaryDirectory, 'calls'));

    expect(result.stderr).toContain('GATE: change set >= 75, each file >= 60');
    expect(result.stderr).not.toContain('(75 total, 60 per file)');
  });

  it('treats exit 1 with no report as a crash and records nothing in the ETA history', () => {
    const { temporaryDirectory } = freshProject();
    const bin = writeStrykerStub(
      temporaryDirectory,
      '#!/usr/bin/env bash\nsleep 1\necho "No tests were executed"\nexit 1',
    );

    const result = runWithStub(bin, temporaryDirectory, join(temporaryDirectory, 'calls'));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('rather than completing a run');
    expect(result.stderr).toContain('No tests were executed');
    expect(result.stderr).not.toContain('sanity floor (Stryker');
    const progressLog = /tail -f (\S+)/.exec(result.stdout)?.[1] ?? '';
    expect(existsSync(progressLog.replace('progress.log', 'history.tsv'))).toBe(false);
  });

  it('exits 2 when Stryker passes but writes no report', () => {
    const { temporaryDirectory } = freshProject();
    const bin = writeStrykerStub(temporaryDirectory, '#!/usr/bin/env bash\nexit 0');

    const result = runWithStub(bin, temporaryDirectory, join(temporaryDirectory, 'calls'));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('wrote no JSON report');
  });

  it('never reads a stale report left by an earlier run', () => {
    const { temporaryDirectory, root } = freshProject();
    writeFile(root, REPORT_PATH, reportOf(['Killed', 'Killed', 'Killed', 'Killed']));
    const bin = writeStrykerStub(temporaryDirectory, '#!/usr/bin/env bash\nexit 0');

    const result = runWithStub(bin, temporaryDirectory, join(temporaryDirectory, 'calls'));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('wrote no JSON report');
  });
});
