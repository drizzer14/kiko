import { i18n } from '@kiko/i18n/init';

const headingKeys = [
  ['target', 'Holding currency', 'Валюта активу'],
  ['held', 'Your currencies', 'Ваші валюти'],
  ['fiat', 'Currencies', 'Валюти'],
  ['crypto', 'Crypto', 'Криптовалюти'],
] as const;

describe('currencyField group headings', () => {
  it.each(headingKeys)('names the %s group "%s" in English', (kind, text) => {
    expect(i18n.t(`components.currencyField.groups.${kind}`, { lng: 'en' })).toBe(text);
  });

  it.each(headingKeys)('names the %s group "%s" in Ukrainian "%s"', (kind, _english, text) => {
    expect(i18n.t(`components.currencyField.groups.${kind}`, { lng: 'uk' })).toBe(text);
  });
});
