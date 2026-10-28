import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import {
  headingResolves,
  headingsOf,
  linesOutsideFences,
  quotedHeadingResolves,
  readSkillText,
} from './skill-text';
import { lineCountBefore } from './markdown-code-spans';
import { sourceComments } from './source-comment-citations';

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
// their day. A `.ts(x)` source is read for its comments alone.
const SOURCE_FOLDERS = [
  { folder: '.claude/skills', recursive: true, extensions: ['.md'] },
  { folder: 'harness/kiko/skills', recursive: true, extensions: ['.md'] },
  { folder: 'harness/kiko/agents', recursive: false, extensions: ['.md'] },
  { folder: 'docs/harness', recursive: true, extensions: ['.md'] },
  { folder: 'docs/plans', recursive: true, extensions: ['.md'] },
  { folder: 'rules', recursive: false, extensions: ['.yml'] },
  { folder: 'rules/fixtures', recursive: true, extensions: ['.ts', '.tsx'] },
  { folder: 'src', recursive: true, extensions: ['.ts', '.tsx'] },
];

const SINGLE_FILES = ['CLAUDE.md'];

// A quote may wrap over lines but never over a blank line, so an unclosed quote cannot swallow a
// paragraph; a backslash and the character after it (an escaped quote) never end it.
const QUOTED_TEXT = '(?:(?!\\n[ \\t]*\\n)(?:\\\\[\\s\\S]|[^"\\\\]))+';

const SINGLE_QUOTED_TEXT = "(?:(?!\\n[ \\t]*\\n)[^'])+";

const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CODE_FILE_PATTERN = /\.tsx?$/;

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
      ({ folder, recursive, extensions }) =>
        readdirSync(join(root, folder), { recursive, encoding: 'utf8' })
          .filter((path) => extensions.some((extension) => path.endsWith(extension)))
          .map((path) => join(folder, path)),
    ),
  ].sort();

