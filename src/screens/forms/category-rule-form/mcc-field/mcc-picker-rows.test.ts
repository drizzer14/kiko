import { mccNameOf } from '@kiko/categories/mcc-names';

type MccEntry = { code: string; name: string | undefined };

type MccPickerRow =
  | { type: 'other' }
  | { type: 'heading'; section: 'own' | 'all' }
  | { type: 'ownEmpty' }
  | { type: 'noMatch' }
  | {
      type: 'code';
      section: 'own' | 'all';
      code: string;
      name: string | undefined;
      rowCount?: number;
    };

type PickerInput = {
  own: readonly { mcc: number; rowCount: number }[];
  ownLoading: boolean;
  query: string;
  language: string;
};

type PickerRows = {
  matchesMccQuery: (entry: MccEntry, query: string) => boolean;
  mccPickerRows: (input: PickerInput) => MccPickerRow[];
};

const pickerRows = (): PickerRows => require('./mcc-picker-rows');

const matchesMccQuery = (entry: MccEntry, query: string): boolean =>
  pickerRows().matchesMccQuery(entry, query);

const mccPickerRows = (input: PickerInput): MccPickerRow[] => pickerRows().mccPickerRows(input);

const allRow = (code: string, name: string | undefined): MccPickerRow => ({
  type: 'code',
  section: 'all',
  code,
  name,
});

const nameOf = (code: string, language: string): string | undefined => mccNameOf(code, language);

describe('matchesMccQuery', () => {
  it('a digits-only query matches codes that start with it', () => {
    expect(matchesMccQuery({ code: '5411', name: nameOf('5411', 'en') }, '54')).toBe(true);
    expect(matchesMccQuery({ code: '1543', name: 'Anything' }, '54')).toBe(false);
  });

  it('a text query matches the name by substring, any case', () => {
    const entry = { code: '5411', name: nameOf('5411', 'en') };

    expect(matchesMccQuery(entry, 'groc')).toBe(true);
    expect(matchesMccQuery(entry, '  SUPERMARK ')).toBe(true);
    expect(matchesMccQuery(entry, 'pharmacy')).toBe(false);
  });

  it('folds an ASCII apostrophe, U+2019 and U+02BC to one character in the query and the name', () => {
    const ukName = nameOf('5422', 'uk');

    expect(ukName).toContain('ʼ');
    expect(matchesMccQuery({ code: '5422', name: ukName }, "м'ясо")).toBe(true);
    expect(matchesMccQuery({ code: '5422', name: ukName }, 'м’ясо')).toBe(true);
    expect(matchesMccQuery({ code: '5422', name: ukName }, 'мʼясо')).toBe(true);
    expect(matchesMccQuery({ code: '0001', name: "Об'єкт" }, 'обʼєкт')).toBe(true);
    expect(matchesMccQuery({ code: '0001', name: 'Обʼєкт' }, "об'єкт")).toBe(true);
  });

  it('an en name with an apostrophe matches a typed apostrophe', () => {
    expect(matchesMccQuery({ code: '0001', name: 'Men’s and Boys’ Clothing' }, "men's")).toBe(true);
    expect(matchesMccQuery({ code: '0002', name: "Men's and Boys' Clothing" }, "men's")).toBe(true);
    expect(matchesMccQuery({ code: '5611', name: nameOf('5611', 'en') }, "men's and boy's")).toBe(
      true,
    );
  });

  it('a blank query matches every code', () => {
    expect(matchesMccQuery({ code: '5411', name: 'Grocery Stores' }, '')).toBe(true);
    expect(matchesMccQuery({ code: '0042', name: undefined }, '   ')).toBe(true);
  });

  it('an unlisted code matches only by digits', () => {
    expect(matchesMccQuery({ code: '0042', name: undefined }, '00')).toBe(true);
    expect(matchesMccQuery({ code: '0042', name: undefined }, 'grocery')).toBe(false);
    expect(matchesMccQuery({ code: '0042', name: undefined }, '54')).toBe(false);
  });
});

