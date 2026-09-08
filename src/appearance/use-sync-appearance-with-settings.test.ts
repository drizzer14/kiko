import { act, renderHook } from '@testing-library/react-native';
import { Appearance } from 'react-native';
import { UnistylesRuntime } from 'react-native-unistyles';

import { useSyncAppearanceWithSettings } from './use-sync-appearance-with-settings';

jest.mock('../db/use-live-query', () => ({
  useLiveQuery: jest.fn(),
}));

import { useLiveQuery } from '../db/use-live-query';

const mockUseLiveQuery = useLiveQuery as jest.Mock;

// Option B: adaptiveThemes is OFF, so `applyAppearance` drives the JS theme via
// `UnistylesRuntime.setTheme` and the native chrome via
// `Appearance.setColorScheme`. This hook additionally installs a manual OS
// change listener WHILE the persisted appearance is 'system' (adaptive no
// longer follows the OS for us), gated so it never overrides a manual pin. The
// live repaint itself is a native runtime behaviour, device-verified, not
// provable by the Jest mock.
describe('useSyncAppearanceWithSettings', () => {
  let setColorScheme: jest.SpyInstance;
  let setTheme: jest.SpyInstance;
  let addChangeListener: jest.SpyInstance;
  let osListener: ((prefs: { colorScheme: 'light' | 'dark' | null }) => void) | undefined;
  let removeListener: jest.Mock;

  beforeEach(() => {
    setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    setTheme = jest.spyOn(UnistylesRuntime, 'setTheme').mockImplementation(() => {});
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');
    osListener = undefined;
    removeListener = jest.fn();
    addChangeListener = jest.spyOn(Appearance, 'addChangeListener').mockImplementation((cb) => {
      osListener = cb as typeof osListener;
      return { remove: removeListener };
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it("clears the native override with 'auto' and drives the JS theme from the OS for 'system'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'system' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setColorScheme).toHaveBeenCalledWith('auto');
    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it("pins both the JS theme and native override to 'light' for 'light'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'light' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setColorScheme).toHaveBeenCalledWith('light');
    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it("pins both the JS theme and native override to 'dark' for 'dark'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'dark' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setColorScheme).toHaveBeenCalledWith('dark');
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('does nothing until the settings row loads (empty data)', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(setColorScheme).not.toHaveBeenCalled();
    expect(addChangeListener).not.toHaveBeenCalled();
  });

  it("registers an OS change listener while in 'system' and flips the JS theme on an OS change", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'system' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(addChangeListener).toHaveBeenCalledTimes(1);

    setTheme.mockClear();
    osListener?.({ colorScheme: 'dark' });
    expect(setTheme).toHaveBeenCalledWith('dark');

    setTheme.mockClear();
    osListener?.({ colorScheme: null });
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it("registers NO OS change listener while pinned to 'light'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'light' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(addChangeListener).not.toHaveBeenCalled();
  });

  it("registers NO OS change listener while pinned to 'dark'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'dark' }] });
    await renderHook(() => useSyncAppearanceWithSettings());
    expect(addChangeListener).not.toHaveBeenCalled();
  });

  it("removes the OS change listener when the appearance changes away from 'system'", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'system' }] });
    const { rerender } = await renderHook(() => useSyncAppearanceWithSettings());
    expect(removeListener).not.toHaveBeenCalled();

    mockUseLiveQuery.mockReturnValue({ data: [{ appearance: 'light' }] });
    await act(async () => {
      rerender(undefined);
    });
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
