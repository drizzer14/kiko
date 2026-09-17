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

  it('marks only Monobank and Starling as release-connect-ready', () => {
    const readyIds = providerCatalog.filter((entry) => entry.connectReady).map((entry) => entry.id);

    expect(readyIds).toEqual(['monobank', 'starling']);
  });

  it.each(providerCatalog)(
    "resolves $id's about/dataProvided/eligibility keys to non-empty text in en and uk",
    async (entry) => {
      for (const language of ['en', 'uk'] as const) {
        await i18n.changeLanguage(language);

        expect(i18n.t(entry.aboutKey).length).toBeGreaterThan(0);
        expect(i18n.t(entry.dataProvidedKey).length).toBeGreaterThan(0);
        expect(i18n.t(entry.eligibilityKey).length).toBeGreaterThan(0);
      }

      await i18n.changeLanguage('en');
    },
  );
});
