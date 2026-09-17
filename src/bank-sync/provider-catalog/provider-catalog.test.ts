import { i18n } from '../../i18n';

import { providerCatalog } from './provider-catalog';

describe('provider catalog', () => {
  it('lists exactly the four native providers, in id order', () => {
    expect(providerCatalog.map((entry) => entry.id)).toEqual([
      'monobank',
      'privatbank',
      'bunq',
      'starling',
    ]);
  });

  it.each(providerCatalog)(
    "resolves $id's about/dataProvided/eligibility keys to real text in en and uk",
    async (entry) => {
      for (const language of ['en', 'uk'] as const) {
        await i18n.changeLanguage(language);

        expect(i18n.t(entry.aboutKey)).not.toBe(entry.aboutKey);
        expect(i18n.t(entry.dataProvidedKey)).not.toBe(entry.dataProvidedKey);
        expect(i18n.t(entry.eligibilityKey)).not.toBe(entry.eligibilityKey);
      }

      await i18n.changeLanguage('en');
    },
  );
});
