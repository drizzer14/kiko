import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  PROJECT_PATH,
  projectFile,
  buildPlistRoot,
  runPlistCheck,
} from './test-support/plist-root';
import { removeTemporaryDirectories } from './test-support/temporary-directory';

const REAL_INFO_PLIST = readFileSync(join(__dirname, '../ios/Kiko/Info.plist'), 'utf8');
const REAL_PROJECT = readFileSync(join(__dirname, '../ios/Kiko.xcodeproj/project.pbxproj'), 'utf8');

const PHONE_ONLY = '\t\t\t\tTARGETED_DEVICE_FAMILY = 1;';
const QUOTED_BOTH_FAMILIES = '\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";';
const UNQUOTED_BOTH_FAMILIES = '\t\t\t\tTARGETED_DEVICE_FAMILY = 1,2;';
const TABLET_ONLY = '\t\t\t\tTARGETED_DEVICE_FAMILY = 2;';
const NO_FAMILY = '';

const MUST_BE_PHONE_ONLY = 'TARGETED_DEVICE_FAMILY must be 1 in every target XCBuildConfiguration';
const NO_TARGET_CONFIGURATION = 'no target XCBuildConfiguration found';
const NOT_SET = 'no TARGETED_DEVICE_FAMILY';

const targetIdentifier = (index: number): string => `AAAA000${index}`;
const projectIdentifier = (index: number): string => `BBBB000${index}`;

const configurationBlock = (identifier: string, name: string, familyLine: string): string[] => [
  `\t\t${identifier} /* ${name} */ = {`,
  '\t\t\tisa = XCBuildConfiguration;',
  '\t\t\tbuildSettings = {',
  ...[familyLine].filter((line) => line !== NO_FAMILY),
  '\t\t\t};',
  `\t\t\tname = ${name};`,
  '\t\t};',
];

const configurationSection = (blocks: string[][]): string =>
  [
    '/* Begin XCBuildConfiguration section */',
    ...blocks.flat(),
    '/* End XCBuildConfiguration section */',
  ].join('\n');

const configurationList = (identifier: string, owner: string, members: string[]): string[] => [
  `\t\t${identifier} /* Build configuration list for ${owner} "Kiko" */ = {`,
  '\t\t\tisa = XCConfigurationList;',
  '\t\t\tbuildConfigurations = (',
  ...members.map((member) => `\t\t\t\t${member} /* Config */,`),
  '\t\t\t);',
  '\t\t\tdefaultConfigurationName = Release;',
  '\t\t};',
];

const listSection = (lists: string[][]): string =>
  [
    '/* Begin XCConfigurationList section */',
    ...lists.flat(),
    '/* End XCConfigurationList section */',
  ].join('\n');

const targetBlocks = (familyLines: string[]): string[][] =>
  familyLines.map((familyLine, index) =>
    configurationBlock(targetIdentifier(index), `Target${index}`, familyLine),
  );

const projectBlocks = (familyLines: string[]): string[][] =>
  familyLines.map((familyLine, index) =>
    configurationBlock(projectIdentifier(index), `Project${index}`, familyLine),
  );

const targetList = (count: number): string[] =>
  configurationList(
    'CCCC0000',
    'PBXNativeTarget',
    Array.from({ length: count }, (_, index) => targetIdentifier(index)),
  );

const projectList = (count: number): string[] =>
  configurationList(
    'DDDD0000',
    'PBXProject',
    Array.from({ length: count }, (_, index) => projectIdentifier(index)),
  );

const wholeProject = (sections: string[]): string =>
  [projectFile(['en', 'uk'], undefined, { withBuildConfigurations: false }), ...sections, ''].join(
    '\n',
  );

// The shared fixture's three configurations (Debug, Release, Release-AdHoc), with the family line
// of each one in `replacements` swapped in by position.
const fixtureWithFamilies = (replacements: string[]): string => {
  let position = 0;

  return projectFile(['en', 'uk']).replaceAll(PHONE_ONLY, () => {
    const replacement = replacements[position] ?? PHONE_ONLY;

    position += 1;

    return replacement;
  });
};

// The line number is read back from the generated text, so the pin does not
// depend on how many lines the shared fixture prefix has.
const lineOf = (project: string, needle: string): number =>
  project.split('\n').findIndex((line) => line.includes(needle)) + 1;

const runWithProject = (project: string) =>
  runPlistCheck(
    buildPlistRoot({
      infoPlist: REAL_INFO_PLIST,
      overrides: { [PROJECT_PATH]: project },
    }),
  );

afterEach(removeTemporaryDirectories);

