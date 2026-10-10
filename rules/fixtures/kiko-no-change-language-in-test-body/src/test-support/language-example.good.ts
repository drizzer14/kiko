// Semgrep fixture (NEGATIVE, NESTED): the language switches only in a hook, so a failing
// assertion in a test body cannot skip the reset. `kiko-no-change-language-in-test-body`
// must draw ZERO findings from this file.
import { i18n } from '@kiko/i18n/init';
import { act } from '@testing-library/react-native';

describe('a screen under uk', () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('reads the catalogue in Ukrainian', async () => {
    expect(i18n.language).toBe('uk');
  });

  test('keeps the language through a table row', async () => {
    expect(i18n.t('common.save')).toBeTruthy();
  });
});

describe('a file-wide switch', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('uk');
  });

  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('reads the catalogue in Ukrainian', () => {
    expect(i18n.language).toBe('uk');
  });
});

it('spies on the call without making one', () => {
  const spy = jest.spyOn(i18n, 'changeLanguage');

  expect(spy).not.toHaveBeenCalled();
});

export const setLanguage = async (language: string): Promise<void> => {
  await act(async () => {
    await i18n.changeLanguage(language);
  });
};
