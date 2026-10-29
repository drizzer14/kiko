import maybe, { foldMap } from 'fnts/maybe';
import { dirname, join, resolve, relative } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const MARKDOWN_LINK_PATTERN = /\]\(([^)\s#]+\.md)(?:#[^)\s]*)?\)/g;

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

const insideFolder = (folder: string, file: string): boolean =>
  !relative(folder, file).startsWith('..');

const linkedFiles = (skillFile: string): { link: string; file: string }[] => {
  const folder = dirname(skillFile);

  return [...readFileSync(skillFile, 'utf8').matchAll(MARKDOWN_LINK_PATTERN)]
    .map((match) => ({ link: match[1], file: resolve(folder, match[1]) }))
    .filter(({ link, file }) => !URL_SCHEME_PATTERN.test(link) && insideFolder(folder, file));
};

// The files a skill is made of: SKILL.md first, then the `.md` files it links to with a relative
// link, one level deep. A link to a file that is not there throws instead of being skipped, so a
// typo or a renamed file fails loudly instead of silently dropping a whole reference file.
export const skillFiles = (skillFile: string): string[] => {
  const references = linkedFiles(skillFile);

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

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

const QUALIFIER_PATTERN = /\s+\(([^()]*)\)$/;

const withoutBackticks = (text: string): string => text.replace(/`/g, '').trim();

export const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
      .map((headingMatch) => withoutBackticks(headingMatch[2])),
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

const squashed = (text: string): string => withoutBackticks(text).replace(/\s+/g, ' ');

// A quoted `Heading (Qualifier)` that is no heading itself names a part of the section: the
// qualifier must occur in the body of a heading called `Heading`, so a heading that exists does
// not vouch for a qualifier it lacks. Any other text resolves as `headingResolves` reads it.
export const quotedHeadingResolves = (cited: string, markdown: string): boolean => {
  const headings = headingsOf(markdown);

  const text = withoutBackticks(cited);

  const qualifier = QUALIFIER_PATTERN.exec(text);

  if (headings.has(text) || qualifier === null) {
    return headingResolves(text, headings);
  }

  return sectionBodies(markdown, text.slice(0, qualifier.index)).some((body) =>
    squashed(body).includes(squashed(qualifier[1])),
  );
};

// The text under every heading called `heading`, down to the next heading of the same or a higher
// level, subsections included.
const sectionBodies = (markdown: string, heading: string): string[] => {
  const lines = linesOutsideFences(markdown);

  return lines.flatMap((lineText, index) => {
    const opening = HEADING_PATTERN.exec(lineText);

    if (opening === null || withoutBackticks(opening[2]) !== heading) {
      return [];
    }

    const end = lines.findIndex(
      (later, offset) =>
        offset > index &&
        (HEADING_PATTERN.exec(later)?.[1].length ?? Infinity) <= opening[1].length,
    );

    return [lines.slice(index + 1, end < 0 ? undefined : end).join('\n')];
  });
};

// The list items of a text: a `- ` line and its continuation lines, up to a blank line or the next
// `- ` line at the line start.
const bulletsOf = (text: string): string[] =>
  text.split(/\n\s*\n|\n(?=- )/).filter((chunk) => chunk.startsWith('- '));

const TOP_LEVEL_LEAD_PATTERN = /^- \*\*(.+?)\*\*/;

// A heading or a bold lead as an index names it: no backticks or bold marks, one space between
// words, no closing period or colon, and no trailing `()` of a call.
const leadName = (text: string): string =>
  text
    .replace(/`|\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:]$/, '')
    .replace(/\(\)$/, '');

const HELPER_FOLDERS = ['src/test-support', '__tests__/test-support'];

const HELPER_NAME_PATTERN = /`([\w.-]+\.tsx?)`/g;

const TEST_FILE_PATTERN = /\.test\.tsx?$/;

export type HelperCatalogueGaps = {
  missing: string[];
  unlisted: string[];
};

const listedHelpers = (catalogue: string): string[] => {
  let folder: string | undefined;

  return linesOutsideFences(catalogue).flatMap((lineText) => {
    const heading = HEADING_PATTERN.exec(lineText);

    if (heading !== null) {
      folder = HELPER_FOLDERS.find((candidate) => heading[2].includes(`\`${candidate}/\``));

      return [];
    }

    return (
      foldMap(maybe(folder), (section) =>
        [...lineText.matchAll(HELPER_NAME_PATTERN)].map((match) => `${section}/${match[1]}`),
      ) ?? []
    );
  });
};

const helperFilesIn = (root: string): string[] =>
  HELPER_FOLDERS.filter((folder) => existsSync(join(root, folder))).flatMap((folder) =>
    readdirSync(join(root, folder), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && /\.tsx?$/.test(entry.name) && !TEST_FILE_PATTERN.test(entry.name),
      )
      .map(({ name }) => `${folder}/${name}`),
  );

// kiko-testing lists the helper files of `src/test-support/` and `__tests__/test-support/` under a
// heading that names the folder; a helper added or removed without the list drifts.
export const helperCatalogueGaps = (root: string): HelperCatalogueGaps => {
  const listed = new Set(
    listedHelpers(readSkillText(join(root, '.claude/skills/kiko-testing/SKILL.md'))),
  );

  const present = new Set(helperFilesIn(root));

  return {
    missing: [...listed].filter((file) => !present.has(file)).sort(),
    unlisted: [...present].filter((file) => !listed.has(file)).sort(),
  };
};

export type UnnamedLockedMark = { file: string; line: number; component: string; date: string };

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/;

const LOCKED_LIST_HEADING = 'Locked decisions (user-approved)';

// A Locked mark in a reference file is named in the SKILL.md list of locked decisions: a bullet
// there holds the mark's date and the component in backticks. The component is the nearest
// top-level bold lead above the mark, the date the first one in the mark and the two lines after.
export const unnamedLockedMarks = (skillFile: string): UnnamedLockedMark[] => {
  const lockedBullets = bulletsOf(
    sectionBodies(readFileSync(skillFile, 'utf8'), LOCKED_LIST_HEADING).join('\n'),
  );

  return skillFiles(skillFile)
    .slice(1)
    .flatMap((reference) => {
      const lines = linesOutsideFences(readFileSync(reference, 'utf8'));

      return lines.flatMap((lineText, index) => {
        const markAt = lineText.indexOf('**Locked');

        if (markAt < 0) {
          return [];
        }

        const component = leadName(
          lines
            .slice(0, index + 1)
            .reverse()
            .map((above) => TOP_LEVEL_LEAD_PATTERN.exec(above)?.[1])
            .find((lead) => lead !== undefined) ?? '',
        );

        const markText = [lineText.slice(markAt), ...lines.slice(index + 1, index + 3)].join('\n');

        const date = DATE_PATTERN.exec(markText)?.[0] ?? '';

        const named = lockedBullets.some(
          (bullet) => bullet.includes(date) && bullet.includes(`\`${component}\``),
        );

        return date !== '' && named
          ? []
          : [{ file: relative(dirname(skillFile), reference), line: index + 1, component, date }];
      });
    });
};

export type IndexLeadGap = { file: string; lead: string };

// SKILL.md indexes each reference file in one bullet (`- [x.md](x.md) — ...`); every `##` heading
// (cut at ` — `) and every top-level bold lead of the file must be named in it, or a reader of the
// index never learns the entry exists.
export const indexLeadGaps = (skillFile: string): IndexLeadGap[] => {
  const bullets = bulletsOf(readFileSync(skillFile, 'utf8'));

  return skillFiles(skillFile)
    .slice(1)
    .flatMap((reference) => {
      const file = relative(dirname(skillFile), reference);

      const indexed = leadName(
        bullets.find((bullet) => bullet.startsWith('- [') && bullet.includes(`](${file}`)) ?? '',
      );

      return linesOutsideFences(readFileSync(reference, 'utf8'))
        .flatMap((lineText) => {
          const heading = HEADING_PATTERN.exec(lineText);

          if (heading !== null) {
            return heading[1] === '##' ? [leadName(heading[2].split(' — ')[0])] : [];
          }

          return (
            foldMap(maybe(TOP_LEVEL_LEAD_PATTERN.exec(lineText)), (lead) => [leadName(lead[1])]) ??
            []
          );
        })
        .filter((lead) => !new RegExp(`(?<!\\w)${escapePattern(lead)}(?!\\w)`, 'i').test(indexed))
        .map((lead) => ({ file, lead }));
    });
};
