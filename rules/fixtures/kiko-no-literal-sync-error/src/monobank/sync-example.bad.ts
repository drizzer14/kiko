// Semgrep fixture (POSITIVE, NESTED): kiko-no-literal-sync-error carries a
// path-prefixed `paths.include: ["src/crypto-sync/**", "src/monobank/**"]`,
// which draws NOTHING against a fixture placed directly in rules/fixtures/
// (kiko-linter's "Semgrep facts" gotcha) — so this fixture is nested to
// mirror a real src/monobank/ path instead. Never move it back to a flat
// rules/fixtures/kiko-no-literal-sync-error.bad.ts location.
import { i18n } from '@kiko/i18n/init';

export const readClientStatus = (status: number): number => {
  if (status !== 200) {
    // EXPECT-FINDING
    throw new Error(`Monobank sync failed with status ${status}`);
  }

  return status;
};

export const readClientStatusLocalized = (status: number): number => {
  if (status !== 200) {
    throw new Error(i18n.t('accountDetail.monobankRequestFailed', { status }));
  }

  return status;
};
