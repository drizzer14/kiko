import { Appearance } from 'react-native';
import { renderHook } from '@testing-library/react-native';

import { readAppearanceMirror, writeAppearanceMirror } from '../appearance-mirror';

import { useSyncAppearanceWithSettings } from './use-sync-appearance-with-settings';

const mockData: { appearance: string; language?: string }[] = [];
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockData }),
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({}) },
}));
jest.mock('@kiko/appearance/appearance-mirror/appearance-mirror', () => ({
  writeAppearanceMirror: jest.fn(),
  readAppearanceMirror: jest.fn(),
}));

describe('useSyncAppearanceWithSettings', () => {
  const setColorScheme = jest.spyOn(Appearance, 'setColorScheme');

  beforeEach(() => {
    setColorScheme.mockImplementation(() => {});
  });

  afterEach(() => {
    mockData.length = 0;
    jest.clearAllMocks();
  });

  it('does nothing while the row is unloaded', async () => {
    await renderHook(() => useSyncAppearanceWithSettings());

    expect(writeAppearanceMirror).not.toHaveBeenCalled();
    expect(setColorScheme).not.toHaveBeenCalled();
  });

  it('row wins over a stale mirror on mount', async () => {
    jest.mocked(readAppearanceMirror).mockReturnValue('light');
    mockData.push({ appearance: 'system' });

    await renderHook(() => useSyncAppearanceWithSettings());

    expect(writeAppearanceMirror).toHaveBeenCalledWith('system');
    expect(setColorScheme).toHaveBeenCalledWith('auto');
  });

  it('writes the mirror, then applies, on a change', async () => {
    mockData.push({ appearance: 'system' });
    const { rerender } = await renderHook(() => useSyncAppearanceWithSettings());
    jest.clearAllMocks();

    mockData[0] = { appearance: 'light' };
    await rerender({});

    expect(writeAppearanceMirror).toHaveBeenCalledWith('light');
    expect(setColorScheme).toHaveBeenCalledWith('light');
    expect(jest.mocked(writeAppearanceMirror).mock.invocationCallOrder[0]).toBeLessThan(
      setColorScheme.mock.invocationCallOrder[0],
    );
  });

  it('applies auto when the change is to system', async () => {
    mockData.push({ appearance: 'dark' });
    const { rerender } = await renderHook(() => useSyncAppearanceWithSettings());
    jest.clearAllMocks();

    mockData[0] = { appearance: 'system' };
    await rerender({});

    expect(writeAppearanceMirror).toHaveBeenCalledWith('system');
    expect(setColorScheme).toHaveBeenCalledWith('auto');
  });

  it('does not re-apply when another settings column changes', async () => {
    mockData.push({ appearance: 'light', language: 'en' });
    const { rerender } = await renderHook(() => useSyncAppearanceWithSettings());
    jest.clearAllMocks();

    mockData[0] = { appearance: 'light', language: 'uk' };
    await rerender({});

    expect(writeAppearanceMirror).not.toHaveBeenCalled();
    expect(setColorScheme).not.toHaveBeenCalled();
  });

  it('a stored value outside the enum reads as system', async () => {
    mockData.push({ appearance: 'LIGHT' });

    await renderHook(() => useSyncAppearanceWithSettings());

    expect(writeAppearanceMirror).toHaveBeenCalledWith('system');
    expect(setColorScheme).toHaveBeenCalledWith('auto');
  });
});
