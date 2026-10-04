import {
  type BuildFileTargets,
  buildFileTargets,
  buildFilesNotAtTarget,
  podfilePlatformTarget,
  podfilePodFloor,
  projectDeploymentTargets,
} from './deployment-target';

describe('projectDeploymentTargets', () => {
  it('reads every IPHONEOS_DEPLOYMENT_TARGET build setting, in file order', () => {
    const text = `
      buildSettings = {
        IPHONEOS_DEPLOYMENT_TARGET = 18.2;
        SDKROOT = iphoneos;
      };
      buildSettings = {
        IPHONEOS_DEPLOYMENT_TARGET = 26;
      };
    `;

    expect(projectDeploymentTargets(text)).toEqual(['18.2', '26']);
  });

  it('reads nothing from a project with no such setting', () => {
    expect(projectDeploymentTargets('SDKROOT = iphoneos;')).toEqual([]);
  });
});

describe('podfilePlatformTarget', () => {
  it('reads the platform :ios line, double or single quoted', () => {
    expect(podfilePlatformTarget('platform :ios, "18.2"\n')).toBe('18.2');
    expect(podfilePlatformTarget("platform :ios, '17.0'\n")).toBe('17.0');
  });

  it('ignores a platform line that is not at the start of a line', () => {
    expect(podfilePlatformTarget('# platform :ios, "9.0"')).toBeUndefined();
  });
});

describe('podfilePodFloor', () => {
  it('reads the post_install floor', () => {
    expect(podfilePodFloor("    app_ios_deployment_target = Gem::Version.new('18.2')")).toBe(
      '18.2',
    );
  });

  it('reads nothing when the floor is not there', () => {
    expect(podfilePodFloor('platform :ios, "18.2"')).toBeUndefined();
  });
});

describe('buildFilesNotAtTarget', () => {
  it('names each build file setting that states an iOS other than the target', () => {
    const drifted: BuildFileTargets = {
      project: ['18.2', '15.1', '18.2'],
      podfilePlatform: '16.0',
      podfilePodFloor: undefined,
    };

    expect(buildFilesNotAtTarget(drifted, '18.2')).toEqual([
      'project.pbxproj IPHONEOS_DEPLOYMENT_TARGET #2 is 15.1',
      'Podfile platform :ios is 16.0',
      'Podfile post_install pod floor is undefined',
    ]);
  });

  it('accepts build files that all state the target', () => {
    const aligned: BuildFileTargets = {
      project: ['18.2', '18.2'],
      podfilePlatform: '18.2',
      podfilePodFloor: '18.2',
    };

    expect(buildFilesNotAtTarget(aligned, '18.2')).toEqual([]);
  });
});

describe('buildFileTargets', () => {
  it('reads the six project settings, the Podfile platform and the pod floor', () => {
    const targets = buildFileTargets();

    expect(targets.project).toHaveLength(6);
    expect(targets.podfilePlatform).toMatch(/^\d+\.\d+$/);
    expect(targets.podfilePodFloor).toMatch(/^\d+\.\d+$/);
  });
});
