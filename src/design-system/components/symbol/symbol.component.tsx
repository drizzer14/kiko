import type { FC } from 'react';
import { SFSymbolView } from 'react-native-nitro-sfsymbols';
import { useUnistyles } from 'react-native-unistyles';

import { toSFSymbolTintColor } from './symbol.color';
import type { SymbolProps } from './symbol.props';

// Named SymbolIcon, not Symbol, to avoid shadowing the global `Symbol`
// constructor (lint/suspicious/noShadowRestrictedNames). Callers must import
// the default export under a non-`Symbol` local name for the same reason,
// e.g. `import SymbolIcon from '.../design-system/components/symbol'`.
const SymbolIcon: FC<SymbolProps> = ({
  name,
  size = 20,
  tone = 'textSecondary',
  color,
  accessibilityLabel,
}) => {
  const { theme } = useUnistyles();

  return (
    <SFSymbolView
      name={name}
      size={size}
      // See symbol.color.ts: SFSymbolView's tintColor only accepts hex,
      // while theme.colors.textSecondary is an rgba() string. Passed
      // through unconverted, the native side fails to parse it and falls
      // back to a color that renders as an invisible black glyph on this
      // app's black background — easy to mistake for a layout bug since
      // nothing throws and the view is still there, just uncolored.
      tintColor={toSFSymbolTintColor(color ?? theme.colors[tone])}
      accessibilityLabel={accessibilityLabel}
      // Fabric gives an SFSymbolView no intrinsic size, so with no explicit
      // frame Yoga lays it out at 0x0 and the glyph never paints. `size` is
      // a runtime prop, so this stays a plain inline object rather than a
      // static StyleSheet.create entry (see other primitives' *.styles.ts).
      style={{ width: size, height: size }}
    />
  );
};

export default SymbolIcon;
