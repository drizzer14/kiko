import { join, basename } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

import { skillFiles } from './skill-text';

// Every `.md` file in a skill folder other than SKILL.md must be one `readSkillText` reads, or a
// suite that checks the skill never sees it. This catches a reference file nobody links and a link
// form the reader does not follow (a title, angle brackets, a reference-style link). A `%20` link
// never gets here: `skillFiles` throws on it first.
export const orphanReferenceFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md')))
    .flatMap(({ name }) => {
      const read = new Set(skillFiles(join(root, name, 'SKILL.md')));

      return readdirSync(join(root, name), { recursive: true, encoding: 'utf8' })
        .filter((path) => path.endsWith('.md') && basename(path) !== 'SKILL.md')
        .map((path) => join(name, path))
        .filter((path) => !read.has(join(root, path)));
    });
