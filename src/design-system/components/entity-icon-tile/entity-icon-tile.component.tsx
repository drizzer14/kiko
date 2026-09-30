import { View } from 'react-native';
import { type FC, useId } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';
import { entityIconTileGradient, isLightEntityColor } from '@kiko/design-system/entity-tint';

import SymbolIcon from '../symbol';

import { iconTileSize, styles } from './entity-icon-tile.styles';
import type { EntityIconTileProps } from './entity-icon-tile.props';

// An iOS-Settings-style squircle icon tile — a rounded-square gradient fill
// (derived from the entity's OWN color token via `entityIconTileGradient`,
// never an unrelated invented hue) with the SF Symbol glyph on top in a
// legible near-white tint, instead of the flat-tinted bare glyph `SymbolIcon`
// renders on its own. This is the ONE shared place an account/holding card's
// icon is rendered, so both the accounts list card (`accounts.screen.tsx`)
// and the holding card (`holding-card.component.tsx`) pick up the identical
// treatment from a single component rather than each hand-rolling its own
// gradient/squircle markup. With the color living on the icon tile, both call
// sites keep their surrounding card BACKGROUND neutral (a plain `transparent`
// frosted surface) rather than painting it with an entity-color wash.
//
// DEVICE BUG: the tile is a plain squircle of the gradient fill and the glyph,
// with nothing drawn around the edge. A two-ring hairline edge (a white outer
// ring plus a darker inset ring) meant to imitate a native app-icon edge
// separator does not read as intended on device, and a white specular "glass"
// sheen over the top reads as a cheap gloss, so the tile draws neither.

// Every tile mounts its own separate `Svg` document, so a gradient id only
// needs to be unique WITHIN that document (the same scoping
// `net-worth-line.component.tsx`'s own fixed gradient ids rely on) — but the
// accounts grid mounts many tiles at once, each with different gradient
// stops, all sharing this one static id. `useId()` (below, the same pattern
// `useKeyboardDoneAccessory` already uses for its own per-instance
// `nativeID`) gives each mounted tile its own id instead, so many
// simultaneous tiles can never collide even if a future `Svg`/`Defs` scoping
// assumption changes. Colons stripped: react-native-svg's `id`
// attribute/`url(#...)` reference is safest as a plain alphanumeric token
// rather than React's own `:r0:`-shaped id.
const GRADIENT_ID_PREFIX = 'entity-icon-tile-gradient';

const EntityIconTile: FC<EntityIconTileProps> = ({
  name,
  color,
  accessibilityLabel,
  size,
  compact = false,
}) => {
  const { theme } = useUnistyles();
  const gradientId = `${GRADIENT_ID_PREFIX}-${useId().replace(/:/g, '')}`;

  const [topStop, bottomStop] = entityIconTileGradient(color);
  const tileSize = iconTileSize(theme, compact);
  // DEVICE BUG: a fixed white `onAccent` glyph fails
  // WCAG AA contrast on the palette's lighter swatches (`white`, `yellow`,
  // `khaki`, `mint`, `teal` — see `isLightEntityColor`'s own doc comment in
  // `entity-tint.ts`), reading as a near-invisible icon, so the glyph tint
  // adapts to the tile's own resolved hue: `theme.colors.background` (the
  // app's true-black token, already used everywhere else as the dark
  // extreme) on a light tile, the standard white `onAccent` on a dark one —
  // never a raw hex literal for either.
  const glyphTintColor = isLightEntityColor(color)
    ? theme.colors.background
    : theme.colors.onAccent;

  return (
    <View testID="entity-icon-tile" style={[styles.tile, compact && styles.compactTile]}>
      <Svg
        testID="entity-icon-tile-gradient-svg"
        width={tileSize}
        height={tileSize}
        style={styles.gradientFill}
      >
        <Defs>
          <LinearGradient
            testID="entity-icon-tile-linear-gradient"
            id={gradientId}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <Stop testID="entity-icon-tile-gradient-stop-top" offset="0" stopColor={topStop} />
            <Stop
              testID="entity-icon-tile-gradient-stop-bottom"
              offset="1"
              stopColor={bottomStop}
            />
          </LinearGradient>
        </Defs>

        <Rect
          testID="entity-icon-tile-gradient-rect"
          x="0"
          y="0"
          width={tileSize}
          height={tileSize}
          rx={theme.radii.md}
          ry={theme.radii.md}
          fill={`url(#${gradientId})`}
        />
      </Svg>

      <SymbolIcon
        name={name}
        size={size}
        color={glyphTintColor}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
};

export default EntityIconTile;
