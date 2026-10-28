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

// The lines of a markdown text with every line of a fenced block, the fence lines too, emptied,
// so a reader of the prose never sees code.
export const linesOutsideFences = (markdown: string): string[] => {
  let fence: string | undefined;

  return markdown.split('\n').map((lineText) => {
    const fenceMatch = FENCE_PATTERN.exec(lineText);

    if (fenceMatch !== null) {
      if (fence === undefined) {
        fence = fenceMatch[1];
      } else if (fenceMatch[1].startsWith(fence)) {
        fence = undefined;
      }

      return '';
    }

    return fence === undefined ? lineText : '';
  });
};

// The `#`-`######` headings outside a fenced block, backticks stripped, so a citation of a
// heading resolves the same way for the guard citations and the prose ones.
export const headingsOf = (markdown: string): Set<string> =>
  new Set(
    linesOutsideFences(markdown)
      .map((lineText) => HEADING_PATTERN.exec(lineText))
      .filter((headingMatch) => headingMatch !== null)
      .map((headingMatch) => withoutBackticks(headingMatch[1])),
  );

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

export type HelperCatalogueGaps = {
  missing: string[];
  unlisted: string[];
  staleExemptions: string[];
};

export const helperCatalogueGaps = (
  root: string,
  exemptions: readonly string[],
): HelperCatalogueGaps => {
  throw new Error(`helperCatalogueGaps is not implemented (${root}, ${exemptions.length})`);
};

export type UnnamedLockedMark = { file: string; line: number; component: string; date: string };

export const unnamedLockedMarks = (skillFile: string): UnnamedLockedMark[] => {
  throw new Error(`unnamedLockedMarks is not implemented (${skillFile})`);
};

export type IndexLeadGap = { file: string; lead: string };

export const indexLeadGaps = (skillFile: string): IndexLeadGap[] => {
  throw new Error(`indexLeadGaps is not implemented (${skillFile})`);
};
