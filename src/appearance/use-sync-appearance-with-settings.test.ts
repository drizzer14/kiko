import { renderHook } from '@testing-library/react-native';
import { Appearance } from 'react-native';

import { useSyncAppearanceWithSettings } from './use-sync-appearance-with-settings';

jest.mock('../db/use-live-query', () => ({
  useLiveQuery: jest.fn(),
}));

import { useLiveQuery } from '../db/use-live-query';

const mockUseLiveQuery = useLiveQuery as jest.Mock;

// `applyAppearance` now drives the scheme through the single
// `Appearance.setColorScheme` mechanism (see appearance.ts), so this hook's
// effect is observed through that call. The live repaint itself is a native
// runtime behaviour, device-verified, not provable by the Jest mock.
describe('useSyncAppearanceWithSettings', () => {
  let setColorScheme: jest.SpyInstance;

  beforeEach(() => {
    setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("clears the native override with 'auto' for 'system'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'system' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setColorScheme).toHaveBeenCalledWith('auto');
  });

  it("pins the native override to 'light' for 'light'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'light' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setColorScheme).toHaveBeenCalledWith('light');
  });

  it("pins the native override to 'dark' for 'dark'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'dark' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setColorScheme).toHaveBeenCalledWith('dark');
  });

  it('does nothing until the settings row loads (empty data)', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setColorScheme).not.toHaveBeenCalled();
  });
});
