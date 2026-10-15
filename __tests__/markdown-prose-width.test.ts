import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { repositoryFiles } from './test-support/repository-files';

// Markdown prose wraps at 100 columns, like a comment. The skill, agent and harness docs are
// read by agents line by line, and a line that runs past 100 columns is unreadable in a diff.
// Exempt: fenced code, a table row, an ATX heading, the YAML front matter, and a line with no
// wrap point (one long URL). Lines that predate the rule are pinned by exact text in
// markdown-prose-width.pinned.json; the list only shrinks, so a pin whose line no longer
// runs past 100 columns fails until the pin is deleted.
const ROOT = join(__dirname, '..');
const PROSE_ROOTS = [
  '.claude/skills/',
  'harness/kiko/skills/',
  'harness/kiko/agents/',
  'docs/harness/',
];
const PINNED_FILE = join(__dirname, 'fixtures/markdown-prose-width.pinned.json');
const LINE_WIDTH = 100;
const FENCE = /^\s*(`{3,}|~{3,})/;
const TABLE_ROW = /^\s*\|/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const MARKERS = /^\s*(?:(?:[-*+]|\d+[.)])\s+|>+\s?)+/;

type ProseViolation = { line: number; columns: number; text: string };

const columnsOf = (text: string): number => [...text].length;

// A fence opens on ``` or ~~~ and closes on the same character; a line inside it, and the fence
// lines themselves, are code. The front matter is the block from a first-line `---` to the next.
const codeLineFlags = (lines: string[]): boolean[] => {
  let fenceCharacter: string | undefined;
  let inFrontMatter = lines[0]?.trimEnd() === '---';

  return lines.map((line, index) => {
    if (inFrontMatter) {
      inFrontMatter = index === 0 || line.trimEnd() !== '---';

      return true;
    }

    const opening = line.match(FENCE)?.[1][0];

    if (opening === undefined) {
      return fenceCharacter !== undefined;
    }

    fenceCharacter = fenceCharacter === opening ? undefined : (fenceCharacter ?? opening);

    return true;
  });
};

// The list or quote marker of a line is not a word: `- <url>` has nothing to wrap. A wrap point
// exists when at least two words remain and the first one ends within the limit.
const canBeWrapped = (line: string): boolean => {
  const body = line.replace(MARKERS, (marker) => ' '.repeat(marker.length));
  const words = [...body.matchAll(/\S+/g)];

  return (
    words.length >= 2 &&
    columnsOf(body.slice(0, (words[0].index ?? 0) + words[0][0].length)) <= LINE_WIDTH
  );
};

const proseViolations = (markdown: string): ProseViolation[] => {
  const lines = markdown.split('\n').map((line) => line.trimEnd());
  const isCode = codeLineFlags(lines);

  return lines.flatMap((text, index) =>
    !isCode[index] &&
    columnsOf(text) > LINE_WIDTH &&
    !TABLE_ROW.test(text) &&
    !HEADING.test(text) &&
    canBeWrapped(text)
      ? [{ line: index + 1, columns: columnsOf(text), text }]
      : [],
  );
};

const lineOfWidth = (lead: string, width: number): string =>
  `${lead}${' ab'.repeat(width)}`.slice(0, width - 1).concat('x');

const urlOfWidth = (width: number): string =>
  `https://example.com/${'p'.repeat(width)}`.slice(0, width);

const flaggedLines = (markdown: string): number[] =>
  proseViolations(markdown).map(({ line }) => line);

describe('proseViolations', () => {
  it('passes a line of exactly 100 columns and flags one of 101', () => {
    expect(flaggedLines(lineOfWidth('', LINE_WIDTH))).toEqual([]);
    expect(proseViolations(`short\n${lineOfWidth('', LINE_WIDTH + 1)}\n`)).toEqual([
      { line: 2, columns: 101, text: lineOfWidth('', LINE_WIDTH + 1) },
    ]);
  });

  it('counts code points, not bytes', () => {
    const cyrillic = (count: number): string => `${'я'.repeat(count - 2)} к`;

    expect(flaggedLines(cyrillic(LINE_WIDTH))).toEqual([]);
    expect(flaggedLines(cyrillic(LINE_WIDTH + 1))).toEqual([1]);
  });

  it('does not count trailing whitespace', () => {
    expect(flaggedLines(`${lineOfWidth('', LINE_WIDTH)}   `)).toEqual([]);
  });

  it.each([
    ['a backtick fence', '```'],
    ['a tilde fence', '~~~'],
    ['a longer fence', '````'],
    ['an indented fence', '  ```'],
  ])('exempts the lines inside %s, and the fence lines', (_label, fence) => {
    const long = lineOfWidth('', LINE_WIDTH + 5);

    expect(flaggedLines(`${fence}ts\n${long}\n${fence}\n${long}\n`)).toEqual([4]);
  });

  it('does not close a fence with the other fence character', () => {
    const long = lineOfWidth('', LINE_WIDTH + 5);

    expect(flaggedLines(`\`\`\`\n~~~\n${long}\n\`\`\`\n${long}\n`)).toEqual([5]);
  });

  it('exempts a table row, with or without leading indentation', () => {
    const row = `| ${lineOfWidth('', LINE_WIDTH + 5)} |`;

    expect(flaggedLines(`${row}\n  ${row}\n`)).toEqual([]);
  });

  it('exempts an ATX heading and flags a line that only starts with a hash', () => {
    expect(flaggedLines(`## ${lineOfWidth('', LINE_WIDTH + 5)}\n`)).toEqual([]);
    expect(flaggedLines(`#${lineOfWidth('', LINE_WIDTH + 5)}\n`)).toEqual([]);
    expect(flaggedLines(`#hashtag ${lineOfWidth('', LINE_WIDTH + 5)}\n`)).toEqual([1]);
  });

  it('exempts the front matter and reads a later --- as a rule, not front matter', () => {
    const long = lineOfWidth('description: ', LINE_WIDTH + 5);

    expect(flaggedLines(`---\n${long}\n---\n${long}\n`)).toEqual([4]);
    expect(flaggedLines(`text\n---\n${long}\n---\n`)).toEqual([3]);
  });

  describe('a line with no wrap point is exempt', () => {
    it('passes one URL as the whole line, bare or after a list or quote marker', () => {
      const url = urlOfWidth(LINE_WIDTH + 20);

      expect(flaggedLines(`${url}\n- ${url}\n  * ${url}\n1. ${url}\n> ${url}\n`)).toEqual([]);
    });

    it('flags a URL after words, because the words can wrap before it', () => {
      expect(
        flaggedLines(`see ${urlOfWidth(LINE_WIDTH)}\n- see ${urlOfWidth(LINE_WIDTH)}\n`),
      ).toEqual([1, 2]);
    });

    it('wraps when the first word ends at column 100, and is exempt when it ends at 101', () => {
      const first = (width: number): string => `${'w'.repeat(width)} tail`;

      expect(flaggedLines(first(LINE_WIDTH))).toEqual([1]);
      expect(flaggedLines(first(LINE_WIDTH + 1))).toEqual([]);
    });
  });

  it('flags a list item, a numbered item and a quote that run past the limit', () => {
    const long = lineOfWidth('', LINE_WIDTH + 5);

    expect(flaggedLines(`- ${long}\n  - ${long}\n1. ${long}\n> ${long}\n`)).toEqual([1, 2, 3, 4]);
  });
});

type Pins = Record<string, string[]>;

const readPins = (): Pins => JSON.parse(readFileSync(PINNED_FILE, 'utf8')) as Pins;

const proseFiles = (): string[] =>
  repositoryFiles(ROOT).filter(
    (file) => file.endsWith('.md') && PROSE_ROOTS.some((root) => file.startsWith(root)),
  );

describe('the skill, agent and harness docs', () => {
  it('scans the roots it is meant to', () => {
    expect(proseFiles()).toEqual(
      expect.arrayContaining([
        '.claude/skills/kiko-linter/SKILL.md',
        'harness/kiko/agents/developer.md',
        'harness/kiko/skills/harness-workflow/SKILL.md',
        'docs/harness/checks.md',
      ]),
    );
  });

  it('holds no prose line past 100 columns outside the pins', () => {
    const pins = readPins();
    const offenders = proseFiles().flatMap((file) => {
      const unused = [...(pins[file] ?? [])];

      return proseViolations(readFileSync(join(ROOT, file), 'utf8')).flatMap((violation) => {
        const pinIndex = unused.indexOf(violation.text);

        if (pinIndex >= 0) {
          unused.splice(pinIndex, 1);

          return [];
        }

        return [`${file}:${violation.line}: ${violation.columns} columns`];
      });
    });

    expect(offenders).toEqual([]);
  });

  it('keeps no pin whose line is gone, wrapped, or in a file that moved', () => {
    const pins = readPins();
    const files = new Set(proseFiles());
    const stale = Object.entries(pins).flatMap(([file, lines]) => {
      if (!files.has(file)) {
        return [`${file}: the file is not a scanned doc`];
      }

      const present = proseViolations(readFileSync(join(ROOT, file), 'utf8')).map(
        ({ text }) => text,
      );

      return lines.flatMap((line) => {
        const index = present.indexOf(line);

        if (index >= 0) {
          present.splice(index, 1);

          return [];
        }

        return [`${file}: ${line.slice(0, 60)}`];
      });
    });

    expect(stale).toEqual([]);
  });
});
