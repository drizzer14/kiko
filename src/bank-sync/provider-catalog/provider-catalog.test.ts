import { i18n } from '../../i18n';

import { providerCatalog } from './provider-catalog';

describe('provider catalog', () => {
  it('lists exactly the sole shipped native provider (Guideline 5.6 remediation: Monobank-only)', () => {
    expect(providerCatalog.map((entry) => entry.id)).toEqual(['monobank']);
  });

  it.each(providerCatalog)(
    "resolves $id's about/eligibility keys to non-empty text in en and uk",
    async (entry) => {
      for (const language of ['en', 'uk'] as const) {
        await i18n.changeLanguage(language);

        expect(i18n.t(entry.aboutKey).length).toBeGreaterThan(0);
        expect(i18n.t(entry.eligibilityKey).length).toBeGreaterThan(0);
      }

      await i18n.changeLanguage('en');
    },
  );
});
