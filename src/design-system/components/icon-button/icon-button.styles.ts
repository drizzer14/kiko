import { StyleSheet } from 'react-native-unistyles';

import { DISABLED_OPACITY } from '../../disabled-opacity';

export const styles = StyleSheet.create((theme) => ({
  // A small square hit target that hugs the glyph, centred both ways.
  button: {
    padding: theme.spacing(1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Applied on top of `button` when `disabled` — `Pressable`'s own `disabled`
  // prop makes it non-interactive, this makes that state visible. Dims to the
  // shared token so it matches the Button's disabled treatment exactly.
  disabled: {
    opacity: DISABLED_OPACITY,
  },
}));
