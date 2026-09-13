import { type FC, useId } from 'react';
import { View } from 'react-native';
import { Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';

import { entityIconTileGradient, isLightEntityColor } from '../../entity-tint';
import SymbolIcon from '../symbol';

import type { EntityIconTileProps } from './entity-icon-tile.props';
import { iconTileSize, styles } from './entity-icon-tile.styles';

// EXPERIMENT (Item D, design review 2026-09-13, NOT yet shipped): an
// iOS-Settings-style squircle icon tile — a rounded-square gradient fill
// (derived from the entity's OWN color token via `entityIconTileGradient`,
// never an unrelated invented hue) with the SF Symbol glyph on top in a
// legible near-white tint, instead of the flat-tinted bare glyph `SymbolIcon`
// renders on its own. This is the ONE shared place an account/holding card's
// icon is rendered, so both the accounts list card (`accounts.screen.tsx`)
// and the holding card (`holding-card.component.tsx`) pick up the identical
// treatment from a single component rather than each hand-rolling its own
// gradient/squircle markup.
//
// REVIEW / REVERT: this whole look is gated behind the single
// `ENTITY_ICON_SQUIRCLE_GRADIENT_EXPERIMENT` flag below.
//   - `true` (current default): renders the squircle-gradient tile here, and
//     the two call sites (which import this same flag) leave their
//     surrounding card BACKGROUND neutral instead of painting it with
//     `entityCardBackground` — the color now lives on the icon tile only.
//   - `false`: this component renders exactly what both call sites inlined
//     before it existed — a bare `SymbolIcon` tinted with the entity color,
//     no tile, no gradient — and the call sites restore their original
//     `entityCardBackground`-tinted card. Flip this one constant (or read it
//     with a debugger override) to compare both looks live; nothing else in
//     the diff needs to change to revert.
export const ENTITY_ICON_SQUIRCLE_GRADIENT_EXPERIMENT = true;

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

const EntityIconTile: FC<EntityIconTileProps> = ({ name, color, accessibilityLabel, size }) => {
  const { theme } = useUnistyles();
  const gradientId = `${GRADIENT_ID_PREFIX}-${useId().replace(/:/g, '')}`;

  if (!ENTITY_ICON_SQUIRCLE_GRADIENT_EXPERIMENT) {
    return (
      <SymbolIcon name={name} size={size} color={color} accessibilityLabel={accessibilityLabel} />
    );
  }

  const [topStop, bottomStop] = entityIconTileGradient(color);
  const tileSize = iconTileSize(theme);
  // DEVICE BUG (review, 2026-09-13): a fixed white `onAccent` glyph fails
  // WCAG AA contrast on the palette's lighter swatches (`white`, `yellow`,
  // `khaki`, `mint`, `teal` — see `isLightEntityColor`'s own doc comment in
  // `entity-tint.ts`), reading as a near-invisible icon. The glyph tint now
  // adapts to the tile's own resolved hue: `theme.colors.background` (the
  // app's true-black token, already used everywhere else as the dark
  // extreme) on a light tile, the standard white `onAccent` on a dark one —
  // never a raw hex literal for either.
  const glyphTintColor = isLightEntityColor(color)
    ? theme.colors.background
    : theme.colors.onAccent;

  return (
    <View testID="entity-icon-tile" style={styles.tile}>
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
