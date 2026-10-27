import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { readSkillText } from './skill-text';
import { orphanReferenceFiles } from './orphan-reference-files';
import { createTemporaryDirectory, removeTemporaryDirectories } from './temporary-directory';

afterEach(() => {
  removeTemporaryDirectories();
});

describe('readSkillText', () => {
  it('adds the .md files SKILL.md links to inside its folder, and nothing else', () => {
    const root = createTemporaryDirectory('kiko-skill-text-');
    const folder = join(root, 'demo');

    mkdirSync(join(folder, 'details'), { recursive: true });
    writeFileSync(
      join(folder, 'SKILL.md'),
      [
        'See [one](one.md#part), [nested](details/two.md), [site](https://example.com/x.md),',
        '[outside](../outside.md) and [text](notes.txt).',
      ].join('\n'),
    );
    writeFileSync(join(folder, 'one.md'), 'ONE [deeper](details/three.md)');
    writeFileSync(join(folder, 'details/two.md'), 'TWO');
    writeFileSync(join(folder, 'orphan.md'), 'ORPHAN');
    writeFileSync(join(folder, 'details/three.md'), 'THREE inside a reference, not SKILL.md');
    writeFileSync(join(root, 'outside.md'), 'OUTSIDE');

    const text = readSkillText(join(folder, 'SKILL.md'));

    expect(text).toContain('ONE');
    expect(text).toContain('TWO');
    expect(text).not.toContain('ORPHAN');
    expect(text).not.toContain('THREE');
    expect(text).not.toContain('OUTSIDE');
  });

  it('throws, naming SKILL.md and the link, when a linked .md file inside the folder is missing', () => {
    const folder = join(createTemporaryDirectory('kiko-skill-text-'), 'demo');

    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'SKILL.md'), 'See [contract](wraper-contract.md#part).');

    expect(() => readSkillText(join(folder, 'SKILL.md'))).toThrow(/SKILL\.md.*wraper-contract\.md/);
  });

  it('throws for a percent-encoded link, which names no file on disk', () => {
    const folder = join(createTemporaryDirectory('kiko-skill-text-'), 'demo');

    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'SKILL.md'), 'See [one](one%20two.md).');
    writeFileSync(join(folder, 'one two.md'), 'ONE TWO');

    expect(() => readSkillText(join(folder, 'SKILL.md'))).toThrow(/one%20two\.md/);
  });

  it('does not throw for a URL link, which is not a file inside the folder', () => {
    const folder = join(createTemporaryDirectory('kiko-skill-text-'), 'demo');

    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'SKILL.md'), 'See [site](https://example.com/x.md).');

    expect(readSkillText(join(folder, 'SKILL.md'))).toContain('See [site]');
  });
});

describe('orphanReferenceFiles', () => {
  const writeSkill = (root: string, files: Record<string, string>): void => {
    Object.entries(files).forEach(([file, text]) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    });
  };

  it('names a .md file in a skill folder that SKILL.md does not link to', () => {
    const root = createTemporaryDirectory('kiko-skill-orphans-');

    writeSkill(root, {
      'demo/SKILL.md': 'See [one](one.md).',
      'demo/one.md': 'ONE',
      'demo/details/orphan.md': 'ORPHAN',
    });

    expect(orphanReferenceFiles(root)).toEqual(['demo/details/orphan.md']);
  });

  it.each([
    ['a title', '[one](one.md "title")'],
    ['angle brackets', '[one](<one.md>)'],
    ['a reference-style link', '[one][ref]\n\n[ref]: one.md'],
  ])('names a reference file linked with %s, a form the reader does not follow', (_form, link) => {
    const root = createTemporaryDirectory('kiko-skill-orphans-');

    writeSkill(root, { 'demo/SKILL.md': link, 'demo/one.md': 'ONE' });

    expect(orphanReferenceFiles(root)).toEqual(['demo/one.md']);
  });

  it('names nothing when every .md file is linked, one level deep', () => {
    const root = createTemporaryDirectory('kiko-skill-orphans-');

    writeSkill(root, {
      'demo/SKILL.md': 'See [one](one.md).',
      'demo/one.md': 'ONE',
      'plain/SKILL.md': 'No references.',
    });

    expect(orphanReferenceFiles(root)).toEqual([]);
  });
});
