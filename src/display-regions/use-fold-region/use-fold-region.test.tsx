import { renderHook } from '@testing-library/react-native';
import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';

import type { FoldRegion } from '../display-regions-native';

import { useFoldRegion } from '.';

// Read through the registry, not a value import: only the wrapper may load
// the native module.
const nativeModule = jest.mocked(
  (jest.requireMock('@kiko/native-specs/NativeDisplayRegions') as { default: Spec }).default,
);

const reportFoldRegion = (foldRegion: FoldRegion): void => {
  nativeModule.getSnapshot.mockReturnValue(
    JSON.stringify({ horizontalSizeClass: 'regular', verticalBarEdge: 'leading', foldRegion }),
  );
};

afterEach(() => {
  reportFoldRegion(null);
});

describe('useFoldRegion', () => {
  it('returns the fold frame in window points while the device is partly folded', async () => {
    const gap = { x: 470, y: 0, width: 11, height: 669 };
    reportFoldRegion(gap);

    const { result } = await renderHook(() => useFoldRegion());

    expect(result.current).toEqual(gap);
  });

  it('returns null when the device is flat', async () => {
    reportFoldRegion(null);

    const { result } = await renderHook(() => useFoldRegion());

    expect(result.current).toBeNull();
  });
});
