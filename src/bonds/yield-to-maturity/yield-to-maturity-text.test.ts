import { i18n } from '@kiko/i18n/init';

import { yieldToMaturityText } from './yield-to-maturity-text';

describe('yieldToMaturityText', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows a yield as a percent with two decimals', () => {
    expect(yieldToMaturityText(0.153998)).toBe('15.40%');
  });

  it('follows the active language for the decimal mark', async () => {
    await i18n.changeLanguage('uk');

    expect(yieldToMaturityText(0.153998)).toBe('15,40%');
  });
});
