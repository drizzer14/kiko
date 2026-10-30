import { Dimensions } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';

import type { HorizontalSizeClass } from '../display-regions-native';

import { useLayoutMode } from '.';

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

describe('useLayoutMode', () => {
  it('is single for a compact window', async () => {
    reportSizeClass('compact');
    await setWindow(390, 844);

    const { result } = await renderHook(() => useLayoutMode());

    expect(result.current).toBe('single');
  });

  it('is columns for a regular window wider than tall', async () => {
    reportSizeClass('regular');
    await setWindow(951, 669);

    const { result } = await renderHook(() => useLayoutMode());

    expect(result.current).toBe('columns');
  });

  it('turns to single when the window narrows below two minimum panes', async () => {
    reportSizeClass('regular');
    await setWindow(951, 669);
    const { result } = await renderHook(() => useLayoutMode());

    await setWindow(669, 951);

    expect(result.current).toBe('single');
  });
});
