import type { ParsedStatement } from '../../../statement-import/parser';

import { previewStats } from './preview-stats';

describe('previewStats', () => {
  it('reduces the parsed transactions to count/currency/date-span, in the given display name', () => {
    const parsed: ParsedStatement = {
      formatId: 'monobank-csv',
      account: { currency: 'UAH' },
      transactions: [
        {
          currency: 'UAH',
          amountMinorUnits: -1_000,
          timeSeconds: 1_751_364_900,
          description: 'Coffee',
        },
        {
          currency: 'UAH',
          amountMinorUnits: 5_000,
          timeSeconds: 1_751_455_845,
          description: 'Salary',
        },
      ],
    };

    const stats = previewStats(parsed, 'Monobank (CSV)');

    expect(stats.displayName).toBe('Monobank (CSV)');
    expect(stats.transactionCount).toBe(2);
    expect(stats.currency).toBe('UAH');
    expect(stats.maskedCardHints).toEqual([]);
    expect(stats.unresolvedRowCount).toBe(0);
    expect(stats.detectedCurrencies).toEqual(['UAH']);
  });

  it('reduces the min/max timeSeconds to a date span regardless of on-file row order', () => {
    const parsed: ParsedStatement = {
      formatId: 'monobank-csv',
      account: { currency: 'UAH' },
      transactions: [
        { currency: 'UAH', amountMinorUnits: 1, timeSeconds: 1_751_455_845, description: 'Later' },
        {
          currency: 'UAH',
          amountMinorUnits: 1,
          timeSeconds: 1_751_364_900,
          description: 'Earlier',
        },
      ],
    };

    const stats = previewStats(parsed, 'Monobank (CSV)');

    expect(stats.dateSpan).toMatch(/–/);
  });

  it('collects distinct masked-card hints in first-seen order, omitting rows with none', () => {
    const parsed: ParsedStatement = {
      formatId: 'privatbank-xlsx',
      account: { currency: 'UAH' },
      transactions: [
        {
          currency: 'UAH',
          amountMinorUnits: 1,
          timeSeconds: 1,
          description: 'A',
          maskedCardHint: '1111',
        },
        { currency: 'UAH', amountMinorUnits: 1, timeSeconds: 2, description: 'B' },
        {
          currency: 'UAH',
          amountMinorUnits: 1,
          timeSeconds: 3,
          description: 'C',
          maskedCardHint: '1111',
        },
        {
          currency: 'USD',
          amountMinorUnits: 1,
          timeSeconds: 4,
          description: 'D',
          maskedCardHint: '2222',
        },
      ],
    };

    const stats = previewStats(parsed, 'PrivatBank (XLSX)');

    expect(stats.maskedCardHints).toEqual(['1111', '2222']);
    expect(stats.detectedCurrencies).toEqual(['UAH', 'USD']);
  });

  it('reports the unresolvedRows length, defaulting to 0 when the format never sets it', () => {
    const parsed: ParsedStatement = {
      formatId: 'privatbank-xlsx',
      account: { currency: 'UAH' },
      transactions: [],
      unresolvedRows: [
        { reason: 'invalid-amount', description: 'A', rawAmount: 'garbage' },
        { reason: 'unmapped-currency', description: 'B', rawCurrency: 'XYZ' },
      ],
    };

    const stats = previewStats(parsed, 'PrivatBank (XLSX)');

    expect(stats.unresolvedRowCount).toBe(2);
  });
});
