import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/security.sh (the fast-tier per-file Semgrep security wrapper)
// must never fail a POSITIVE fixture under rules/fixtures/ — that file is
// deliberately vulnerable/violating code, proven by
// scripts/checks/semgrep-rules.sh on purpose. The script's own `--exclude
// 'fixtures'` flag only prunes that directory while WALKING a tree; passed a
// direct single-file target (the fast-tier hook's own shape), semgrep still
// scans it, so any positive fixture used to fail this hook on every edit.
const SCRIPT = join(__dirname, '../scripts/checks/security.sh');

describe('scripts/checks/security.sh', () => {
  it('exits 0 for a positive fixture file under rules/fixtures/', () => {
    const result: SpawnSyncReturns<string> = spawnSync(
      'bash',
      [SCRIPT, join(__dirname, '../rules/fixtures/kiko-no-history-id-comment.bad.ts')],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
