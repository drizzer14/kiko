import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// scripts/checks/plist.sh computes its ROOT as scripts/checks/../.., so each
// case runs a COPY of it inside a throwaway root whose Info.plist the test
// controls.
const REPOSITORY_ROOT = join(__dirname, '..');
const SCRIPT = join(REPOSITORY_ROOT, 'scripts/checks/plist.sh');
const LIB = join(REPOSITORY_ROOT, 'scripts/checks/_lib.sh');
const REAL_INFO_PLIST = readFileSync(join(REPOSITORY_ROOT, 'ios/Kiko/Info.plist'), 'utf8');

const PROJECT_PATH = 'ios/Kiko.xcodeproj/project.pbxproj';

const createdPaths: string[] = [];

const writeFile = (root: string, relativePath: string, body: string): void => {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, body);
};

const PROJECT_FILE = [
  'name = "Inject Debug-only ATS local networking";',
  '862F59B3640A40159C5B4910 /* InfoPlist.strings in Resources */ = {isa = PBXBuildFile; };',
  'path = Kiko/en.lproj/InfoPlist.strings;',
  'path = Kiko/uk.lproj/InfoPlist.strings;',
  '/* Begin PBXResourcesBuildPhase section */',
  '0000000000000000000000AA /* InfoPlist.strings in Resources */,',
  '/* End PBXResourcesBuildPhase section */',
  '',
].join('\n');

const PRIVACY_MANIFEST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '<key>NSPrivacyAccessedAPITypes</key>',
  '<array>',
  '<dict><key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryDiskSpace</string><key>NSPrivacyAccessedAPITypeReasons</key><array><string>E174.1</string></array></dict>',
  '</array>',
  '</dict>',
  '</plist>',
  '',
].join('\n');

// Every root is valid on every assertion but the one a case breaks, so the
// Info.plist is the only thing a case varies.
const buildRoot = (infoPlist: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'kiko-plist-ipad-'));
  createdPaths.push(root);
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'scripts/checks/plist.sh'));
  copyFileSync(LIB, join(root, 'scripts/checks/_lib.sh'));
  writeFile(root, 'ios/Kiko/Info.plist', infoPlist);
  writeFile(root, PROJECT_PATH, PROJECT_FILE);
  writeFile(root, 'ios/Kiko/en.lproj/InfoPlist.strings', '"CFBundleDisplayName" = "Kiko";\n');
  writeFile(root, 'ios/Kiko/uk.lproj/InfoPlist.strings', '"CFBundleDisplayName" = "Кіко";\n');
  writeFile(root, 'ios/Kiko/PrivacyInfo.xcprivacy', PRIVACY_MANIFEST);
  writeFile(root, 'package.json', '{ "dependencies": {} }\n');
  writeFile(root, '.env', '');
  mkdirSync(join(root, 'src'), { recursive: true });

  return root;
};

const runPlistCheck = (infoPlist: string) =>
  spawnSync('bash', [join(buildRoot(infoPlist), 'scripts/checks/plist.sh')], {
    encoding: 'utf8',
  });

// Throws when the real plist lacks the pattern, so a case cannot pass by
// mutating nothing.
const replaceOnce = (source: string, pattern: RegExp, replacement: string): string => {
  if (!pattern.test(source)) {
    throw new Error(`Info.plist does not match: ${pattern}`);
  }

  return source.replace(pattern, replacement);
};

afterEach(() => {
  createdPaths.splice(0).forEach((path) => {
    rmSync(path, { recursive: true, force: true });
  });
});

describe('scripts/checks/plist.sh iPad scene keys', () => {
  it('passes on the real Info.plist', () => {
    const result = runPlistCheck(REAL_INFO_PLIST);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it.each([
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
  ])('fails (exit 2) naming %s when the iPad orientations lack it', (orientation) => {
    const result = runPlistCheck(
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

  it.each(['true', 'false'])('fails (exit 2) when UIRequiresFullScreen is <%s/>', (value) => {
    const result = runPlistCheck(
      replaceOnce(
        REAL_INFO_PLIST,
        /<key>UIViewControllerBasedStatusBarAppearance<\/key>/,
        `<key>UIRequiresFullScreen</key>\n\t<${value}/>\n\t<key>UIViewControllerBasedStatusBarAppearance</key>`,
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('UIRequiresFullScreen must be absent');
  });

  it('fails (exit 2) when UIApplicationSceneManifest is absent', () => {
    const result = runPlistCheck(
      replaceOnce(
        REAL_INFO_PLIST,
        /<key>UIApplicationSceneManifest<\/key>\s*<dict>[\s\S]*?<\/array>\s*<\/dict>\s*<\/dict>\s*/,
        '',
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('UIApplicationSceneManifest is missing');
  });

  it('fails (exit 2) when UIApplicationSupportsMultipleScenes is true', () => {
    const result = runPlistCheck(
      replaceOnce(
        REAL_INFO_PLIST,
        /(<key>UIApplicationSupportsMultipleScenes<\/key>\s*)<false\/>/,
        '$1<true/>',
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('UIApplicationSupportsMultipleScenes must be false');
  });

  it('fails (exit 2) when no launch screen key is declared', () => {
    const result = runPlistCheck(
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
  });
});
