import { renderHook } from '@testing-library/react-native';

import { i18n } from '../index';
import { useSyncLanguageWithSettings } from './use-sync-language-with-settings';

const mockData: { language: 'en' | 'uk' | null }[] = [];
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockData }),
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({}) },
}));

describe('useSyncLanguageWithSettings', () => {
  afterEach(async () => {
    mockData.length = 0;
    await i18n.changeLanguage('en');
  });

  it('changes the language when settings.language is set and differs', async () => {
    mockData.push({ language: 'uk' });
    await renderHook(() => useSyncLanguageWithSettings());

    expect(i18n.language).toBe('uk');
  });

  it('leaves the device default in place when settings.language is null', async () => {
    await i18n.changeLanguage('en');
    mockData.push({ language: null });
    await renderHook(() => useSyncLanguageWithSettings());

    expect(i18n.language).toBe('en');
  });
});
