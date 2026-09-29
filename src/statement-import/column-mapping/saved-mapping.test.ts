import {
  findSavedMapping,
  headerFingerprint,
  mappingKeyFor,
  type SavedColumnMapping,
} from './saved-mapping';
import type { TableCell } from './table-rows';
import type { ColumnMapping } from './apply-column-mapping';

const baseMapping: ColumnMapping = {
  headerRowIndex: 0,
  decimalSeparator: '.',
  dateColumn: 0,
  dateFormat: 'DD.MM.YYYY HH:MM:SS',
  amount: { mode: 'single', column: 2 },
  descriptionColumn: 1,
  currency: { mode: 'fixed', currency: 'UAH' },
};

const HEADER_ROW: TableCell[] = ['Date', 'Description', 'Amount'];
const OTHER_HEADER_ROW: TableCell[] = ['Дата', 'Опис', 'Сума'];

const savedFor = (row: TableCell[]): SavedColumnMapping => ({
  ...baseMapping,
  fingerprint: headerFingerprint(row),
  savedAt: 1_700_000_000_000,
});

describe('headerFingerprint', () => {
  it('joins trimmed cell text with U+241F', () => {
    expect(headerFingerprint([' Date ', 'Description', 'Amount '])).toBe('Date␟Description␟Amount');
  });

  it('normalizes a number cell to its string form', () => {
    expect(headerFingerprint([1, ' two '])).toBe('1␟two');
  });
});

describe('mappingKeyFor', () => {
  it('keys a catalog bank id as bank:<bankId>', () => {
    expect(mappingKeyFor('monobank', 'ignored-fingerprint')).toBe('bank:monobank');
  });

  it('keys an unrecognized/absent bank as header:<fingerprint>', () => {
    expect(mappingKeyFor(undefined, 'abc123')).toBe('header:abc123');
    expect(mappingKeyFor(null, 'abc123')).toBe('header:abc123');
    expect(mappingKeyFor('not-a-real-bank', 'abc123')).toBe('header:abc123');
  });
});

describe('findSavedMapping', () => {
  it('returns undefined when there is nothing saved', () => {
    expect(findSavedMapping({}, 'monobank', [HEADER_ROW])).toBeUndefined();
    expect(findSavedMapping(undefined, 'monobank', [HEADER_ROW])).toBeUndefined();
  });

  it('finds a bank mapping and marks it exact when the header matches', () => {
    const mapping = savedFor(HEADER_ROW);
    const saved = { 'bank:monobank': mapping };

    const result = findSavedMapping(saved, 'monobank', [HEADER_ROW]);

    expect(result).toEqual({ mapping, exact: true });
  });

  it('finds a bank mapping but marks it inexact when the header differs (pre-fill only)', () => {
    const mapping = savedFor(HEADER_ROW);
    const saved = { 'bank:monobank': mapping };

    const result = findSavedMapping(saved, 'monobank', [OTHER_HEADER_ROW]);

    expect(result).toEqual({ mapping, exact: false });
  });

  it('finds an "Other" file by its header: entry fingerprint', () => {
    const mapping = savedFor(OTHER_HEADER_ROW);
    const saved = {
      'header:some-other-fingerprint': savedFor(HEADER_ROW),
      'header:this-one': mapping,
    };

    const result = findSavedMapping(saved, undefined, [OTHER_HEADER_ROW]);

    expect(result).toEqual({ mapping, exact: true });
  });

  it('does not fall back to a header: entry for a known bank with no saved bank mapping', () => {
    const saved = { 'header:whatever': savedFor(HEADER_ROW) };

    expect(findSavedMapping(saved, 'monobank', [HEADER_ROW])).toBeUndefined();
  });
});
