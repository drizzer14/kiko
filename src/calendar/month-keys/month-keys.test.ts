import { en } from '@kiko/i18n/locales';

import { MONTH_KEYS } from '.';

describe('MONTH_KEYS', () => {
  it('lists the twelve months, January first', () => {
    expect(MONTH_KEYS).toHaveLength(12);
    expect(MONTH_KEYS[0]).toBe('january');
    expect(MONTH_KEYS[11]).toBe('december');
  });

  it('names a full and a short month in the catalogue for every key', () => {
    expect(Object.keys(en.calendar.month)).toEqual(expect.arrayContaining([...MONTH_KEYS]));
    expect(Object.keys(en.calendar.monthShort)).toEqual(expect.arrayContaining([...MONTH_KEYS]));
  });
});
