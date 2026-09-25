import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/lint.sh (the fast-tier Biome wrapper, run per-file on every
// Edit/Write/MultiEdit) must not fail a file biome.json deliberately excludes
// from linting entirely (biome.json's files.includes: "!rules/fixtures") —
// Biome reports "No files were processed in the specified paths." with a
// non-zero exit for such a target, which is Biome saying "out of scope", not
// "found a violation". Before this fix, lint.sh treated that message as a
// lint failure, so editing ANY fixture under rules/fixtures/ tripped a false
// "Biome (lint + format)" failure block on every save.
//
// Biome prints that EXACT SAME message for a path that does not exist at all
// (internalError/io, swallowed underneath it) — so the check must not treat
// every occurrence of the message as "out of scope"; it must fail closed for
// a target that simply isn't there.
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

  it('fails closed for a nonexistent path instead of reading it as excluded', () => {
    const result: SpawnSyncReturns<string> = spawnSync(
      'bash',
      [SCRIPT, join(__dirname, '../src/does-not-exist.ts')],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED');
  });

  it('fails for a real file with a lint violation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kiko-lint-violation-'));
    const target = join(directory, 'violation.ts');
    writeFileSync(target, 'export const bad = (value: any) => value;\n');

    const result: SpawnSyncReturns<string> = spawnSync('bash', [SCRIPT, target], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED');
  });
});
