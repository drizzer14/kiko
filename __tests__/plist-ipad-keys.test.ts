import { join } from 'node:path';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { buildPlistRoot, runPlistCheck } from './test-support/plist-root';

const REAL_INFO_PLIST = readFileSync(join(__dirname, '../ios/Kiko/Info.plist'), 'utf8');

const runInfoPlistCheck = (infoPlist: string) => runPlistCheck(buildPlistRoot({ infoPlist }));

// Throws when the real plist lacks the pattern, so a case cannot pass by
// mutating nothing.
const replaceOnce = (source: string, pattern: RegExp, replacement: string): string => {
  if (!pattern.test(source)) {
    throw new Error(`Info.plist does not match: ${pattern}`);
  }

  return source.replace(pattern, replacement);
};

const withFullScreenKey = (key: string, value: string): string =>
  replaceOnce(
    REAL_INFO_PLIST,
    /<key>UIViewControllerBasedStatusBarAppearance<\/key>/,
    `<key>${key}</key>\n\t<${value}/>\n\t<key>UIViewControllerBasedStatusBarAppearance</key>`,
  );

afterEach(removeTemporaryDirectories);

describe('scripts/checks/plist.sh iPad scene keys', () => {
  it('passes on the real Info.plist', () => {
    const result = runInfoPlistCheck(REAL_INFO_PLIST);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it.each([
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
  ])('fails (exit 2) naming %s when the iPad orientations lack it', (orientation) => {
    const result = runInfoPlistCheck(
      replaceOnce(
        REAL_INFO_PLIST,
        new RegExp(
          `(<key>UISupportedInterfaceOrientations~ipad</key>[\\s\\S]*?)\\s*<string>${orientation}</string>`,
        ),
        '$1',
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      `UISupportedInterfaceOrientations~ipad is missing ${orientation}`,
    );
  });

  it('fails (exit 2) when the iPad orientations key is absent entirely', () => {
    const result = runInfoPlistCheck(
      replaceOnce(
        REAL_INFO_PLIST,
        /<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>[\s\S]*?<\/array>\s*/,
        '',
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('UISupportedInterfaceOrientations~ipad is missing from');
    expect(result.stderr).not.toContain('is not a valid property list');
  });

  it.each([
    ['UIRequiresFullScreen', 'true'],
    ['UIRequiresFullScreen', 'false'],
    ['UIRequiresFullScreen~ipad', 'true'],
    ['UIRequiresFullScreen~ipad', 'false'],
  ])('fails (exit 2) when %s is <%s/>', (key, value) => {
    const result = runInfoPlistCheck(withFullScreenKey(key, value));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('UIRequiresFullScreen must be absent');
    expect(result.stderr).not.toContain('is not a valid property list');
  });

  it('fails (exit 2) when UIApplicationSceneManifest is absent', () => {
    const result = runInfoPlistCheck(
      replaceOnce(
        REAL_INFO_PLIST,
        /<key>UIApplicationSceneManifest<\/key>\s*<dict>[\s\S]*?<\/array>\s*<\/dict>\s*<\/dict>\s*/,
        '',
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('UIApplicationSceneManifest is missing');
    expect(result.stderr).not.toContain('is not a valid property list');
  });

  it('fails (exit 2) when UIApplicationSupportsMultipleScenes is true', () => {
    const result = runInfoPlistCheck(
      replaceOnce(
        REAL_INFO_PLIST,
        /(<key>UIApplicationSupportsMultipleScenes<\/key>\s*)<false\/>/,
        '$1<true/>',
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('UIApplicationSupportsMultipleScenes must be false');
  });

  it('fails (exit 2) when UIApplicationSupportsMultipleScenes is absent', () => {
    const result = runInfoPlistCheck(
      replaceOnce(
        REAL_INFO_PLIST,
        /<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\/>\s*/,
        '',
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('UIApplicationSupportsMultipleScenes must be false');
    expect(result.stderr).toContain("found: 'missing'");
    expect(result.stderr).not.toContain('is not a valid property list');
  });

  it('fails (exit 2) when no launch screen key is declared', () => {
    const result = runInfoPlistCheck(
      replaceOnce(
        REAL_INFO_PLIST,
        /<key>UILaunchStoryboardName<\/key>\s*<string>[^<]*<\/string>\s*/,
        '',
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'none of UILaunchStoryboardName, UILaunchStoryboards, UILaunchScreen, UILaunchScreens is declared',
    );
    expect(result.stderr).not.toContain('is not a valid property list');
  });

  // The top-level key read is the one `node` call that cannot be told from a missing key: a stub
  // that fails only that call proves the check fails closed rather than passing on no keys.
  it('fails closed (exit 2) when the top-level keys of Info.plist cannot be read', () => {
    const stubDirectory = createTemporaryDirectory('kiko-plist-node-stub-');
    const stub = join(stubDirectory, 'node');
    writeFileSync(
      stub,
      [
        '#!/bin/sh',
        `case "$*" in *'Object.keys(JSON.parse(input))'*) exit 1 ;; esac`,
        `exec '${process.execPath}' "$@"`,
        '',
      ].join('\n'),
    );
    chmodSync(stub, 0o755);

    const result = runPlistCheck(buildPlistRoot({ infoPlist: REAL_INFO_PLIST }), {
      ...process.env,
      PATH: `${stubDirectory}:${process.env.PATH}`,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('could not read the top-level keys of ios/Kiko/Info.plist');
    expect(result.stderr).not.toContain('UIRequiresFullScreen must be absent');
  });

  it('passes when the launch screen key carries a device modifier', () => {
    const result = runInfoPlistCheck(
      replaceOnce(
        REAL_INFO_PLIST,
        /<key>UILaunchStoryboardName<\/key>/,
        '<key>UILaunchStoryboardName~ipad</key>',
      ),
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
