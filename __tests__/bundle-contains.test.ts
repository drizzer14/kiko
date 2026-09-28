import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

const SCRIPT = join(__dirname, '../scripts/bundle-contains.js');

const CYRILLIC = 'Кіко';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'bundle-contains-test-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const writeBundle = (content: Buffer): string => {
  const bundlePath = join(directory, 'main.jsbundle');
  writeFileSync(bundlePath, content);

  return bundlePath;
};

// Bytes on both sides of the string mimic the binary Hermes bundle around it.
const surround = (inner: Buffer): Buffer =>
  Buffer.concat([Buffer.from([0x00, 0xff, 0x13]), inner, Buffer.from([0x07, 0x00])]);

const run = (...parameters: string[]): SpawnSyncReturns<string> =>
  spawnSync('node', [SCRIPT, ...parameters], { encoding: 'utf8' });

describe('scripts/bundle-contains.js', () => {
  it('exits 0 when an ASCII string is in the bundle', () => {
    const bundlePath = writeBundle(surround(Buffer.from('netWorthTitle', 'utf8')));

    expect(run(bundlePath, 'netWorthTitle').status).toBe(0);
  });

  it('exits 1 when an ASCII string is not in the bundle', () => {
    const bundlePath = writeBundle(surround(Buffer.from('netWorthTitle', 'utf8')));

    expect(run(bundlePath, 'debtsTitle').status).toBe(1);
  });

  it('exits 0 when a Cyrillic string is stored as UTF-16LE', () => {
    const bundlePath = writeBundle(surround(Buffer.from(CYRILLIC, 'utf16le')));

    expect(run(bundlePath, CYRILLIC).status).toBe(0);
  });

  it('exits 0 when a Cyrillic string is stored as UTF-8', () => {
    const bundlePath = writeBundle(surround(Buffer.from(CYRILLIC, 'utf8')));

    expect(run(bundlePath, CYRILLIC).status).toBe(0);
  });

  it('exits 1 when a Cyrillic string is absent from a UTF-16LE bundle', () => {
    const bundlePath = writeBundle(surround(Buffer.from('Борги', 'utf16le')));

    expect(run(bundlePath, CYRILLIC).status).toBe(1);
  });

  it('exits 2 when the bundle file is missing', () => {
    const result = run(join(directory, 'absent.jsbundle'), CYRILLIC);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('absent.jsbundle');
  });

  it('exits 2 when the search string is missing', () => {
    const bundlePath = writeBundle(surround(Buffer.from('netWorthTitle', 'utf8')));

    expect(run(bundlePath).status).toBe(2);
  });
});
