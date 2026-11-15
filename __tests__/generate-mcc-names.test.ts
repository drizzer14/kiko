import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { MccName } from '@kiko/categories/mcc-names';

import {
  MCC_SOURCES,
  verifySource,
  buildMccNames,
  renderMccNamesJson,
  renderReviewTable,
} from '../scripts/mcc-names/generate-mcc-names';

type GregglesRow = {
  mcc: string | number;
  edited_description: string;
  combined_description: string;
  irs_description?: string;
};
type SominemoFile = Record<string, { uk: string; ru: string }>;

const REPOSITORY_ROOT = join(__dirname, '..');
const DATA_PATH = join(REPOSITORY_ROOT, 'src/categories/mcc-names/mcc-names.data.json');

const row = (
  mcc: string | number,
  edited: string,
  combined: string = edited,
  irs: string = '',
): GregglesRow => ({
  mcc,
  edited_description: edited,
  combined_description: combined,
  irs_description: irs,
});

const ukOf = (...pairs: [string, string][]): SominemoFile =>
  Object.fromEntries(pairs.map(([code, uk]) => [code, { uk, ru: `ru ${uk}` }]));

const build = (greggles: GregglesRow[], sominemo: SominemoFile) =>
  buildMccNames({ greggles, sominemo });

const refusalOf = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }

  return undefined;
};

