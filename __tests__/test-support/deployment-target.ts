import path from 'node:path';
import { readFileSync } from 'node:fs';

// The minimum iOS a build file states, read as text. The guard in
// `__tests__/symbol-deployment-target.test.tsx` compares every one of them with
// the single DEPLOYMENT_TARGET constant, so the symbols it checks and the iOS
// the app is built for cannot disagree.
const IOS_ROOT = path.join(__dirname, '..', '..', 'ios');
const PROJECT_FILE = path.join(IOS_ROOT, 'Kiko.xcodeproj', 'project.pbxproj');
const PODFILE = path.join(IOS_ROOT, 'Podfile');

const PROJECT_TARGET = /IPHONEOS_DEPLOYMENT_TARGET = (\d+(?:\.\d+)*);/g;
const PODFILE_PLATFORM = /^platform :ios, ["'](\d+(?:\.\d+)*)["']/m;
const PODFILE_POD_FLOOR =
  /app_ios_deployment_target = Gem::Version\.new\(['"](\d+(?:\.\d+)*)['"]\)/;

export type BuildFileTargets = {
  // One value per `IPHONEOS_DEPLOYMENT_TARGET` build setting: the app target's
  // Debug, Release and Release-AdHoc configurations and the project's own three.
  project: string[];
  // The Podfile's `platform :ios` line, the iOS the pods are resolved for.
  podfilePlatform: string | undefined;
  // The post_install floor every pod's deployment target is raised to.
  podfilePodFloor: string | undefined;
};

export const projectDeploymentTargets = (projectText: string): string[] =>
  [...projectText.matchAll(PROJECT_TARGET)].map((match) => match[1]);

export const podfilePlatformTarget = (podfileText: string): string | undefined =>
  PODFILE_PLATFORM.exec(podfileText)?.[1];

export const podfilePodFloor = (podfileText: string): string | undefined =>
  PODFILE_POD_FLOOR.exec(podfileText)?.[1];

export const buildFileTargets = (): BuildFileTargets => {
  const podfileText = readFileSync(PODFILE, 'utf-8');

  return {
    project: projectDeploymentTargets(readFileSync(PROJECT_FILE, 'utf-8')),
    podfilePlatform: podfilePlatformTarget(podfileText),
    podfilePodFloor: podfilePodFloor(podfileText),
  };
};

// Each build file setting that does not state `expected`, one line apiece, so a
// failure names the file and setting to fix. A setting the reader could not
// find (`undefined`) counts as not stating it.
export const buildFilesNotAtTarget = (targets: BuildFileTargets, expected: string): string[] => [
  ...targets.project.flatMap((target, index) =>
    target === expected
      ? []
      : [`project.pbxproj IPHONEOS_DEPLOYMENT_TARGET #${index + 1} is ${target}`],
  ),
  ...(targets.podfilePlatform === expected
    ? []
    : [`Podfile platform :ios is ${targets.podfilePlatform}`]),
  ...(targets.podfilePodFloor === expected
    ? []
    : [`Podfile post_install pod floor is ${targets.podfilePodFloor}`]),
];
