import { MCC_NAMES, mccNameOf } from '@kiko/categories/mcc-names';

type MccEntry = { code: string; name: string | undefined };

type MccPickerSection = 'own' | 'all';

export type MccPickerRow =
  | { type: 'other' }
  | { type: 'heading'; section: MccPickerSection }
  | { type: 'ownEmpty' }
  | { type: 'noMatch' }
  | {
      type: 'code';
      section: MccPickerSection;
      code: string;
      name: string | undefined;
      rowCount?: number;
    };

type MccCodeRow = Extract<MccPickerRow, { type: 'code' }>;

type MccPickerInput = {
  own: readonly { mcc: number; rowCount: number }[];
  ownLoading: boolean;
  query: string;
  language: string;
};

const DIGITS_ONLY = /^\d+$/;

const CODE_LENGTH = 4;

// The sources write an apostrophe as ASCII, U+2019 or U+02BC; one fold on the query and the name
// lets any of them find any other.
const foldText = (text: string): string => text.trim().toLowerCase().replace(/['’ʼ]/g, "'");

export const matchesMccQuery = (entry: MccEntry, query: string): boolean => {
  const folded = foldText(query);

  if (folded === '') {
    return true;
  }

  if (DIGITS_ONLY.test(folded)) {
    return entry.code.startsWith(folded);
  }

  return entry.name !== undefined && foldText(entry.name).includes(folded);
};

const withHeading = (
  section: MccPickerSection,
  rows: readonly MccCodeRow[],
): readonly MccPickerRow[] => (rows.length === 0 ? [] : [{ type: 'heading', section }, ...rows]);

export const mccPickerRows = ({
  own,
  ownLoading,
  query,
  language,
}: MccPickerInput): MccPickerRow[] => {
  const blankQuery = foldText(query) === '';

  const ownRows = own
    .map(({ mcc, rowCount }): MccCodeRow => {
      const code = String(mcc).padStart(CODE_LENGTH, '0');

      return { type: 'code', section: 'own', code, name: mccNameOf(code, language), rowCount };
    })
    .filter((row) => matchesMccQuery(row, query));

  const allRows = MCC_NAMES.map(
    ({ code }): MccCodeRow => ({
      type: 'code',
      section: 'all',
      code,
      name: mccNameOf(code, language),
    }),
  ).filter((row) => matchesMccQuery(row, query));

  if (ownRows.length === 0 && allRows.length === 0 && !blankQuery) {
    return [{ type: 'other' }, { type: 'noMatch' }];
  }

  const ownSection: readonly MccPickerRow[] =
    ownRows.length > 0 || !blankQuery
      ? withHeading('own', ownRows)
      : [
          { type: 'heading', section: 'own' },
          ...(ownLoading ? [] : [{ type: 'ownEmpty' } as const]),
        ];

  return [{ type: 'other' }, ...ownSection, ...withHeading('all', allRows)];
};
