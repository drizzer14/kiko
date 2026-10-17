import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { createTemporaryDirectory } from './temporary-directory';

// scripts/checks/plist.sh computes its ROOT as scripts/checks/../.., so each
// case runs a COPY of it inside a throwaway root whose files the test controls.
const REPOSITORY_ROOT = join(__dirname, '../..');
const SCRIPT = join(REPOSITORY_ROOT, 'scripts/checks/plist.sh');
const LIB = join(REPOSITORY_ROOT, 'scripts/checks/_lib.sh');

const INFO_PLIST = 'ios/Kiko/Info.plist';
export const PROJECT_PATH = 'ios/Kiko.xcodeproj/project.pbxproj';
const ENGLISH_NAME_TABLE = 'ios/Kiko/en.lproj/InfoPlist.strings';
export const UKRAINIAN_NAME_TABLE = 'ios/Kiko/uk.lproj/InfoPlist.strings';
export const PRIVACY_MANIFEST = 'ios/Kiko/PrivacyInfo.xcprivacy';

const BOTH_DISK_SPACE_SOURCES =
  '{ "dependencies": { "react-native-fs": "2.20.0", "@op-engineering/op-sqlite": "18.1.4" } }\n';

const writeFile = (root: string, relativePath: string, body: string): void => {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, body);
};

// The PBXBuildFile line also says "in Resources", so only an entry inside the
// Resources build phase section proves the build copies the tables.
export const projectFile = (
  nameTables: string[],
  resourcesPhaseFiles: string[] = ['InfoPlist.strings'],
): string =>
  [
    'name = "Inject Debug-only ATS local networking";',
    '862F59B3640A40159C5B4910 /* InfoPlist.strings in Resources */ = {isa = PBXBuildFile; };',
    ...nameTables.map((table) => `path = Kiko/${table}.lproj/InfoPlist.strings;`),
    '/* Begin PBXResourcesBuildPhase section */',
    ...resourcesPhaseFiles.map((file) => `0000000000000000000000AA /* ${file} in Resources */,`),
    '/* End PBXResourcesBuildPhase section */',
    '',
  ].join('\n');

export const privacyManifest = (categories: string[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '<key>NSPrivacyAccessedAPITypes</key>',
    '<array>',
    ...categories.map(
      (category) =>
        `<dict><key>NSPrivacyAccessedAPIType</key><string>${category}</string><key>NSPrivacyAccessedAPITypeReasons</key><array><string>E174.1</string></array></dict>`,
    ),
    '</array>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

type PlistRootOptions = {
  infoPlist: string;
  environment?: string;
  client?: string;
  // An override replaces a file's body, and `null` deletes the file.
  overrides?: Record<string, string | null>;
};

// Every root starts valid on every assertion but the one a case breaks.
export const buildPlistRoot = ({
  infoPlist,
  environment = '',
  client,
  overrides = {},
}: PlistRootOptions): string => {
  const root = createTemporaryDirectory('kiko-plist-');
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'scripts/checks/plist.sh'));
  copyFileSync(LIB, join(root, 'scripts/checks/_lib.sh'));
  writeFile(root, INFO_PLIST, infoPlist);
  writeFile(root, PROJECT_PATH, projectFile(['en', 'uk']));
  writeFile(root, ENGLISH_NAME_TABLE, '"CFBundleDisplayName" = "Kiko";\n');
  writeFile(root, UKRAINIAN_NAME_TABLE, '"CFBundleDisplayName" = "Кіко";\n');
  writeFile(root, PRIVACY_MANIFEST, privacyManifest(['NSPrivacyAccessedAPICategoryDiskSpace']));
  writeFile(root, 'package.json', BOTH_DISK_SPACE_SOURCES);
  writeFile(root, '.env', environment);
  mkdirSync(join(root, 'src'), { recursive: true });

  if (client !== undefined) {
    writeFile(root, 'src/quotes.client.ts', client);
  }

  for (const [relativePath, body] of Object.entries(overrides)) {
    if (body === null) {
      rmSync(join(root, relativePath));
    } else {
      writeFile(root, relativePath, body);
    }
  }

  return root;
};

export const runPlistCheck = (root: string, environment: NodeJS.ProcessEnv = process.env) =>
  spawnSync('bash', [join(root, 'scripts/checks/plist.sh')], {
    encoding: 'utf8',
    env: environment,
  });
