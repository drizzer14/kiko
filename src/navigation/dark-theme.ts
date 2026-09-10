import { DarkTheme } from '@react-navigation/native';

/**
 * React Navigation theme for the app's dark-only chrome, so the true-black
 * background shows behind every screen and the navigation chrome (headers,
 * cards, borders, accent) matches the Apple iOS dark palette.
 *
 * The colors are concrete dark hex matching the design-system dark tokens
 * (`src/design-system/theme.ts`): the app pins `UIUserInterfaceStyle = Dark`
 * in Info.plist, so native chrome never needs to repaint for a scheme flip and
 * a concrete hex is sufficient. `notification` is inherited from
 * `@react-navigation/native`'s `DarkTheme`.
 */
export const navigationDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#000000', // systemGroupedBackground (dark)
    card: '#000000',
    text: '#FFFFFF', // label (dark)
    border: '#38383A', // opaqueSeparator (dark)
    primary: '#0A84FF', // systemBlue (dark)
  },
};
