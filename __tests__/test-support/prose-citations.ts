import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { lineCountBefore } from './markdown-code-spans';
import { headingResolves, headingsOf, readSkillText } from './skill-text';

// A prose citation names a skill and quotes a section of it: `kiko-testing's "Test traps"`,
// kiko-testing "Test traps", with double or single quotes. It is checked against the skill text
// (SKILL.md plus its linked reference files), so moving a section out of a skill cannot leave a
// doc, an agent or a rule message pointing at text that is gone.
export type ProseCitation = {
  file: string;
  line: number;
  skill: string;
  text: string;
  resolved: boolean;
};

const SKILL_ROOTS = ['.claude/skills', 'harness/kiko/skills'];

// Dated records (`docs/superpowers`, `docs/reviews`) are not read: they describe the skill text of
// their day.
const SOURCE_FOLDERS = [
  { folder: '.claude/skills', recursive: true, extension: '.md' },
  { folder: 'harness/kiko/skills', recursive: true, extension: '.md' },
  { folder: 'harness/kiko/agents', recursive: false, extension: '.md' },
  { folder: 'docs/harness', recursive: true, extension: '.md' },
  { folder: 'docs/plans', recursive: true, extension: '.md' },
  { folder: 'rules', recursive: false, extension: '.yml' },
];

const SINGLE_FILES = ['CLAUDE.md'];

// A quote may wrap over lines but never over a blank line, so an unclosed quote cannot swallow a
// paragraph.
const QUOTED_TEXT = '(?:(?!\\n[ \\t]*\\n)[^"])+';

const SINGLE_QUOTED_TEXT = "(?:(?!\\n[ \\t]*\\n)[^'])+";

const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A skill name to its SKILL.md; a name in both roots reads the first, as the citation test does.
const skillFilesIn = (root: string): Map<string, string> =>
  new Map(
    [...SKILL_ROOTS]
      .reverse()
      .filter((skillRoot) => existsSync(join(root, skillRoot)))
      .flatMap((skillRoot) =>
        readdirSync(join(root, skillRoot), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map(({ name }): [string, string] => [name, join(root, skillRoot, name, 'SKILL.md')])
          .filter(([, file]) => existsSync(file)),
      ),
  );

const sourceFilesIn = (root: string): string[] =>
  [
    ...SINGLE_FILES.filter((file) => existsSync(join(root, file))),
    ...SOURCE_FOLDERS.filter(({ folder }) => existsSync(join(root, folder))).flatMap(
      ({ folder, recursive, extension }) =>
        readdirSync(join(root, folder), { recursive, encoding: 'utf8' })
          .filter((path) => path.endsWith(extension))
          .map((path) => join(folder, path)),
    ),
  ].sort();

const normalizedText = (quoted: string): string =>
  quoted
    .replace(/`|\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,]$/, '');

// The text starts a heading, a bullet or list item, a bold span or a line (after an optional
// leading A, An or The) and ends at a non-word character. A word inside a sentence is no lead.
const startsALead = (text: string, skillText: string): boolean =>
  new RegExp(
    `(?:^[ \\t>]*(?:(?:[-*+]|\\d+[.)])[ \\t]+)*(?:#{1,6}[ \\t]+)?|\\*\\*)(?:\\*\\*)?` +
      `(?:(?:A|An|The)[ \\t]+)?${escapePattern(text).replace(/ /g, '\\s+')}(?!\\w)`,
    'm',
  ).test(skillText.replace(/`/g, ''));

export const proseCitations = (root: string): ProseCitation[] => {
  const skillFiles = skillFilesIn(root);

  const skills = [...skillFiles.keys()].sort((first, second) => second.length - first.length);

  const citationPattern = new RegExp(
    `(?<![\\w-])\`?(${skills.map(escapePattern).join('|')})\`?(?:'s)?\\s+` +
      `(?:"(${QUOTED_TEXT})"|'(${SINGLE_QUOTED_TEXT})')`,
    'g',
  );

  const skillTexts = new Map<string, string>();

  const skillTextOf = (skill: string): string => {
    const cached = skillTexts.get(skill);

    if (cached !== undefined) {
      return cached;
    }

    const read = readSkillText(skillFiles.get(skill) ?? '');

    skillTexts.set(skill, read);

    return read;
  };

  return sourceFilesIn(root).flatMap((file) => {
    // A YAML comment wraps with its own `# `, which is no part of the quoted text.
    const text = readFileSync(join(root, file), 'utf8')
      .split('\n')
      .map((lineText) => (file.endsWith('.yml') ? lineText.replace(/^\s*#\s?/, '') : lineText))
      .join('\n');

    return [...text.matchAll(citationPattern)].map((match) => {
      const skill = match[1];
      const cited = normalizedText(match[2] ?? match[3]);
      const skillText = skillTextOf(skill);

      return {
        file,
        line: lineCountBefore(text, match.index ?? 0) + 1,
        skill,
        text: cited,
        resolved: headingResolves(cited, headingsOf(skillText)) || startsALead(cited, skillText),
      };
    });
  });
};

export const unresolvedProseCitations = (root: string): ProseCitation[] =>
  proseCitations(root).filter(({ resolved }) => !resolved);
