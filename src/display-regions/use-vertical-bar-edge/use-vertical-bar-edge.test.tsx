import { renderHook } from '@testing-library/react-native';
import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';

import type { VerticalBarEdge } from '../display-regions-native';

import { useVerticalBarEdge } from '.';

// Read through the registry, not a value import: only the wrapper may load
// the native module.
const nativeModule = jest.mocked(
  (jest.requireMock('@kiko/native-specs/NativeDisplayRegions') as { default: Spec }).default,
);

const reportBarEdge = (verticalBarEdge: VerticalBarEdge): void => {
  nativeModule.getSnapshot.mockReturnValue(
    JSON.stringify({ horizontalSizeClass: 'compact', verticalBarEdge, foldRegion: null }),
  );
};

afterEach(() => {
  reportBarEdge('none');
});

describe('useVerticalBarEdge', () => {
  it.each<VerticalBarEdge>(['leading', 'trailing', 'none'])(
    'returns the %s edge the snapshot reports',
    async (verticalBarEdge) => {
      reportBarEdge(verticalBarEdge);

      const { result } = await renderHook(() => useVerticalBarEdge());

      expect(result.current).toBe(verticalBarEdge);
    },
  );
});
