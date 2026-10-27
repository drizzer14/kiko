import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

const MARKDOWN_LINK_PATTERN = /\]\(([^)\s#]+\.md)(?:#[^)\s]*)?\)/g;

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

const insideFolder = (folder: string, file: string): boolean => {
  const path = relative(folder, file);

  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
};

// A skill is its SKILL.md plus the `.md` files that SKILL.md links to with a relative link and
// that lie inside the skill folder, one level deep. A suite that checks what a skill says reads
// it through here, so moving a section into a reference file needs no suite edit.
export const readSkillText = (skillFile: string): string => {
  const folder = dirname(skillFile);
  const skill = readFileSync(skillFile, 'utf8');

  const references = new Set(
    [...skill.matchAll(MARKDOWN_LINK_PATTERN)]
      .map((match) => match[1])
      .filter((link) => !URL_SCHEME_PATTERN.test(link))
      .map((link) => resolve(folder, link))
      .filter((file) => file !== skillFile && insideFolder(folder, file) && existsSync(file)),
  );

  return [skill, ...[...references].map((file) => readFileSync(file, 'utf8'))].join('\n');
};
