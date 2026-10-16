import { i18n } from '@kiko/i18n/init';

const headingKeys = [
  ['target', 'Holding currency'],
  ['held', 'Your currencies'],
  ['fiat', 'Currencies'],
  ['crypto', 'Crypto'],
] as const;

describe('currencyField group headings', () => {
  it.each(headingKeys)('names the %s group "%s" in English', (kind, text) => {
    expect(i18n.t(`components.currencyField.groups.${kind}`, { lng: 'en' })).toBe(text);
  });

  it.each(headingKeys)('has a Ukrainian text for the %s group', (kind) => {
    const key = `components.currencyField.groups.${kind}` as const;
    const ukrainian = i18n.t(key, { lng: 'uk' });

    expect(ukrainian).not.toBe(key);
    expect(ukrainian.trim()).not.toBe('');
  });
});
