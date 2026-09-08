import { PlatformColor } from 'react-native';

/**
 * Wraps `PlatformColor` for the React Navigation `Theme.colors` slots.
 *
 * React Navigation types every `Theme.colors.*` field as a plain `string`,
 * but at runtime it forwards those values straight to react-native-screens /
 * the native header views, which accept RN's full `ColorValue`
 * (`string | OpaqueColorValue`). `PlatformColor` returns an
 * `OpaqueColorValue`, so the value is a valid native color that React
 * Navigation happily forwards — only its type is too narrow. We cast to the
 * `string` slot that too-narrow type demands. This is safe because the nav
 * theme's color fields are consumed ONLY by `NavigationContainer theme=…`
 * (forwarded to native), never read as a JS string anywhere in the app.
 */
export const platformNavColor = (name: string): string => PlatformColor(name) as unknown as string;
