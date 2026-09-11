// src/i18n/active-locale.test.ts

import { i18n } from '../index';

import { activeLocale } from './active-locale';

describe('activeLocale', () => {
  it('returns en-US for the English language', async () => {
    await i18n.changeLanguage('en');
    expect(activeLocale()).toBe('en-US');
  });

  it('returns uk-UA for the Ukrainian language', async () => {
    await i18n.changeLanguage('uk');
    expect(activeLocale()).toBe('uk-UA');
  });
});