describe('scripts/checks/plist.sh device family', () => {
  it('passes on the real project file, whose three app configurations are all 1', () => {
    expect(REAL_PROJECT.match(/TARGETED_DEVICE_FAMILY = 1;/g)).toHaveLength(3);

    const result = runWithProject(REAL_PROJECT);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('passes on the shared fixture, whose Debug, Release and Release-AdHoc are all 1', () => {
    const result = runWithProject(fixtureWithFamilies([]));

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it.each([
    ['Debug', 0],
    ['Release', 1],
    ['Release-AdHoc', 2],
  ])('fails (exit 2) when only %s is "1,2"', (configuration, index) => {
    const replacements = [PHONE_ONLY, PHONE_ONLY, PHONE_ONLY];

    replacements[index] = QUOTED_BOTH_FAMILIES;

    const project = fixtureWithFamilies(replacements);
    const result = runWithProject(project);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(MUST_BE_PHONE_ONLY);
    expect(result.stderr).toContain(
      `project.pbxproj line ${lineOf(project, QUOTED_BOTH_FAMILIES)}, configuration ${configuration} (found`,
    );
    expect(result.stderr).toContain(`(found: ${QUOTED_BOTH_FAMILIES.trim()})`);
  });

  it('fails (exit 2) naming all three configurations when each is "1,2"', () => {
    const result = runWithProject(fixtureWithFamilies(Array(3).fill(QUOTED_BOTH_FAMILIES)));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('configuration Debug');
    expect(result.stderr).toContain('configuration Release (found');
    expect(result.stderr).toContain('configuration Release-AdHoc');
  });

  it('fails (exit 2) on an unquoted 1,2 and on a tablet-only 2', () => {
    const result = runWithProject(
      fixtureWithFamilies([UNQUOTED_BOTH_FAMILIES, TABLET_ONLY, PHONE_ONLY]),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`(found: ${UNQUOTED_BOTH_FAMILIES.trim()})`);
    expect(result.stderr).toContain(`(found: ${TABLET_ONLY.trim()})`);
    expect(result.stderr).not.toContain('configuration Release-AdHoc');
  });

  it('fails (exit 2) on a fourth target configuration that sets no family, naming its line', () => {
    const project = wholeProject([
      configurationSection(targetBlocks([...Array(3).fill(PHONE_ONLY), NO_FAMILY])),
      listSection([targetList(4)]),
    ]);
    const result = runWithProject(project);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(MUST_BE_PHONE_ONLY);
    expect(result.stderr).toContain(
      `project.pbxproj line ${lineOf(project, '/* Target3 */ = {')}, configuration Target3`,
    );
    expect(result.stderr).toContain(`(found: ${NOT_SET})`);
  });

  it('names every offending target configuration, not only the first', () => {
    const project = wholeProject([
      configurationSection(targetBlocks([QUOTED_BOTH_FAMILIES, PHONE_ONLY, NO_FAMILY])),
      listSection([targetList(3)]),
    ]);
    const result = runWithProject(project);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('configuration Target0');
    expect(result.stderr).toContain('configuration Target2');
    expect(result.stderr).not.toContain('configuration Target1');
  });

  it('ignores "1,2" on a project configuration, which the target overrides', () => {
    const result = runWithProject(
      wholeProject([
        configurationSection([
          ...targetBlocks(Array(3).fill(PHONE_ONLY)),
          ...projectBlocks([NO_FAMILY, QUOTED_BOTH_FAMILIES]),
        ]),
        listSection([targetList(3), projectList(2)]),
      ]),
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('ignores a "1,2" line outside the XCBuildConfiguration section', () => {
    const result = runWithProject(
      wholeProject([
        [
          '/* Begin PBXNativeTarget section */',
          QUOTED_BOTH_FAMILIES,
          '/* End PBXNativeTarget section */',
        ].join('\n'),
        configurationSection(targetBlocks(Array(3).fill(PHONE_ONLY))),
        listSection([targetList(3)]),
      ]),
    );

    expect(result.status).toBe(0);
  });

  it('fails closed (exit 2) when the target list names no configuration block', () => {
    const result = runWithProject(
      wholeProject([
        configurationSection(projectBlocks(Array(3).fill(PHONE_ONLY))),
        listSection([targetList(3), projectList(3)]),
      ]),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(NO_TARGET_CONFIGURATION);
    expect(result.stderr).not.toContain(MUST_BE_PHONE_ONLY);
  });

  it('fails closed (exit 2) when the project has no target configuration list', () => {
    const result = runWithProject(
      wholeProject([
        configurationSection(targetBlocks(Array(3).fill(PHONE_ONLY))),
        listSection([projectList(3)]),
      ]),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(NO_TARGET_CONFIGURATION);
  });

  it('fails closed (exit 2) when the project has no configuration sections at all', () => {
    const result = runWithProject(wholeProject([]));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(NO_TARGET_CONFIGURATION);
  });
});
