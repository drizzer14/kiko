import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

type MccName = { code: string; en: string; uk: string };
type GregglesRow = {
  mcc: string | number;
  edited_description: string;
  combined_description: string;
};
type SominemoFile = Record<string, { uk: string; ru: string }>;
type BuildResult = { entries: MccName[]; report: { dropped: string[] } };
type Source = { url: string; commit: string; sha256: string; license: string };
type Generator = {
  MCC_SOURCES: { greggles: Source; sominemo: Source };
  verifySource: (text: string, expectedSha256: string) => void;
  buildMccNames: (input: { greggles: GregglesRow[]; sominemo: SominemoFile }) => BuildResult;
  renderMccNamesJson: (entries: MccName[]) => string;
  renderReviewTable: (entries: MccName[]) => string;
};

const REPOSITORY_ROOT = join(__dirname, '..');
const GENERATOR_PATH = join(REPOSITORY_ROOT, 'scripts/mcc-names/generate-mcc-names.js');
const DATA_PATH = join(REPOSITORY_ROOT, 'src/categories/mcc-names/mcc-names.data.json');

// A runtime lookup, so the staged typecheck passes while the module is missing.
const generator = (): Generator => require(GENERATOR_PATH);

const row = (mcc: string | number, edited: string, combined: string = edited): GregglesRow => ({
  mcc,
  edited_description: edited,
  combined_description: combined,
});

const ukOf = (...pairs: [string, string][]): SominemoFile =>
  Object.fromEntries(pairs.map(([code, uk]) => [code, { uk, ru: `ru ${uk}` }]));

const build = (greggles: GregglesRow[], sominemo: SominemoFile) =>
  generator().buildMccNames({ greggles, sominemo });

const refusalOf = (greggles: GregglesRow[], sominemo: SominemoFile): string | undefined => {
  const { buildMccNames } = generator();

  try {
    buildMccNames({ greggles, sominemo });
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
      expect(refusalOf([row('5411', ' ', '')], ukOf(['5411', 'Продукти']))).toContain('5411');
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
        expect(refusalOf([row(code, 'Name')], ukOf(['0742', 'Ім’я']))).toEqual(expect.any(String));
      },
    );

    it('refuses a duplicate code with a different name', () => {
      expect(
        refusalOf(
          [row('5411', 'Grocery'), row('5411', 'Supermarkets')],
          ukOf(['5411', 'Продукти']),
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
      const message = refusalOf(
        [
          row('5411', 'Grocery'),
          row('5812', 'Restaurants'),
          row('4829', 'Wire'),
          row('6011', 'Cash'),
        ],
        ukOf(['5411', 'Продукти'], ['4829', 'Переказ']),
      );

      expect(message).toContain('5812');
      expect(message).toContain('6011');
      expect(message).not.toContain('5411');
      expect(message).not.toContain('4829');
    });

    it('refuses a code whose uk name is blank', () => {
      expect(refusalOf([row('5411', 'Grocery')], ukOf(['5411', '  ']))).toContain('5411');
    });

    it('rewrites an ASCII or right-quote apostrophe inside a Cyrillic word to U+02BC', () => {
      const { entries } = build(
        [row('4215', 'Couriers'), row('4814', 'Mobile'), row('5422', 'Meat')],
        ukOf(['4215', "Кур'єри"], ['4814', 'Мобільний зв’язок'], ['5422', 'М’ясо']),
      );

      expect(entries.map(({ uk }) => uk)).toEqual(['Курʼєри', 'Мобільний звʼязок', 'Мʼясо']);
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

  describe('source check', () => {
    const text = '[{"mcc":"0742"}]';
    const sha256 = createHash('sha256').update(text).digest('hex');
    const refusalOfSource = (changedText: string): string | undefined => {
      const { verifySource } = generator();

      try {
        verifySource(changedText, sha256);
      } catch (error) {
        return (error as Error).message;
      }

      return undefined;
    };

    it('accepts a source whose SHA-256 matches the pinned one', () => {
      expect(() => generator().verifySource(text, sha256)).not.toThrow();
    });

    it('refuses a source whose SHA-256 differs from the pinned one', () => {
      expect(refusalOfSource(`${text} `)).toEqual(expect.any(String));
    });
  });

  describe('output', () => {
    const entries: MccName[] = [
      { code: '0742', en: 'Veterinary Services', uk: 'Ветеринари' },
      { code: '5411', en: 'Grocery Stores, Supermarkets', uk: 'Продукти' },
    ];

    it('renders the entries as a JSON array with only code, en and uk, ending in a newline', () => {
      const extended = entries.map((entry) => ({ ...entry, extra: 'x' }));
      const rendered = generator().renderMccNamesJson(extended);

      expect(JSON.parse(rendered)).toEqual(entries);
      expect(rendered).toBe(`${JSON.stringify(entries, null, 2)}\n`);
    });

    it('renders a review table with one line per code', () => {
      const lines = generator().renderReviewTable(entries).split('\n').filter(Boolean);

      expect(lines).toEqual([
        '0742\tVeterinary Services\tВетеринари',
        '5411\tGrocery Stores, Supermarkets\tПродукти',
      ]);
    });
  });

  describe('sources', () => {
    it('MCC_SOURCES pins full forty-character commits and sixty-four-character SHA-256 values', () => {
      const { greggles, sominemo } = generator().MCC_SOURCES;

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
    const { MCC_SOURCES, verifySource, buildMccNames, renderMccNamesJson, renderReviewTable } =
      generator();
    const gregglesText = readFileSync(process.env.KIKO_MCC_GREGGLES as string, 'utf8');
    const sominemoText = readFileSync(process.env.KIKO_MCC_SOMINEMO as string, 'utf8');

    verifySource(gregglesText, MCC_SOURCES.greggles.sha256);
    verifySource(sominemoText, MCC_SOURCES.sominemo.sha256);

    const { entries } = buildMccNames({
      greggles: JSON.parse(gregglesText),
      sominemo: JSON.parse(sominemoText),
    });

    writeFileSync(DATA_PATH, renderMccNamesJson(entries), 'utf8');
    writeFileSync(process.env.KIKO_MCC_REVIEW_OUT as string, renderReviewTable(entries), 'utf8');

    expect(entries.length).toBeGreaterThan(0);
  });
});
