import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

import { run, ranged, writeReport } from './test-support/mutation-score-report';

// A mutant that times out on jest's related-test load proves nothing about behavior, so
// scripts/checks/mutation-score.js fails a graded file whose Timeout share of the detected
// mutants (killed + timeout) is above 50 percent when it has at least 3 of them, whatever the
// total and the floor say. The three runs below are per-file status counts of real gate logs
// (files without a mutant are left out, as Stryker leaves them out of its report), kept as
// constants and never read from a live report.
type Counts = Record<string, number>;

const BINANCE_FOLLOWUP: Record<string, Counts> = {
  'src/crypto-sync/binance/binance.history-budget.ts': { Killed: 2, Timeout: 23 },
  'src/crypto-sync/binance/binance.history-depth.ts': { Killed: 12, Timeout: 82, Survived: 5 },
  'src/crypto-sync/binance/binance.history-paging.ts': {
    Killed: 29,
    Timeout: 173,
    Survived: 11,
    NoCoverage: 5,
  },
  'src/crypto-sync/binance/binance.history-records.ts': { Killed: 1, Timeout: 12 },
  'src/crypto-sync/binance/binance.history-walk.ts': { Killed: 21, Timeout: 99, Survived: 1 },
  'src/crypto-sync/binance/binance.transactions.ts': { Killed: 6 },
  'src/crypto-sync/binance/binance.transfer-history.ts': { Killed: 2, Timeout: 11 },
  'src/holdings/holding-metadata/holding-metadata.ts': { Killed: 12, Timeout: 8, Survived: 1 },
  'src/loans/payment-matcher/payment-matcher.ts': { Killed: 4 },
  'src/screens/account-detail/crypto-sync-section/binance-history-status.ts': {
    Killed: 28,
    Survived: 1,
  },
  'src/transactions/repo/transactions.repo.ts': { Killed: 3 },
};

const HELP_FLOWS: Record<string, Counts> = {
  'src/design-system/components/large-title-heading/large-title-heading.component.tsx': {
    Killed: 7,
    Timeout: 12,
  },
  'src/design-system/components/large-title-heading/use-large-title-scroll.ts': {
    Killed: 13,
    Timeout: 6,
    Survived: 1,
  },
  'src/design-system/components/text/text.component.tsx': { Timeout: 4 },
  'src/navigation/fitting-large-title/fitting-large-title.component.tsx': {
    Killed: 43,
    Survived: 1,
  },
  'src/navigation/fitting-large-title/title-fit.ts': { Killed: 45, Survived: 1 },
  'src/navigation/fitting-large-title/title-measurer/title-measurer.component.tsx': { Killed: 2 },
  'src/navigation/fitting-large-title/use-title-fit.tsx': { Killed: 14, Survived: 1 },
  'src/navigation/home-stack/home.stack.tsx': { Killed: 2 },
  'src/navigation/large-title-screen-options/large-title-screen-options.ts': { Killed: 8 },
};

const H7_SET2: Record<string, Counts> = {
  'src/auth/biometrics.ts': { Killed: 9, Survived: 1 },
  'src/auth/lock-gate/lock-gate.component.tsx': { Killed: 10 },
  'src/crypto-sync/binance/binance.history-paging.ts': { Timeout: 16 },
  'src/screens/column-mapping/column-mapping.screen.tsx': { Killed: 5, Survived: 1 },
  'src/screens/forms/category-rule-form/use-save-rule/use-save-rule.ts': { Killed: 6, Survived: 1 },
};

const heavyLines = (stdout: string): string[] =>
  stdout.split('\n').filter((line) => line.startsWith('TIMEOUT-HEAVY '));

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'kiko-mutation-score-timeouts-'));
});

