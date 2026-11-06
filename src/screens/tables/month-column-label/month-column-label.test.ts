import { i18n } from '@kiko/i18n/init';
import { calendarMonthOf } from '@kiko/dates';
import { act } from '@testing-library/react-native';

import { monthColumnLabel, monthTitle } from '.';

const monthOf = (year: number, monthIndex: number) =>
  calendarMonthOf(new Date(year, monthIndex, 12).getTime());

describe('monthColumnLabel', () => {
  it('names a month with its three letters', () => {
    expect(monthColumnLabel(monthOf(2025, 1), false, i18n.t)).toBe('Feb');
    expect(monthColumnLabel(monthOf(2025, 11), false, i18n.t)).toBe('Dec');
  });

  it('adds the year in January', () => {
    expect(monthColumnLabel(monthOf(2025, 0), false, i18n.t)).toBe('Jan 2025');
  });

  it('adds the year in the first column, whatever its month', () => {
    expect(monthColumnLabel(monthOf(2024, 8), true, i18n.t)).toBe('Sep 2024');
  });

  it('gives each of the twelve months a distinct three-letter name', () => {
    const names = Array.from({ length: 12 }, (_unused, index) =>
      monthColumnLabel(monthOf(2025, index), false, i18n.t).slice(0, 3),
    );

    expect(new Set(names).size).toBe(12);
    expect(names.every((name) => name.length === 3)).toBe(true);
  });

  describe('under the uk language', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('names the month in Ukrainian and puts the year in January', () => {
      expect(monthColumnLabel(monthOf(2025, 0), false, i18n.t)).toBe('Січ 2025');
      expect(monthColumnLabel(monthOf(2025, 8), false, i18n.t)).toBe('Вер');
      expect(monthColumnLabel(monthOf(2025, 10), false, i18n.t)).toBe('Лис');
    });
  });
});

describe('monthTitle', () => {
  it('spells the month in full with its year, for a spoken label', () => {
    expect(monthTitle(monthOf(2025, 2), i18n.t)).toBe('March 2025');
  });
});
