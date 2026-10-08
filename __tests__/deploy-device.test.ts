import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/deploy-device.sh runs from a temp copy of the repo layout, with stub
// xcodebuild/xcrun/sleep first on PATH, so no build or device is ever touched.
const SCRIPTS = join(__dirname, '../scripts');

const APP_DIRECTORY = 'ios/build/Build/Products/Release-AdHoc-iphoneos/Kiko.app';

const XCODEBUILD_STUB = ['#!/bin/bash', 'echo "** BUILD SUCCEEDED **"'].join('\n');

const SLEEP_STUB = ['#!/bin/bash', 'printf "sleep %s\\n" "$*" >> "$KIKO_STUB_LOG"'].join('\n');

// Each launch attempt takes the next comma-separated outcome ("ok" or "fail").
const XCRUN_STUB = [
  '#!/bin/bash',
  'printf "%s\\n" "$*" >> "$KIKO_STUB_LOG"',
  'case "$*" in',
  '  *"device install app"*)',
  '    echo "databaseUUID: 0A1B2C3D-0000-4000-8000-00000000ABCD" ;;',
  '  *"device process launch"*)',
  '    attempt=$(grep -c "process launch" "$KIKO_STUB_LOG")',
  '    outcome=$(echo "$KIKO_STUB_LAUNCH_OUTCOMES" | cut -d, -f"$attempt")',
  '    if [[ "$outcome" == "ok" ]]; then',
  '      echo "Launched application with com.dmytro-vasylkivskyi.kiko bundle identifier."',
  '    else',
  '      echo "ERROR: The operation could not be completed."',
  '      exit 1',
  '    fi ;;',
  'esac',
].join('\n');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'deploy-device-test-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'stub-bin'));

  for (const script of ['deploy-device.sh', 'bundle-contains.js']) {
    copyFileSync(join(SCRIPTS, script), join(root, 'scripts', script));
  }

  const stubs = { xcodebuild: XCODEBUILD_STUB, xcrun: XCRUN_STUB, sleep: SLEEP_STUB };

  for (const [name, content] of Object.entries(stubs)) {
    writeFileSync(join(root, 'stub-bin', name), `${content}\n`, { mode: 0o755 });
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const logPath = (): string => join(root, 'stub.log');

const writeBundle = (content: Buffer): void => {
  mkdirSync(join(root, APP_DIRECTORY), { recursive: true });
  writeFileSync(join(root, APP_DIRECTORY, 'main.jsbundle'), content);
};

const stubCalls = (fragment: string): string[] =>
  existsSync(logPath())
    ? readFileSync(logPath(), 'utf8')
        .split('\n')
        .filter((line) => line.includes(fragment))
    : [];

// Dropped so a value in the shell that runs jest cannot turn the check on.
const { EXPECT_BUNDLE_STRING: _callerBundleString, ...callerEnvironment } = process.env;

const deploy = (
  launchOutcomes: string,
  bundleCheck: Record<string, string> = {},
): SpawnSyncReturns<string> =>
  spawnSync('bash', [join(root, 'scripts', 'deploy-device.sh'), 'STUB-DEVICE'], {
    encoding: 'utf8',
    env: {
      ...callerEnvironment,
      PATH: `${join(root, 'stub-bin')}:${process.env.PATH ?? ''}`,
      KIKO_STUB_LOG: logPath(),
      KIKO_STUB_LAUNCH_OUTCOMES: launchOutcomes,
      ...bundleCheck,
    },
  });

const CYRILLIC_CHECK = { EXPECT_BUNDLE_STRING: 'Кіко' };

describe('scripts/deploy-device.sh launch', () => {
  it('launches once when the first launch succeeds', () => {
    const result = deploy('ok');

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('Launch retry');
    expect(stubCalls('process launch')).toHaveLength(1);
    expect(stubCalls('sleep')).toHaveLength(0);
  });

  it('retries the launch once, 3 s after a failed first launch', () => {
    const result = deploy('fail,ok');

    const firstFailure = result.stdout.indexOf('ERROR: The operation could not be completed.');

    expect(result.status).toBe(0);
    expect(firstFailure).toBeGreaterThan(-1);
    expect(firstFailure).toBeLessThan(result.stdout.indexOf('Launch retry'));
    expect(result.stdout).toContain('✓ App launched');
    expect(stubCalls('process launch')).toHaveLength(2);
    expect(stubCalls('sleep')).toEqual(['sleep 3']);
  });

  it('reports a failure only after the retry fails too', () => {
    const result = deploy('fail,fail');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Launch may have failed');
    expect(stubCalls('process launch')).toHaveLength(2);
  });
});

describe('scripts/deploy-device.sh build output', () => {
  it('reads BUILD SUCCEEDED on an early line of a build log far larger than a pipe buffer', () => {
    // The success marker sits on the first line of a log over the pipe buffer: a consumer that
    // stops reading at the first match must not turn that match into a failure.
    const largeLog = [
      '#!/bin/bash',
      'echo "** BUILD SUCCEEDED **"',
      'for line in $(seq 1 2000); do',
      '  printf "%s\\n" "CompileC padding line ........................................... $line"',
      'done',
    ].join('\n');
    writeFileSync(join(root, 'stub-bin', 'xcodebuild'), `${largeLog}\n`, { mode: 0o755 });

    const result = deploy('ok');

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('Build did not report success');
  });
});

describe('scripts/deploy-device.sh bundle check', () => {
  it('skips the check when EXPECT_BUNDLE_STRING is unset', () => {
    const result = deploy('ok');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Bundle check skipped (set EXPECT_BUNDLE_STRING)');
    expect(stubCalls('device install app')).toHaveLength(1);
  });

  it('skips the check when EXPECT_BUNDLE_STRING is empty', () => {
    const result = deploy('ok', { EXPECT_BUNDLE_STRING: '' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Bundle check skipped (set EXPECT_BUNDLE_STRING)');
  });

  it('installs when the bundle holds the string as UTF-16LE', () => {
    writeBundle(Buffer.from('Кіко', 'utf16le'));

    const result = deploy('ok', CYRILLIC_CHECK);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✓ Bundle contains Кіко');
    expect(stubCalls('device install app')).toHaveLength(1);
  });

  it('stops before install when the bundle is stale', () => {
    writeBundle(Buffer.from('old bundle', 'utf8'));

    const result = deploy('ok', CYRILLIC_CHECK);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FORCE_BUNDLING=1');
    expect(result.stdout).toContain('make clean-ios');
    expect(stubCalls('device install app')).toHaveLength(0);
  });

  it('stops before install when the bundle file is missing', () => {
    const result = deploy('ok', CYRILLIC_CHECK);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(join(APP_DIRECTORY, 'main.jsbundle'));
    expect(result.stdout).toContain('(status 2)');
    expect(stubCalls('device install app')).toHaveLength(0);
  });
});
