import { categoryForMcc } from '@kiko/monobank/mcc-category';

type MccName = { code: string; en: string; uk: string };

type MccNamesModule = {
  MCC_NAMES: readonly MccName[];
  MCC_NAME_SEPARATOR: string;
  mccNameOf: (code: string, language: string) => string | undefined;
  mccLabelOf: (code: string, language: string) => string;
};

// A runtime lookup keeps the typecheck green while the module is not written yet.
const { MCC_NAMES, MCC_NAME_SEPARATOR, mccNameOf, mccLabelOf } = jest.requireActual(
  './mcc-names',
) as MccNamesModule;

const MEASURED_CODE_COUNT = 981;
const CODE_PATTERN = /^\d{4}$/;
const CONTROL_CHARACTER = /\p{Cc}/u;
const CYRILLIC = 'А-Яа-яЁёІіЇїЄєҐґ';
const QUOTE_INSIDE_CYRILLIC_WORD = new RegExp(`[${CYRILLIC}]['’][${CYRILLIC}]`);

const FIRST_UNNAMED_IN_THREE_THOUSANDS = 3791;
const LAST_UNNAMED_IN_THREE_THOUSANDS = 3999;
const NAMED_INSIDE_UNNAMED_RANGE = [3816, 3835];
const CARD_TOPUP_CODE = 6540;
const FIRST_UNNAMED_RANGE_LENGTH =
  LAST_UNNAMED_IN_THREE_THOUSANDS - FIRST_UNNAMED_IN_THREE_THOUSANDS + 1;

const codesTheSourcesLeaveOut = [
  ...Array.from(
    { length: FIRST_UNNAMED_RANGE_LENGTH },
    (_, index) => FIRST_UNNAMED_IN_THREE_THOUSANDS + index,
  ).filter((code) => !NAMED_INSIDE_UNNAMED_RANGE.includes(code)),
  CARD_TOPUP_CODE,
].sort((left, right) => left - right);

const nameOfCode = (code: string) => MCC_NAMES.find((entry) => entry.code === code);

describe('MCC_NAMES', () => {
  it('holds each code once', () => {
    const codes = MCC_NAMES.map((entry) => entry.code);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('holds only four-digit codes', () => {
    expect(MCC_NAMES.filter((entry) => !CODE_PATTERN.test(entry.code))).toEqual([]);
  });

  it('is sorted by code', () => {
    const codes = MCC_NAMES.map((entry) => entry.code);

    expect(codes).toEqual([...codes].sort());
  });

  it(`holds exactly ${MEASURED_CODE_COUNT} codes`, () => {
    expect(MCC_NAMES).toHaveLength(MEASURED_CODE_COUNT);
  });

  it('gives every code a non-empty English and Ukrainian name, trimmed, with no control character', () => {
    const badEntries = MCC_NAMES.filter(({ en, uk }) =>
      [en, uk].some(
        (name) =>
          typeof name !== 'string' ||
          name === '' ||
          name !== name.trim() ||
          CONTROL_CHARACTER.test(name),
      ),
    );

    expect(badEntries).toEqual([]);
  });

  it('uses the U+02BC apostrophe in every Ukrainian name', () => {
    expect(MCC_NAMES.filter(({ uk }) => QUOTE_INSIDE_CYRILLIC_WORD.test(uk))).toEqual([]);
  });

  it('holds the common codes', () => {
    expect(
      ['5411', '5812', '4829', '6011', '0742'].filter((code) => nameOfCode(code) === undefined),
    ).toEqual([]);
  });

  it('names every code the category map knows except the codes the sources leave out', () => {
    const named = new Set(MCC_NAMES.map((entry) => Number(entry.code)));
    const unnamedMappedCodes = Array.from({ length: 10_000 }, (_, code) => code).filter(
      (code) => categoryForMcc(code) !== 'other' && !named.has(code),
    );

    expect(unnamedMappedCodes).toEqual(codesTheSourcesLeaveOut);
  });
});

describe('mccNameOf', () => {
  it('gives the name per language and undefined for an unlisted code', () => {
    const entry = nameOfCode('5411');

    expect(entry).toBeDefined();
    expect(mccNameOf('5411', 'en')).toBe(entry?.en);
    expect(mccNameOf('5411', 'uk')).toBe(entry?.uk);
    expect(mccNameOf('0042', 'en')).toBeUndefined();
    expect(mccNameOf('0042', 'uk')).toBeUndefined();
  });

  it('treats a language other than uk as en', () => {
    expect(mccNameOf('5411', 'de')).toBe(nameOfCode('5411')?.en);
    expect(mccNameOf('5411', '')).toBe(nameOfCode('5411')?.en);
  });
});

describe('mccLabelOf', () => {
  it('joins code and name with an en dash and shows an unlisted code as its digits', () => {
    expect(MCC_NAME_SEPARATOR).toBe(' – ');
    expect(mccLabelOf('5411', 'en')).toBe(`5411${MCC_NAME_SEPARATOR}${nameOfCode('5411')?.en}`);
    expect(mccLabelOf('5411', 'uk')).toBe(`5411${MCC_NAME_SEPARATOR}${nameOfCode('5411')?.uk}`);
    expect(mccLabelOf('0042', 'en')).toBe('0042');
  });
});
