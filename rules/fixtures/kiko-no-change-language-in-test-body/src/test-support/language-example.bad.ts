// Semgrep fixture (POSITIVE, NESTED): kiko-no-change-language-in-test-body carries a
// path-prefixed `paths.include` entry (`src/test-support/**`), which draws NOTHING against a
// fixture placed directly in rules/fixtures/ (kiko-linter's "Semgrep facts" gotcha), so this
// fixture mirrors a real src/test-support/ path instead. The rule MUST report a finding on
// each pinned line: a `changeLanguage` call inside an `it`/`test` body, however the body
// wraps it.
import { i18n } from '@kiko/i18n/init';
import { act } from '@testing-library/react-native';

describe('a screen under uk', () => {
  it('switches inside the body', async () => {
    // EXPECT-FINDING
    await i18n.changeLanguage('uk');
  });

  it('switches inside act', async () => {
    await act(async () => {
      // EXPECT-FINDING
      await i18n.changeLanguage('uk');
    });
  });

  it('switches and resets inside the body', async () => {
    // EXPECT-FINDING
    await i18n.changeLanguage('uk');
    // EXPECT-FINDING
    await i18n.changeLanguage('en');
  });

  test('switches inside a test body', async () => {
    // EXPECT-FINDING
    await i18n.changeLanguage('uk');
  });

  it.only('switches inside a focused it', async () => {
    // EXPECT-FINDING
    await i18n.changeLanguage('uk');
  });

  it.each(['uk', 'en'])('switches inside a table row for %s', async (language) => {
    // EXPECT-FINDING
    await i18n.changeLanguage(language);
  });

  test.each(['uk', 'en'])('switches inside a test table row for %s', async (language) => {
    // EXPECT-FINDING
    await i18n.changeLanguage(language);
  });

  it('switches inside a body with a timeout', async () => {
    // EXPECT-FINDING
    await i18n.changeLanguage('uk');
  }, 10000);
});
