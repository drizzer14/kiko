import { en } from '@kiko/i18n/locales';

import { MONTH_KEYS } from '.';

describe('MONTH_KEYS', () => {
  it('names a full and a short month in the catalogue for every key', () => {
    expect(Object.keys(en.calendar.month)).toEqual(expect.arrayContaining([...MONTH_KEYS]));
    expect(Object.keys(en.calendar.monthShort)).toEqual(expect.arrayContaining([...MONTH_KEYS]));
  });
});
