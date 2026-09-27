import type { FC } from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { styles } from './card.styles';
import type { CardProps } from './card.props';

// The shared CONTENT-layer surface: a solid, opaque themed fill with a
// defined hairline border, no glass/blur material at all. Apple's iOS Human
// Interface Guidelines reserve Liquid Glass for the NAVIGATION layer that
// floats above content (the tab bar, toolbars, bottom sheets) — "don't use
// Liquid Glass in the content layer" — and iOS 27 itself leans on DEFINED
// BORDERS and tuned diffusion for content separation, not glass or heavy
// shadows. `Card` is that content-layer surface: every card, list row, and
// chart container that used to be a neutral (non-tint) `GlassSurface` now
// renders through this one shared component instead, so content reads as a
// consistent, solid, bordered surface regardless of OS version or Liquid
// Glass API drift — see `GlassSurface`'s own doc comment for why the native
// glass material is the wrong lever for content in the first place (no
// intensity/reach knob, samples only its own rect, and iOS 27 ships a
// user-facing transparency slider content has no way to react to).
// `GlassSurface` remains the correct surface for the navigation layer
// (`BottomSheet`'s own glass fill/scrim, the keyboard "Done" accessory pill,
// the Home add-transaction floating action button) — this component does
// NOT replace it there.
//
// The border is UNCONDITIONAL (not an opt-in prop, unlike `GlassSurface`'s
// `bordered`): every content card gets the exact same treatment, so no card
// can visually drift from its neighbors by omitting it. There is no
// `tint`/`transparent`/`translucentStrong`/`material`/`bloom` prop — those
// are glass-material concepts with no meaning on a flat solid fill; a future
// entity-tinted content card reaches for its own explicit `style`
// `backgroundColor` override (or a dedicated variant, added when a real
// consumer needs one) rather than resurrecting glass-specific props here.
const Card: FC<CardProps> = ({ children, style, padding, radius = 'md', testID, ...props }) => {
  const { theme } = useUnistyles();
  const sizing = [
    { borderRadius: theme.radii[radius] },
    padding !== undefined && { padding: theme.spacing(padding) },
  ];

  return (
    <View style={[styles.card, sizing, style]} testID={testID} {...props}>
      {children}
    </View>
  );
};

export default Card;
