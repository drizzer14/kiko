import { Dimensions } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';

import type { HorizontalSizeClass } from '../display-regions-native';

import { useIsLargeWindow } from '.';

// Read through the registry, not a value import: only the wrapper may load
// the native module.
const nativeModule = jest.mocked(
  (jest.requireMock('@kiko/native-specs/NativeDisplayRegions') as { default: Spec }).default,
);

const reportSizeClass = (horizontalSizeClass: HorizontalSizeClass): void => {
  nativeModule.getSnapshot.mockReturnValue(
    JSON.stringify({ horizontalSizeClass, verticalBarEdge: 'none', foldRegion: null }),
  );
};

const setWindow = async (width: number, height: number): Promise<void> => {
  const frame = { width, height, scale: 3, fontScale: 1 };

  await act(async () => {
    Dimensions.set({ window: frame, screen: frame });
  });
};

afterEach(() => {
  reportSizeClass('compact');
});

describe('useIsLargeWindow', () => {
  it('follows a window change from a full-screen iPad to a split-view window', async () => {
    reportSizeClass('regular');
    await setWindow(1376, 1032);
    const { result } = await renderHook(() => useIsLargeWindow());

    expect(result.current).toBe(true);

    await setWindow(1032, 683);

    expect(result.current).toBe(false);
  });

  it('is false for a compact window however large', async () => {
    reportSizeClass('compact');
    await setWindow(1376, 1032);

    const { result } = await renderHook(() => useIsLargeWindow());

    expect(result.current).toBe(false);
  });
});
