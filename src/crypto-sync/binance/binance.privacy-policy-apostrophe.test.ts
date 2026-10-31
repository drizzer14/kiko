import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const ROOT = path.join(__dirname, '../../..');

const RIGHT_SINGLE_QUOTE = '’';

const POLICY_FILES: readonly (readonly [string, string])[] = [
  ['docs/privacy-policy.md', readFileSync(path.join(ROOT, 'docs/privacy-policy.md'), 'utf-8')],
  [
    'docs/privacy-site/en.html',
    readFileSync(path.join(ROOT, 'docs/privacy-site/en.html'), 'utf-8'),
  ],
  [
    'docs/privacy-site/index.html',
    readFileSync(path.join(ROOT, 'docs/privacy-site/index.html'), 'utf-8'),
  ],
];

const linesWithRightSingleQuote = (text: string): number[] =>
  text.split('\n').flatMap((line, index) => (line.includes(RIGHT_SINGLE_QUOTE) ? [index + 1] : []));

// The Ukrainian apostrophe is the modifier letter U+02BC, as in the uk catalogue (see
// uk.catalog-rules.test.ts); a typographic U+2019 in the policy reads as a closing quote.
describe('the privacy policy pages and the Ukrainian apostrophe', () => {
  it('checks every built page of the site', () => {
    const pages = readdirSync(path.join(ROOT, 'docs/privacy-site')).filter((name) =>
      name.endsWith('.html'),
    );

    expect(pages.sort()).toEqual(['en.html', 'index.html']);
  });

  it('finds the line of a right single quote and lets U+02BC through', () => {
    expect(linesWithRightSingleQuote('one\nз ім’ям\nthree')).toEqual([2]);
    expect(linesWithRightSingleQuote('one\nз імʼям\nthree')).toEqual([]);
  });

  it.each(POLICY_FILES)('has no right single quote (U+2019) in %s', (_file, text) => {
    expect(linesWithRightSingleQuote(text)).toEqual([]);
  });
});
