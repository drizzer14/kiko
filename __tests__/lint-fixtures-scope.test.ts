import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/lint.sh (the fast-tier Biome wrapper, run per-file on every
// Edit/Write/MultiEdit) must not fail a file biome.json deliberately excludes
// from linting entirely (biome.json's files.includes: "!rules/fixtures") —
// Biome reports "No files were processed in the specified paths." with a
// non-zero exit for such a target, which is Biome saying "out of scope", not
// "found a violation". Before this fix, lint.sh treated that message as a
// lint failure, so editing ANY fixture under rules/fixtures/ tripped a false
// "Biome (lint + format)" failure block on every save.
const SCRIPT = join(__dirname, '../scripts/checks/lint.sh');

describe('scripts/checks/lint.sh', () => {
  it('exits 0 for a file biome.json excludes (rules/fixtures/**)', () => {
    const result: SpawnSyncReturns<string> = spawnSync(
      'bash',
      [SCRIPT, join(__dirname, '../rules/fixtures/kiko-no-switch.good.ts')],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
