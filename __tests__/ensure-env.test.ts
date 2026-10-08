import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// scripts/ensure-env.js is the `postinstall` step that gives a fresh
// checkout, worktree, or CI a working `.env` with no manual step
// (react-native-dotenv and Jest both read it). Runs against a temp
// directory via KIKO_ENSURE_ENV_ROOT (an override seam; the real
// `postinstall` invocation never sets it, so it defaults to the repo root).
const SCRIPT = join(__dirname, '../scripts/ensure-env.js');

const EXAMPLE_CONTENT =
  '# example\nFIRST_KEY=https://first.example\nSECOND_KEY=https://second.example\n';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ensure-env-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (): SpawnSyncReturns<string> =>
  spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, KIKO_ENSURE_ENV_ROOT: dir },
  });

describe('scripts/ensure-env.js', () => {
  it('copies .env.example whole when .env is missing', () => {
    writeFileSync(join(dir, '.env.example'), EXAMPLE_CONTENT);

    const result = run();

    expect(result.status).toBe(0);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(EXAMPLE_CONTENT);
  });

  it('appends a key missing from an existing .env, never overwriting an existing value', () => {
    writeFileSync(join(dir, '.env.example'), EXAMPLE_CONTENT);
    writeFileSync(join(dir, '.env'), 'FIRST_KEY=https://local-override.example\n');

    const result = run();

    expect(result.status).toBe(0);
    const written = readFileSync(join(dir, '.env'), 'utf8');
    expect(written).toContain('FIRST_KEY=https://local-override.example');
    expect(written).toContain('SECOND_KEY=https://second.example');
  });

  it('leaves an .env untouched when it already has every example key', () => {
    writeFileSync(join(dir, '.env.example'), EXAMPLE_CONTENT);
    writeFileSync(join(dir, '.env'), EXAMPLE_CONTENT);

    const result = run();

    expect(result.status).toBe(0);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(EXAMPLE_CONTENT);
  });
});
