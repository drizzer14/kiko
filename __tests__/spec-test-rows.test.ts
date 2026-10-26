import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import { rowProblems, testRowsOf, titlesOf } from './test-support/spec-test-rows';

const REPOSITORY = join(__dirname, '..');
const SPEC = join(REPOSITORY, 'docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md');
const BINANCE = 'src/crypto-sync/binance/';

const tableOf = (...rows: string[]): string =>
  ['## 7. Section', '', '| # | Input | Test |', '|---|---|---|', ...rows, '', '## 8. Next'].join(
    '\n',
  );

const problemsOf = (rows: string[], sources: Record<string, string>): string[] =>
  rowProblems(testRowsOf(tableOf(...rows), '## 7.'), (path) => sources[path]);

const SOURCE = "describe('a group', () => { it('does a thing', () => {}); });";

describe('titlesOf', () => {
  it('reads the first literal of it, test and describe calls', () => {
    expect(titlesOf(`describe("one", () => { test('two', f); it(\`three\`, f); });`)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('reads the title after a table call, with brackets and quotes inside the table', () => {
    const source =
      "it.each([['a (b)', [1]], ['c', ')']])(\n  'fails for %s',\n  async () => {},\n);";

    expect(titlesOf(source)).toEqual(['fails for %s']);
  });

  it('reads no title from a call whose first argument is not a text literal', () => {
    expect(titlesOf('it(name, f); expect(it)(x); other.it("no", f);')).toEqual([]);
  });
});

describe('rowProblems', () => {
  it('accepts a bare name, a src path and two files in one cell', () => {
    expect(
      problemsOf(
        [
          '| R1 | x | `a.test.ts`: "does a thing" |',
          '| R2 | x | `src/other/b.test.tsx`, "a group"; `a.test.ts`: "does a thing" |',
        ],
        { [`${BINANCE}a.test.ts`]: SOURCE, 'src/other/b.test.tsx': SOURCE },
      ),
    ).toEqual([]);
  });

  it('takes the first file of the row above for a same row', () => {
    expect(
      problemsOf(['| R1 | x | `a.test.ts`: "does a thing" |', '| R2 | x | same, "a group" |'], {
        [`${BINANCE}a.test.ts`]: SOURCE,
      }),
    ).toEqual([]);
  });

  it('checks a same row title against the file above', () => {
    expect(
      problemsOf(['| R1 | x | `a.test.ts`: "does a thing" |', '| R2 | x | same, "other" |'], {
        [`${BINANCE}a.test.ts`]: SOURCE,
      }),
    ).toEqual([`R2: "other" is no title in ${BINANCE}a.test.ts`]);
  });

  it('keeps the file a same row names itself', () => {
    expect(
      problemsOf(
        ['| R1 | x | `a.test.ts`: "does a thing" |', '| R2 | x | same (`b.test.ts`), "a group" |'],
        { [`${BINANCE}a.test.ts`]: SOURCE, [`${BINANCE}b.test.ts`]: SOURCE },
      ),
    ).toEqual([]);
  });

  it('fails a file that does not exist', () => {
    expect(problemsOf(['| R1 | x | `gone.test.ts`: "a group" |'], {})).toEqual([
      `R1: ${BINANCE}gone.test.ts does not exist`,
    ]);
  });

  it('fails a title the file does not hold', () => {
    expect(
      problemsOf(['| R1 | x | `a.test.ts`: "does a thing", "never written" |'], {
        [`${BINANCE}a.test.ts`]: SOURCE,
      }),
    ).toEqual([`R1: "never written" is no title in ${BINANCE}a.test.ts`]);
  });

  it('fails a path that is neither a bare name nor a src path', () => {
    expect(
      problemsOf(['| R1 | x | `run/a.test.ts`: "a group" |'], { [`${BINANCE}a.test.ts`]: SOURCE }),
    ).toContain('R1: run/a.test.ts is a partial path');
  });

  it('fails a row that quotes no title', () => {
    expect(problemsOf(['| R1 | x | `a.test.ts` |'], { [`${BINANCE}a.test.ts`]: SOURCE })).toContain(
      'R1: quotes no title',
    );
  });

  it('fails a file named with no title after it, in a row that quotes titles for another', () => {
    expect(
      problemsOf(['| R1 | x | `a.test.ts`: "a group"; `b.test.ts` (notes) |'], {
        [`${BINANCE}a.test.ts`]: SOURCE,
        [`${BINANCE}b.test.ts`]: SOURCE,
      }),
    ).toEqual([`R1: ${BINANCE}b.test.ts has no title quoted after it`]);
  });

  it('reads only the tables whose last header cell is Test', () => {
    const markdown = [
      '## 7. Section',
      '| # | Notes |',
      '|---|---|',
      '| R1 | `gone.test.ts` |',
      '',
      '## 8. Next',
      '| # | Test |',
      '|---|---|',
      '| R2 | `gone.test.ts` |',
    ].join('\n');

    expect(testRowsOf(markdown, '## 7.')).toEqual([]);
  });
});

describe('the spec', () => {
  it('each Test cell of the spec names an existing test file and titles found in it', () => {
    const rows = testRowsOf(readFileSync(SPEC, 'utf8'), '## 7.');
    const problems = rowProblems(rows, (path) =>
      existsSync(join(REPOSITORY, path)) ? readFileSync(join(REPOSITORY, path), 'utf8') : undefined,
    );

    expect(rows.map(({ id }) => id)).toEqual(expect.arrayContaining(['TC1', 'TW21']));
    expect(problems).toEqual([]);
  });
});
