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
  size,
  tone = 'textSecondary',
  color,
  accessibilityLabel,
}) => {
  const { theme } = useUnistyles();
  // The default is the `body` icon-size token (see theme.ts), not a literal:
  // an icon with no explicit size reads as a body-context glyph. A call site
  // still passes `theme.iconSizes.caption` / `.heading` / etc. for another
  // type context.
  const resolvedSize = size ?? theme.iconSizes.body;

  return (
    <SFSymbolView
      name={name}
      size={resolvedSize}
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
      style={{ width: resolvedSize, height: resolvedSize }}
    />
  );
};

export default SymbolIcon;
