// Semgrep fixture (NEGATIVE): kiko-no-device-idiom must report nothing here. The layout reads the
// size class and the window width, and the platform's other facts stay readable.
import { Platform, useWindowDimensions } from 'react-native';

export const isIos = Platform.OS === 'ios';

export const reactNativeVersion = Platform.constants.reactNativeVersion;

const { OS } = Platform;

export const useIsWide = (): boolean => {
  const { width } = useWindowDimensions();

  return OS === 'ios' && width >= 721;
};