describe('mutation-score.js: the TIMEOUT-HEAVY rule on measured gate runs', () => {
  it.each([
    [
      'binance-followup cd10464c',
      BINANCE_FOLLOWUP,
      'CHANGE SET TOTAL: 95.65 killed=120 timeout=408 survived=19 noCoverage=5',
      [
        'TIMEOUT-HEAVY src/crypto-sync/binance/binance.history-budget.ts: timeout 23 of 25 detected (92.0 %), killed 2, score without timeouts 8.00 < 60',
        'TIMEOUT-HEAVY src/crypto-sync/binance/binance.history-depth.ts: timeout 82 of 94 detected (87.2 %), killed 12, score without timeouts 12.12 < 60',
        'TIMEOUT-HEAVY src/crypto-sync/binance/binance.history-paging.ts: timeout 173 of 202 detected (85.6 %), killed 29, score without timeouts 13.30 < 60',
        'TIMEOUT-HEAVY src/crypto-sync/binance/binance.history-records.ts: timeout 12 of 13 detected (92.3 %), killed 1, score without timeouts 7.69 < 60',
        'TIMEOUT-HEAVY src/crypto-sync/binance/binance.history-walk.ts: timeout 99 of 120 detected (82.5 %), killed 21, score without timeouts 17.36 < 60',
        'TIMEOUT-HEAVY src/crypto-sync/binance/binance.transfer-history.ts: timeout 11 of 13 detected (84.6 %), killed 2, score without timeouts 15.38 < 60',
      ],
    ],
    [
      'help-flows-t4',
      HELP_FLOWS,
      'CHANGE SET TOTAL: 97.50 killed=134 timeout=22 survived=4 noCoverage=0',
      [
        'TIMEOUT-HEAVY src/design-system/components/large-title-heading/large-title-heading.component.tsx: timeout 12 of 19 detected (63.2 %), killed 7, score without timeouts 36.84 < 60',
        'TIMEOUT-HEAVY src/design-system/components/text/text.component.tsx: timeout 4 of 4 detected (100.0 %), killed 0, score without timeouts 0.00 < 60',
      ],
    ],
    [
      'h7-set2',
      H7_SET2,
      'CHANGE SET TOTAL: 93.88 killed=30 timeout=16 survived=3 noCoverage=0',
      [
        'TIMEOUT-HEAVY src/crypto-sync/binance/binance.history-paging.ts: timeout 16 of 16 detected (100.0 %), killed 0, score without timeouts 0.00 < 60',
      ],
    ],
  ])('fails %s on exactly its heavy files, total line unchanged', (_name, files, total, heavy) => {
    const result = run(writeReport(directory, files), ranged(...Object.keys(files)));

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(total);
    expect(heavyLines(result.stdout)).toEqual(heavy);
  });

  it('keeps the per-file row of a heavy file as it was', () => {
    const result = run(writeReport(directory, H7_SET2), ranged(...Object.keys(H7_SET2)));

    expect(result.stdout).toContain(
      'src/crypto-sync/binance/binance.history-paging.ts: 100.00 killed=0 timeout=16 survived=0 noCoverage=0',
    );
  });

  it('names no file that is under the share or under the minimum', () => {
    const result = run(
      writeReport(directory, BINANCE_FOLLOWUP),
      ranged(...Object.keys(BINANCE_FOLLOWUP)),
    );

    expect(result.stdout).not.toContain('TIMEOUT-HEAVY src/holdings/holding-metadata');
    expect(result.stdout).not.toContain('TIMEOUT-HEAVY src/transactions');
  });

  it('prints the two thresholds on the GATE line', () => {
    const result = run(writeReport(directory, H7_SET2), ranged(...Object.keys(H7_SET2)));

    expect(result.stdout).toContain(
      'GATE: change set >= 75, each file >= 60, a file fails TIMEOUT-HEAVY when timeout > 50% of detected and >= 3',
    );
  });

  it('prints the heavy lines after the GATE line, in row order', () => {
    const result = run(writeReport(directory, HELP_FLOWS), ranged(...Object.keys(HELP_FLOWS)));
    const lines = result.stdout.split('\n');
    const gate = lines.findIndex((line) => line.startsWith('GATE: '));

    expect(lines.slice(gate + 1, gate + 3).map((line) => line.slice(0, 20))).toEqual([
      'TIMEOUT-HEAVY src/de',
      'TIMEOUT-HEAVY src/de',
    ]);
    expect(lines.slice(0, gate).some((line) => line.startsWith('TIMEOUT-HEAVY'))).toBe(false);
  });
});

describe('mutation-score.js: the TIMEOUT-HEAVY boundary', () => {
  it.each([
    ['K3 T3: 50 percent is not above the share', { Killed: 3, Timeout: 3 }, false],
    ['K2 T3: 60 percent with the minimum met', { Killed: 2, Timeout: 3 }, true],
    ['K0 T2: under the minimum', { Timeout: 2 }, false],
    ['K0 T3: the minimum with every detection a timeout', { Timeout: 3 }, true],
    ['K1 T2: under the minimum although above the share', { Killed: 1, Timeout: 2 }, false],
  ])('%s', (_name, counts, heavy) => {
    const result = run(writeReport(directory, { 'src/a.ts': counts }), ranged('src/a.ts'));

    expect(heavyLines(result.stdout).length).toBe(heavy ? 1 : 0);
    expect(result.code).toBe(heavy ? 1 : 0);
  });

  it('prints the boundary figures of a K2 T3 file', () => {
    const result = run(
      writeReport(directory, { 'src/a.ts': { Killed: 2, Timeout: 3 } }),
      ranged('src/a.ts'),
    );

    expect(heavyLines(result.stdout)).toEqual([
      'TIMEOUT-HEAVY src/a.ts: timeout 3 of 5 detected (60.0 %), killed 2, score without timeouts 40.00 < 60',
    ]);
  });

  it('fails on one heavy file although the change-set total and every floor pass', () => {
    const result = run(
      writeReport(directory, {
        'src/heavy.ts': { Killed: 2, Timeout: 3 },
        'src/strong.ts': { Killed: 500 },
      }),
      ranged('src/heavy.ts', 'src/strong.ts'),
    );

    expect(result.stdout).toContain('src/heavy.ts: 100.00 killed=2 timeout=3');
    expect(result.stdout).toContain('CHANGE SET TOTAL: 100.00');
    expect(result.code).toBe(1);
    expect(heavyLines(result.stdout)).toHaveLength(1);
  });

  it('never grades an excluded file as TIMEOUT-HEAVY', () => {
    const result = run(
      writeReport(directory, {
        'src/db/schema.ts': { Timeout: 40 },
        'src/a.ts': { Killed: 10 },
      }),
      ranged('src/db/schema.ts', 'src/a.ts'),
    );

    expect(result.code).toBe(0);
    expect(heavyLines(result.stdout)).toEqual([]);
  });
});