const normalizedText = (quoted: string): string =>
  quoted
    .replace(/`|\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,]$/, '');

const LIST_ITEM_OR_HEADING = /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+|#{1,6}[ \t])/;

const HEADING = /^[ \t>]*#{1,6}[ \t]/;

// A soft-wrapped line is joined onto the line before it, so only a paragraph's first line, a
// list item and a heading begin a line, and a fenced block is no text at all.
const withParagraphsJoined = (skillText: string): string =>
  linesOutsideFences(skillText)
    .map((lineText, index, lines) => {
      const previous = lines[index - 1] ?? '';

      const wraps =
        previous.trim() !== '' &&
        !HEADING.test(previous) &&
        lineText.trim() !== '' &&
        !LIST_ITEM_OR_HEADING.test(lineText);

      return `${wraps ? ' ' : '\n'}${lineText}`;
    })
    .join('');

// The text starts a heading, a list item, the first line of a paragraph or a bold span (after an
// optional leading A, An or The) and ends at a non-word character. A word inside a sentence, a
// wrapped line, or a fenced line is no lead.
const startsALead = (text: string, skillText: string): boolean =>
  new RegExp(
    `(?:^[ \\t>]*(?:(?:[-*+]|\\d+[.)])[ \\t]+)*(?:#{1,6}[ \\t]+)?|\\*\\*)(?:\\*\\*)?` +
      `(?:(?:A|An|The)[ \\t]+)?${escapePattern(text).replace(/ /g, '\\s+')}(?!\\w)`,
    'm',
  ).test(withParagraphsJoined(skillText).replace(/`/g, ''));

// The name, then the quote: after `'s` or the plural `'`, after `skill's`, after a comma or in a
// parenthesis. The comma and the parenthesis read only a backticked name or a `kiko-` one, so a
// short skill name used as a plain word before a comma or a bracket is no citation.
const citationPatternFor = (skills: string[]): RegExp =>
  new RegExp(
    `(?<![\\w-])(\`?)(${skills.map(escapePattern).join('|')})(\`?)` +
      `(?:\\s+skill's\\s+|(?:'s?)?\\s+|(,\\s+|\\s+\\())` +
      `(?:"(${QUOTED_TEXT})"|'(${SINGLE_QUOTED_TEXT})')`,
    'g',
  );

const isCitationForm = (match: RegExpMatchArray): boolean =>
  match[4] === undefined || (match[1] === '`' && match[3] === '`') || match[2].startsWith('kiko-');

// A quoted text, an optional closing mark, then `above` or `below`: a pointer into the same file.
const DIRECTION_PATTERN = new RegExp(`"(${QUOTED_TEXT})"[,;:)]?\\s+(above|below)\\b`, 'g');

const PRECEDING_WORD_PATTERN = /([\w-]+)(?:'s?)?(?:\s+skill's)?[`\s,(]*$/;

const COMMENT_LEADER_PATTERN = /^\s*(?:\/\/+|\/\*+|\*+(?!\/))\s?/;

const COMMENT_TRAILER_PATTERN = /\s*\*\/\s*$/;

// The comments of a source file at their own lines, every other line blank and every leader
// (`//`, `/*`, a block's `*`) cut, so a wrapped comment reads as one quote and a quote never
// crosses a line of code.
const commentOnlyText = (file: string, source: string): string => {
  const lines = source.split('\n').map(() => '');

  sourceComments(file, source).forEach((comment) => {
    comment.text.split('\n').forEach((lineText, offset) => {
      lines[comment.line - 1 + offset] = lineText
        .replace(COMMENT_LEADER_PATTERN, '')
        .replace(COMMENT_TRAILER_PATTERN, '');
    });
  });

  return lines.join('\n');
};

type Source = { file: string; text: string };

// A YAML comment wraps with its own `# `, which is no part of the quoted text.
const sourceTextOf = (file: string, text: string): string =>
  file.endsWith('.yml')
    ? text
        .split('\n')
        .map((lineText) => lineText.replace(/^\s*#\s?/, ''))
        .join('\n')
    : text;

// A code file is parsed only when its raw text could hold a citation: most of `src` holds none.
const scannedSources = (root: string, skills: string[], withCodeComments: boolean): Source[] => {
  const couldCite = new RegExp(`${citationPatternFor(skills).source}|${DIRECTION_PATTERN.source}`);

  return sourceFilesIn(root).flatMap((file) => {
    if (CODE_FILE_PATTERN.test(file) && !withCodeComments) {
      return [];
    }

    const text = readFileSync(join(root, file), 'utf8');

    if (!CODE_FILE_PATTERN.test(file)) {
      return [{ file, text: sourceTextOf(file, text) }];
    }

    return couldCite.test(text) ? [{ file, text: commentOnlyText(file, text) }] : [];
  });
};

const sortedSkillNames = (skillFiles: Map<string, string>): string[] =>
  [...skillFiles.keys()].sort((first, second) => second.length - first.length);

const citedTextResolves = (cited: string, skillText: string): boolean =>
  quotedHeadingResolves(cited, skillText) || startsALead(cited, skillText);

export const proseCitations = (root: string): ProseCitation[] => {
  const skillFiles = skillFilesIn(root);

  const skills = sortedSkillNames(skillFiles);

  const citationPattern = citationPatternFor(skills);

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

  return scannedSources(root, skills, true).flatMap(({ file, text }) =>
    [...text.matchAll(citationPattern)].filter(isCitationForm).map((match) => {
      const skill = match[2];
      const cited = normalizedText(match[5]?.replace(/\\"/g, '"') ?? match[6]);

      return {
        file,
        line: lineCountBefore(text, match.index ?? 0) + 1,
        skill,
        text: cited,
        resolved: citedTextResolves(cited, skillTextOf(skill)),
      };
    }),
  );
};

export const unresolvedProseCitations = (root: string): ProseCitation[] =>
  proseCitations(root).filter(({ resolved }) => !resolved);

export type DirectionCitation = {
  file: string;
  line: number;
  text: string;
  direction: 'above' | 'below';
  resolved: boolean;
};

const namesASkill = (text: string, quoteIndex: number, skills: Set<string>): boolean =>
  skills.has(
    PRECEDING_WORD_PATTERN.exec(text.slice(Math.max(0, quoteIndex - 80), quoteIndex))?.[1] ?? '',
  );

// The heading or lead is in the same file, before the cited line for `above` and after it for
// `below`; the lines are the file's, a fenced block already emptied.
const resolvedInDirection = (
  cited: string,
  direction: 'above' | 'below',
  line: number,
  lines: string[],
): boolean => {
  const scope = (direction === 'above' ? lines.slice(0, line - 1) : lines.slice(line)).join('\n');

  return headingResolves(cited, headingsOf(scope)) || startsALead(cited, scope);
};

// A quoted heading beside `above` or `below` names no skill, so the prose citation check cannot
// read it. It is checked inside its own file, and only that file. A code comment is not read: its
// "above" points at a line of code (a test title, a path) and no heading is there to find.
export const directionCitations = (root: string): DirectionCitation[] => {
  const skills = sortedSkillNames(skillFilesIn(root));

  const skillSet = new Set(skills);

  return scannedSources(root, skills, false).flatMap(({ file, text }) => {
    const lines = linesOutsideFences(text);

    return [...text.matchAll(DIRECTION_PATTERN)]
      .filter((match) => !namesASkill(text, match.index ?? 0, skillSet))
      .map((match) => {
        const line = lineCountBefore(text, match.index ?? 0) + 1;
        const cited = normalizedText(match[1].replace(/\\"/g, '"'));
        const direction = match[2] === 'above' ? 'above' : 'below';

        return {
          file,
          line,
          text: cited,
          direction,
          resolved: resolvedInDirection(cited, direction, line, lines),
        };
      });
  });
};

export const unresolvedDirectionCitations = (root: string): DirectionCitation[] =>
  directionCitations(root).filter(({ resolved }) => !resolved);
