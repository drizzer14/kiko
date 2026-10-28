import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const MARKDOWN_LINK_PATTERN = /\]\(([^)\s#]+\.md)(?:#[^)\s]*)?\)/g;

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

const insideFolder = (folder: string, file: string): boolean =>
  !relative(folder, file).startsWith('..');

// The files a skill is made of: SKILL.md first, then the `.md` files it links to with a relative
// link, one level deep. A link to a file that is not there throws instead of being skipped, so a
// typo or a renamed file fails loudly instead of silently dropping a whole reference file.
export const skillFiles = (skillFile: string): string[] => {
  const folder = dirname(skillFile);

  const references = [...readFileSync(skillFile, 'utf8').matchAll(MARKDOWN_LINK_PATTERN)]
    .map((match) => ({ link: match[1], file: resolve(folder, match[1]) }))
    .filter(({ link, file }) => !URL_SCHEME_PATTERN.test(link) && insideFolder(folder, file));

  references.forEach(({ link, file }) => {
    if (!existsSync(file)) {
      throw new Error(`${skillFile} links to ${link}, which does not exist`);
    }
  });

  return [skillFile, ...new Set(references.map(({ file }) => file))];
};

// A skill is its SKILL.md plus the `.md` files that SKILL.md links to with a relative link and
// that lie inside the skill folder, one level deep. A suite that checks what a skill says reads
// it through here, so moving a section into a reference file needs no suite edit.
export const readSkillText = (skillFile: string): string =>
  skillFiles(skillFile)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

const HEADING_PATTERN = /^#{1,6}\s+(.+?)\s*#*\s*$/;

const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

const QUALIFIER_PATTERN = /\s+\([^()]*\)$/;

const withoutBackticks = (text: string): string => text.replace(/`/g, '').trim();

// The `#`-`######` headings outside a fenced block, backticks stripped, so a citation of a
// heading resolves the same way for the guard citations and the prose ones.
export const headingsOf = (markdown: string): Set<string> => {
  const headings = new Set<string>();
  let fence: string | undefined;

  markdown.split('\n').forEach((lineText) => {
    const fenceMatch = FENCE_PATTERN.exec(lineText);

    if (fenceMatch !== null) {
      if (fence === undefined) {
        fence = fenceMatch[1];
      } else if (fenceMatch[1].startsWith(fence)) {
        fence = undefined;
      }

      return;
    }

    const headingMatch = fence === undefined ? HEADING_PATTERN.exec(lineText) : null;

    if (headingMatch !== null) {
      headings.add(withoutBackticks(headingMatch[1]));
    }
  });

  return headings;
};

export const headingResolves = (heading: string, headings: Set<string>): boolean => {
  const cited = withoutBackticks(heading);

  if (headings.has(cited)) {
    return true;
  }

  if (QUALIFIER_PATTERN.test(cited)) {
    return headings.has(cited.replace(QUALIFIER_PATTERN, ''));
  }

  const parts = cited.split(' / ');

  return parts.length > 1 && parts.every((part) => headingResolves(part, headings));
};
