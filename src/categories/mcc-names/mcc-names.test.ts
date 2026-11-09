import { categoryForMcc } from '@kiko/monobank/mcc-category';

import { MCC_NAMES_NOTICE } from './mcc-names.notice';
import { MCC_NAMES_NOTICE as BARREL_NOTICE } from '.';
import { MCC_NAMES, MCC_NAME_SEPARATOR, mccNameOf, mccLabelOf } from './mcc-names';

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

type ListedEntry = { code: string; en: string; uk: string; listed?: unknown };

const entries: readonly ListedEntry[] = MCC_NAMES;
const JOIN_SEPARATOR = ' — ';
const FIRST_GROUP_CODE = 3000;
const LAST_GROUP_CODE = 3999;
const JOINED_COUNT = 422;
const HIDDEN_COUNT = 261;
const GROUP_NAMES_EN = ['Airlines', 'Car Rental', 'Hotels/Motels/Inns/Resorts'];
const GROUP_NAMES_UK = ['Авіалінії', 'Оренда авто', 'Готелі. Курорти'];

const inGroupRange = ({ code }: ListedEntry) =>
  Number(code) >= FIRST_GROUP_CODE && Number(code) <= LAST_GROUP_CODE;
const isJoined = ({ en, uk }: ListedEntry) => uk.endsWith(`${JOIN_SEPARATOR}${en}`);
const isHidden = ({ listed }: ListedEntry) => listed === false;
const ukOfEntry = (code: string) => entries.find((entry) => entry.code === code)?.uk;

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

describe('MCC_NAMES merchant names and hidden group codes', () => {
  it(`joins the group and the merchant name in Ukrainian for exactly ${JOINED_COUNT} codes`, () => {
    const joined = entries.filter(isJoined);

    expect(joined).toHaveLength(JOINED_COUNT);
    expect(joined.filter((entry) => !inGroupRange(entry))).toEqual([]);
    expect(ukOfEntry('3000')).toBe('Авіалінії — UNITED AIRLINES');
    expect(ukOfEntry('3005')).toBe('Авіалінії — BRITISH AIRWAYS');
    expect(isJoined(entries.find((entry) => entry.code === '3501') as ListedEntry)).toBe(true);
    expect(ukOfEntry('3816')).toBe('Готелі — Home2Suites');
    expect(nameOfCode('3000')?.en).toBe('UNITED AIRLINES');
  });

  it(`hides exactly ${HIDDEN_COUNT} group-only codes, all in 3000-3999, each named only by a group`, () => {
    const hidden = entries.filter(isHidden);

    expect(hidden).toHaveLength(HIDDEN_COUNT);
    expect(hidden.filter((entry) => !inGroupRange(entry))).toEqual([]);
    expect(hidden.filter(({ en }) => !GROUP_NAMES_EN.includes(en))).toEqual([]);
    expect(hidden.filter(({ uk }) => !GROUP_NAMES_UK.includes(uk))).toEqual([]);
    expect(hidden.map(({ code }) => code)).toContain('3003');
  });

  it('holds listed only as false', () => {
    expect(entries.filter(({ listed }) => listed !== undefined && listed !== false)).toEqual([]);
  });

  it('keeps the general codes listed and unjoined', () => {
    const general = entries.filter(({ code }) => ['4511', '7011', '7512'].includes(code));

    expect(general).toHaveLength(3);
    expect(general.filter((entry) => 'listed' in entry || entry.uk.includes(' — '))).toEqual([]);
  });

  it('names a hidden code in every lookup', () => {
    expect(mccNameOf('3003', 'uk')).toBe('Авіалінії');
    expect(mccLabelOf('3003', 'en')).toBe('3003 – Airlines');
    expect(mccLabelOf('3000', 'uk')).toBe('3000 – Авіалінії — UNITED AIRLINES');
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

describe('bundled MCC names notice', () => {
  it('reaches the notice from the module the rule card imports', () => {
    expect(BARREL_NOTICE).toBe(MCC_NAMES_NOTICE);
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
