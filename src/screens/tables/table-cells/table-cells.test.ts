import { i18n } from '@kiko/i18n/init';
import { calendarMonthsBetween } from '@kiko/dates';

import {
  averageCellOf,
  cellOf,
  columnsOf,
  monthColumnsOf,
  openingColumnIndexOf,
  type Spoken,
} from '.';

const spoken: Spoken = { baseCurrency: 'UAH', locale: 'en', t: i18n.t };

describe('cellOf', () => {
  it('writes whole units and speaks the full amount', () => {
    expect(cellOf(1_234_56, 'Net, January 2025', spoken)).toEqual({
      text: '1,235',
      accessibilityLabel: 'Net, January 2025',
      accessibilityValue: '1,234.56 ₴',
    });
  });

  it('marks a negative amount', () => {
    expect(cellOf(-1_234_56, 'Net', spoken).tone).toBe('negative');
  });

  it('marks no amount that reads as zero in whole units', () => {
    const cell = cellOf(-40, 'Net', spoken);

    expect(cell.text).toBe('0');
    expect(cell.tone).toBeUndefined();
  });

  it('marks an amount on the half unit, which rounds away from zero to a signed unit', () => {
    const cell = cellOf(-50, 'Net', spoken);

    expect(cell.text).toBe('-1');
    expect(cell.tone).toBe('negative');
  });

  it('marks no amount on the half unit above zero', () => {
    const cell = cellOf(50, 'Net', spoken);

    expect(cell.text).toBe('1');
    expect(cell.tone).toBeUndefined();
  });
});

describe('averageCellOf', () => {
  it('rounds the mean to whole units', () => {
    const cell = averageCellOf(1_000_40.4, 'Average', spoken);

    expect(cell.text).toBe('1,000');
    expect(cell.accessibilityValue).toBe('1,000.40 ₴');
  });

  it('marks a negative mean that rounds to the half unit, as the cell shows it', () => {
    const cell = averageCellOf(-50.4, 'Average', spoken);

    expect(cell.text).toBe('-1');
    expect(cell.tone).toBe('negative');
  });

  it('shows a dash and says that no month is complete', () => {
    const cell = averageCellOf(null, 'Average', spoken);

    expect(cell.text).toBe('–');
    expect(cell.accessibilityValue).toBe('No complete month yet');
  });
});

describe('the columns', () => {
  const months = calendarMonthsBetween(
    new Date(2025, 0, 1).getTime(),
    new Date(2025, 4, 31).getTime(),
  );

  it('are a column per month, then the Total and the Average', () => {
    expect(columnsOf(months, i18n.t).map((column) => column.header)).toEqual([
      'Jan 2025',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Total',
      'Average',
    ]);
  });

  it('of the months alone carry no sum, and the other columns follow them', () => {
    expect(monthColumnsOf(months, i18n.t).map((column) => column.header)).toEqual([
      'Jan 2025',
      'Feb',
      'Mar',
      'Apr',
      'May',
    ]);
    expect(monthColumnsOf(months, i18n.t).some((column) => column.isSum === true)).toBe(false);
    expect(columnsOf(months, i18n.t).slice(0, months.length)).toEqual(
      monthColumnsOf(months, i18n.t),
    );
  });

  it('open at the third month from the end, or the first column of a short period', () => {
    expect(openingColumnIndexOf(months)).toBe(2);
    expect(openingColumnIndexOf(months.slice(0, 2))).toBe(0);
  });
});
