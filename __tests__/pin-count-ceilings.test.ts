import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// A pin list only shrinks. A stale pin already fails its own suite; this suite fails a list that
// grew, so a new long line is wrapped instead of pinned. Lower a ceiling when a list shrinks.
const MARKDOWN_PINS_FILE = join(__dirname, 'fixtures/markdown-prose-width.pinned.json');
const MARKDOWN_PIN_CEILING = 245;
const COMMENT_PINS_FILE = join(__dirname, '../scripts/checks/comment-line-width.pinned');
const COMMENT_PIN_CEILING = 0;

const markdownPinCount = (): number =>
  Object.values(JSON.parse(readFileSync(MARKDOWN_PINS_FILE, 'utf8')) as Record<string, string[]>)
    .map((lines) => lines.length)
    .reduce((total, count) => total + count, 0);

const commentPinCount = (): number =>
  readFileSync(COMMENT_PINS_FILE, 'utf8')
    .split('\n')
    .filter((row) => row.trim() !== '' && !row.startsWith('#')).length;

const overCeiling = (name: string, count: number, ceiling: number): string[] =>
  count > ceiling
    ? [`${name} holds ${count} pins, over the ceiling of ${ceiling}: wrap the line, do not pin it`]
    : [];

describe('the pin lists only shrink', () => {
  it('holds no more markdown prose pins than its ceiling', () => {
    expect(
      overCeiling('markdown-prose-width.pinned.json', markdownPinCount(), MARKDOWN_PIN_CEILING),
    ).toEqual([]);
  });

  it('holds no more comment width pins than its ceiling', () => {
    expect(
      overCeiling('comment-line-width.pinned', commentPinCount(), COMMENT_PIN_CEILING),
    ).toEqual([]);
  });
});