describe('mccPickerRows', () => {
  it('puts Other first, then own codes by the order given, then every code by code', () => {
    const rows = mccPickerRows({
      own: [
        { mcc: 5812, rowCount: 9 },
        { mcc: 5411, rowCount: 3 },
      ],
      ownLoading: false,
      query: '5',
      language: 'en',
    });

    expect(rows.slice(0, 5)).toEqual([
      { type: 'other' },
      { type: 'heading', section: 'own' },
      { type: 'code', section: 'own', code: '5812', name: nameOf('5812', 'en'), rowCount: 9 },
      { type: 'code', section: 'own', code: '5411', name: nameOf('5411', 'en'), rowCount: 3 },
      { type: 'heading', section: 'all' },
    ]);

    const allCodes = rows.slice(5).map((row) => (row.type === 'code' ? row.code : row.type));

    expect(allCodes.length).toBeGreaterThan(100);
    expect(allCodes).toEqual([...allCodes].sort());
    expect(rows.slice(5).every((row) => row.type === 'code' && row.section === 'all')).toBe(true);
  });

  it('gives an own code its count and an unlisted own code no name', () => {
    expect(
      mccPickerRows({
        own: [{ mcc: 42, rowCount: 1 }],
        ownLoading: false,
        query: '0042',
        language: 'en',
      }),
    ).toEqual([
      { type: 'other' },
      { type: 'heading', section: 'own' },
      { type: 'code', section: 'own', code: '0042', name: undefined, rowCount: 1 },
    ]);

    expect(
      mccPickerRows({
        own: [{ mcc: 5411, rowCount: 12 }],
        ownLoading: false,
        query: '5411',
        language: 'en',
      }),
    ).toEqual([
      { type: 'other' },
      { type: 'heading', section: 'own' },
      { type: 'code', section: 'own', code: '5411', name: nameOf('5411', 'en'), rowCount: 12 },
      { type: 'heading', section: 'all' },
      allRow('5411', nameOf('5411', 'en')),
    ]);
  });

  it('shows the own heading and the empty row when the read landed with no codes', () => {
    const rows = mccPickerRows({ own: [], ownLoading: false, query: '', language: 'en' });

    expect(rows.slice(0, 4)).toEqual([
      { type: 'other' },
      { type: 'heading', section: 'own' },
      { type: 'ownEmpty' },
      { type: 'heading', section: 'all' },
    ]);
    expect(rows[4]).toEqual(expect.objectContaining({ type: 'code', section: 'all' }));
  });

  it('shows the own heading alone while the read is loading', () => {
    const rows = mccPickerRows({ own: [], ownLoading: true, query: '', language: 'en' });

    expect(rows.slice(0, 3)).toEqual([
      { type: 'other' },
      { type: 'heading', section: 'own' },
      { type: 'heading', section: 'all' },
    ]);
    expect(rows.some((row) => row.type === 'ownEmpty')).toBe(false);
  });

  it('drops a section and its heading when the query empties it, and keeps Other', () => {
    expect(
      mccPickerRows({
        own: [{ mcc: 1520, rowCount: 2 }],
        ownLoading: false,
        query: '5411',
        language: 'en',
      }),
    ).toEqual([
      { type: 'other' },
      { type: 'heading', section: 'all' },
      allRow('5411', nameOf('5411', 'en')),
    ]);

    expect(
      mccPickerRows({
        own: [{ mcc: 42, rowCount: 1 }],
        ownLoading: false,
        query: '0042',
        language: 'en',
      }),
    ).toEqual([
      { type: 'other' },
      { type: 'heading', section: 'own' },
      { type: 'code', section: 'own', code: '0042', name: undefined, rowCount: 1 },
    ]);
  });

  it('shows the no-match row when the query empties both sections', () => {
    expect(
      mccPickerRows({
        own: [{ mcc: 5411, rowCount: 3 }],
        ownLoading: false,
        query: 'zzzzqqqq',
        language: 'en',
      }),
    ).toEqual([{ type: 'other' }, { type: 'noMatch' }]);
  });

  it('names each code in the current language', () => {
    const input = {
      own: [{ mcc: 5411, rowCount: 3 }],
      ownLoading: false,
      query: '5411',
    };

    expect(mccPickerRows({ ...input, language: 'uk' })).toEqual([
      { type: 'other' },
      { type: 'heading', section: 'own' },
      { type: 'code', section: 'own', code: '5411', name: 'Продукти', rowCount: 3 },
      { type: 'heading', section: 'all' },
      allRow('5411', 'Продукти'),
    ]);
    expect(mccPickerRows({ ...input, language: 'en' })).toEqual([
      { type: 'other' },
      { type: 'heading', section: 'own' },
      {
        type: 'code',
        section: 'own',
        code: '5411',
        name: 'Grocery Stores, Supermarkets',
        rowCount: 3,
      },
      { type: 'heading', section: 'all' },
      allRow('5411', 'Grocery Stores, Supermarkets'),
    ]);
  });
});
