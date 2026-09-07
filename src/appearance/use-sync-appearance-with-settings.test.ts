import { renderHook } from '@testing-library/react-native';
import { UnistylesRuntime } from 'react-native-unistyles';

import { useSyncAppearanceWithSettings } from './use-sync-appearance-with-settings';

jest.mock('../db/use-live-query', () => ({
  useLiveQuery: jest.fn(),
}));

import { useLiveQuery } from '../db/use-live-query';

const mockUseLiveQuery = useLiveQuery as jest.Mock;

describe('useSyncAppearanceWithSettings', () => {
  let setAdaptive: jest.SpyInstance;
  let setTheme: jest.SpyInstance;

  beforeEach(() => {
    setAdaptive = jest.spyOn(UnistylesRuntime, 'setAdaptiveThemes').mockImplementation(() => {});
    setTheme = jest.spyOn(UnistylesRuntime, 'setTheme').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("enables adaptiveThemes for 'system'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'system' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setAdaptive).toHaveBeenCalledWith(true);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("pins the light theme for 'light'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'light' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setAdaptive).toHaveBeenCalledWith(false);
    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it("pins the dark theme for 'dark'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'dark' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setAdaptive).toHaveBeenCalledWith(false);
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('does nothing until the settings row loads (empty data)', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setAdaptive).not.toHaveBeenCalled();
    expect(setTheme).not.toHaveBeenCalled();
  });
});
