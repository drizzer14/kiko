import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { readSkillText } from './skill-text';
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
        '[outside](../outside.md), [unlinked-by-name](missing.md) and [text](notes.txt).',
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
});
