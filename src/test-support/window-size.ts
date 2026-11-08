import { Dimensions } from 'react-native';
import { act } from '@testing-library/react-native';
import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';
import type { HorizontalSizeClass, VerticalBarEdge } from '@kiko/display-regions';

// Read through the registry, not a value import: only the display-regions wrapper may load the
// native module.
const nativeModule = jest.mocked(
  (jest.requireMock('@kiko/native-specs/NativeDisplayRegions') as { default: Spec }).default,
);

const setDimensions = (width: number, height: number): void => {
  const frame = { width, height, scale: 3, fontScale: 1 };

  Dimensions.set({ window: frame, screen: frame });
};

/**
 * The window a test renders into: the size class and the vertical-bar edge (the side bar's edge;
 * `none` is a bottom bar) the native module reports, and the window size.
 * The wrapper reads the size class once per mounted tree, so call this before the first render;
 * `resizeWindow` changes the size of a mounted one.
 */
export const reportWindow = (
  horizontalSizeClass: HorizontalSizeClass,
  width: number,
  height: number,
  verticalBarEdge: VerticalBarEdge = 'none',
): void => {
  nativeModule.getSnapshot.mockReturnValue(
    JSON.stringify({
      horizontalSizeClass,
      verticalBarEdge,
      tabBarEdge: 'none',
      foldRegion: null,
    }),
  );
  setDimensions(width, height);
};

export const resizeWindow = async (width: number, height: number): Promise<void> => {
  await act(async () => {
    setDimensions(width, height);
  });
};