describe('generate MCC names', () => {
  describe('en name', () => {
    it('takes the edited description and falls back to the combined one', () => {
      const { entries } = build(
        [
          row('5411', 'Edited', 'Combined'),
          row('5812', '', 'Combined only'),
          row('4829', '  ', 'Blank edited'),
        ],
        ukOf(['5411', 'Продукти'], ['5812', 'Кафе'], ['4829', 'Переказ']),
      );

      expect(entries.map(({ en }) => en)).toEqual(['Blank edited', 'Edited', 'Combined only']);
    });

    it('refuses a code whose two descriptions are blank, naming the code', () => {
      expect(refusalOf(() => build([row('5411', ' ', '')], ukOf(['5411', 'Продукти'])))).toContain(
        '5411',
      );
    });

    it('trims and collapses spaces', () => {
      const { entries } = build(
        [
          row('5599', 'Miscellaneous Auto Dealers '),
          row('5812', ' Eating   places  and Restaurants'),
        ],
        ukOf(['5599', 'Авто'], ['5812', ' Кафе.   Ресторани ']),
      );

      expect(entries).toEqual([
        { code: '5599', en: 'Miscellaneous Auto Dealers', uk: 'Авто' },
        { code: '5812', en: 'Eating places and Restaurants', uk: 'Кафе. Ресторани' },
      ]);
    });

    it('keeps an en apostrophe as the source writes it', () => {
      const { entries } = build(
        [row('3299', 'WIDERO’S FLYVESELSKAP')],
        ukOf(['3299', 'Авіалінії']),
      );

      expect(entries[0].en).toBe('WIDERO’S FLYVESELSKAP');
    });
  });

  describe('code', () => {
    it('pads a code to four digits and keeps leading zeros', () => {
      const { entries } = build(
        [row(742, 'Veterinary Services'), row('742', 'Veterinary Services')],
        ukOf(['0742', 'Ветеринари']),
      );

      expect(entries).toEqual([{ code: '0742', en: 'Veterinary Services', uk: 'Ветеринари' }]);
    });

    it.each(['12345', 'abcd', '', '-742', '74.2'])(
      'refuses a code that is not four digits after padding: %p',
      (code) => {
        expect(refusalOf(() => build([row(code, 'Name')], ukOf(['0742', 'Ім’я'])))).toContain(
          'not four digits',
        );
      },
    );

    it('refuses a duplicate code with a different name', () => {
      expect(
        refusalOf(() =>
          build([row('5411', 'Grocery'), row('5411', 'Supermarkets')], ukOf(['5411', 'Продукти'])),
        ),
      ).toContain('5411');
    });

    it('accepts a duplicate with the same name once', () => {
      const { entries } = build(
        [row('5411', 'Grocery'), row('5411', ' Grocery ')],
        ukOf(['5411', 'Продукти']),
      );

      expect(entries).toEqual([{ code: '5411', en: 'Grocery', uk: 'Продукти' }]);
    });
  });

  describe('uk name', () => {
    it('refuses a run with a code that has no uk name, listing every such code', () => {
      const message = refusalOf(() =>
        build(
          [
            row('5411', 'Grocery'),
            row('5812', 'Restaurants'),
            row('4829', 'Wire'),
            row('6011', 'Cash'),
          ],
          ukOf(['5411', 'Продукти'], ['4829', 'Переказ']),
        ),
      );

      expect(message).toContain('5812');
      expect(message).toContain('6011');
      expect(message).not.toContain('5411');
      expect(message).not.toContain('4829');
    });

    it('refuses a code whose uk name is blank', () => {
      expect(refusalOf(() => build([row('5411', 'Grocery')], ukOf(['5411', '  '])))).toContain(
        '5411',
      );
    });

    it('rewrites an ASCII or right-quote apostrophe inside a Cyrillic word to U+02BC', () => {
      const { entries } = build(
        [row('4215', 'Couriers'), row('4814', 'Mobile'), row('5422', 'Meat')],
        ukOf(['4215', "Кур'єри"], ['4814', 'Мобільний зв’язок'], ['5422', 'М’ясо']),
      );

      expect(entries.map(({ uk }) => uk)).toEqual(['Курʼєри', 'Мобільний звʼязок', 'Мʼясо']);
    });

    it('replaces the pinned source misspelling of code 0763 with the corrected name', () => {
      const { entries } = build(
        [row('0763', 'Agricultural Co-operatives')],
        ukOf(['0763', 'Сільскогосподарські кооперативи']),
      );

      expect(entries).toEqual([
        { code: '0763', en: 'Agricultural Co-operatives', uk: 'Сільськогосподарські кооперативи' },
      ]);
    });

    it('leaves a quote outside a word', () => {
      const { entries } = build(
        [row('4829', 'Wire'), row('5411', 'Grocery'), row('5812', 'Cafe')],
        ukOf(['4829', 'Переказ ’'], ['5411', "'Продукти'"], ['5812', 'Кафе ’ Ресторани']),
      );

      expect(entries.map(({ uk }) => uk)).toEqual(['Переказ ’', "'Продукти'", 'Кафе ’ Ресторани']);
    });
  });

  describe('join', () => {
    it('drops a Sominemo-only code and reports it', () => {
      const { entries, report } = build(
        [row('5411', 'Grocery')],
        ukOf(['5411', 'Продукти'], ['9999', 'Зайве'], ['0001', 'Інше']),
      );

      expect(entries.map(({ code }) => code)).toEqual(['5411']);
      expect(report.dropped).toEqual(['0001', '9999']);
    });

    it('reports nothing dropped when both files hold the same codes', () => {
      const { report } = build([row('5411', 'Grocery')], ukOf(['5411', 'Продукти']));

      expect(report.dropped).toEqual([]);
    });

    it('sorts the entries by code', () => {
      const sominemo = ukOf(['5411', 'Продукти'], ['0742', 'Ветеринари'], ['1520', 'Будівництво']);
      const { entries } = build(
        [row('5411', 'Grocery'), row('1520', 'Contractors'), row('742', 'Veterinary')],
        sominemo,
      );

      expect(entries.map(({ code }) => code)).toEqual(['0742', '1520', '5411']);
    });

    it('reads Sominemo by code and not by key order', () => {
      const sominemo = JSON.parse(
        '{"5411":{"uk":"Продукти","ru":"x"},"0742":{"uk":"Ветеринари","ru":"y"}}',
      );
      const { entries } = build([row('0742', 'Veterinary'), row('5411', 'Grocery')], sominemo);

      expect(entries.map(({ uk }) => uk)).toEqual(['Ветеринари', 'Продукти']);
    });
  });

  describe('group and merchant name', () => {
    it('joins the uk group and the en merchant name for a code 3000-3999 whose en is not its group text', () => {
      const { entries } = build(
        [row('3000', 'UNITED AIRLINES', 'UNITED AIRLINES', 'Airlines')],
        ukOf(['3000', 'Авіалінії']),
      );

      expect(entries).toEqual([
        { code: '3000', en: 'UNITED AIRLINES', uk: 'Авіалінії — UNITED AIRLINES' },
      ]);
      expect(entries[0]).not.toHaveProperty('listed');
    });

    it('marks a code 3000-3999 whose en equals its group text as not listed and keeps its uk', () => {
      const { entries } = build(
        [row('3003', 'Airlines', 'Airlines', 'Airlines')],
        ukOf(['3003', 'Авіалінії']),
      );

      expect(entries).toEqual([{ code: '3003', en: 'Airlines', uk: 'Авіалінії', listed: false }]);
    });

    it('treats a code 3000-3999 with a blank group text as a merchant name', () => {
      const { entries } = build(
        [row('3816', 'Home2Suites', 'Home2Suites', '')],
        ukOf(['3816', 'Готелі']),
      );

      expect(entries).toEqual([{ code: '3816', en: 'Home2Suites', uk: 'Готелі — Home2Suites' }]);
    });

    it('never joins or hides a code outside 3000-3999', () => {
      const { entries } = build(
        [
          row('2999', 'Same', 'Same', 'Same'),
          row('3999', 'Same', 'Same', 'Same'),
          row('4000', 'Same', 'Same', 'Same'),
          row('4011', 'Railroads', 'Railroads', 'Railroads'),
        ],
        ukOf(['2999', 'Один'], ['3999', 'Два'], ['4000', 'Три'], ['4011', 'Залізниці']),
      );

      expect(entries).toEqual([
        { code: '2999', en: 'Same', uk: 'Один' },
        { code: '3999', en: 'Same', uk: 'Два', listed: false },
        { code: '4000', en: 'Same', uk: 'Три' },
        { code: '4011', en: 'Railroads', uk: 'Залізниці' },
      ]);
    });

    it('keeps the en casing and apostrophe in the joined uk name, after the uk apostrophe rewrite', () => {
      const { entries } = build(
        [row('3299', 'WIDERO’S FLYVESELSKAP'), row('3300', 'Plane', 'Plane', 'Airlines')],
        ukOf(['3299', 'Авіалінії'], ['3300', "Кур'єрські авіалінії"]),
      );

      expect(entries.map(({ uk }) => uk)).toEqual([
        'Авіалінії — WIDERO’S FLYVESELSKAP',
        'Курʼєрські авіалінії — Plane',
      ]);
    });

    it('compares the group text trimmed', () => {
      const { entries } = build(
        [row('3003', 'Airlines', 'Airlines', ' Airlines ')],
        ukOf(['3003', 'Авіалінії']),
      );

      expect(entries).toEqual([{ code: '3003', en: 'Airlines', uk: 'Авіалінії', listed: false }]);
    });
  });

  describe('source check', () => {
    const text = '[{"mcc":"0742"}]';
    const sha256 = createHash('sha256').update(text).digest('hex');

    it('accepts a source whose SHA-256 matches the pinned one', () => {
      expect(() => verifySource(text, sha256)).not.toThrow();
    });

    it('refuses a source whose SHA-256 differs from the pinned one', () => {
      expect(refusalOf(() => verifySource(`${text} `, sha256))).toContain(
        'differs from the pinned',
      );
    });
  });

  describe('output', () => {
    const entries: MccName[] = [
      { code: '0742', en: 'Veterinary Services', uk: 'Ветеринари' },
      { code: '5411', en: 'Grocery Stores, Supermarkets', uk: 'Продукти' },
    ];

    const hiddenEntry: MccName = {
      code: '3003',
      en: 'Airlines',
      uk: 'Авіалінії',
      listed: false,
    };
    const listedFlagTrue: MccName = {
      code: '3004',
      en: 'Airlines',
      uk: 'Авіалінії',
      listed: true,
    };

    it('renders the entries as a JSON array with code, en, uk and listed only when false, ending in a newline', () => {
      const extended = [...entries, hiddenEntry, listedFlagTrue].map((entry) => ({
        ...entry,
        extra: 'x',
      }));
      const expected = [...entries, hiddenEntry, { code: '3004', en: 'Airlines', uk: 'Авіалінії' }];
      const rendered = renderMccNamesJson(extended);

      expect(JSON.parse(rendered)).toEqual(expected);
      expect(rendered).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    });

    it('renders a review table with one line per code', () => {
      const lines = renderReviewTable([...entries, hiddenEntry])
        .split('\n')
        .filter(Boolean);

      expect(lines).toEqual([
        '0742\tVeterinary Services\tВетеринари\t',
        '5411\tGrocery Stores, Supermarkets\tПродукти\t',
        '3003\tAirlines\tАвіалінії\thidden',
      ]);
    });
  });

  describe('sources', () => {
    it('MCC_SOURCES pins full forty-character commits and sixty-four-character SHA-256 values', () => {
      const { greggles, sominemo } = MCC_SOURCES;

      for (const source of [greggles, sominemo]) {
        expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
      }

      expect(greggles).toMatchObject({
        url: 'https://raw.githubusercontent.com/greggles/mcc-codes/df792275c567946119a8903d36dbd33e44a248bf/mcc_codes.json',
        commit: 'df792275c567946119a8903d36dbd33e44a248bf',
        sha256: '60fff0a4457e18dd03731a8971f219f2d1e4b22a13c1d930aaac07badbfe8e68',
        license: 'Unlicense',
      });
      expect(sominemo).toMatchObject({
        url: 'https://raw.githubusercontent.com/Sominemo/MCC-Localize-Dataset/7b3cbceeb3fbbd6a27dbe489b25abe82552ddff2/mcc-loc.json',
        commit: '7b3cbceeb3fbbd6a27dbe489b25abe82552ddff2',
        sha256: 'ed32d9bfca87862580d3228b1a23203a07e9a9152b4b1cca6bd2f0c765a01347',
        license: 'MIT',
      });
    });
  });
});

const regenerateSuite = process.env.KIKO_REGEN_MCC === '1' ? describe : describe.skip;

regenerateSuite('regenerate the MCC names data', () => {
  it('verifies both downloads, then writes the data file and the review table', () => {
    const gregglesPath = process.env.KIKO_MCC_GREGGLES;
    const sominemoPath = process.env.KIKO_MCC_SOMINEMO;
    const reviewPath = process.env.KIKO_MCC_REVIEW_OUT;

    if (gregglesPath === undefined) {
      throw new Error('KIKO_MCC_GREGGLES is not set: the path of the greggles download');
    }

    if (sominemoPath === undefined) {
      throw new Error('KIKO_MCC_SOMINEMO is not set: the path of the sominemo download');
    }

    if (reviewPath === undefined) {
      throw new Error('KIKO_MCC_REVIEW_OUT is not set: the path to write the review table to');
    }

    const gregglesText = readFileSync(gregglesPath, 'utf8');
    const sominemoText = readFileSync(sominemoPath, 'utf8');

    verifySource(gregglesText, MCC_SOURCES.greggles.sha256);
    verifySource(sominemoText, MCC_SOURCES.sominemo.sha256);

    const { entries } = buildMccNames({
      greggles: JSON.parse(gregglesText),
      sominemo: JSON.parse(sominemoText),
    });

    writeFileSync(DATA_PATH, renderMccNamesJson(entries), 'utf8');
    writeFileSync(reviewPath, renderReviewTable(entries), 'utf8');

    expect(entries.length).toBeGreaterThan(0);
  });
});
