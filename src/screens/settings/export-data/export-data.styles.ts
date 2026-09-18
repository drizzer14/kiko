import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The key-warning line's own bottom gutter before the Encryption-Key field,
  // matching the screen's normal 12pt rhythm. Wrapped in its own View because
  // `Text`'s `style` prop deliberately excludes layout properties like
  // `marginBottom` (see `text.props.d.ts`) — the same reason `SettingsRow`'s
  // own label sits in its own View.
  //
  // Deliberately no margin/gap is added AFTER the TextField itself here:
  // `TextField` always reserves its own `errorSlot` (20pt, `text-field.styles.ts`)
  // below the input, whether or not an error is showing. Stacking this
  // screen's own gap on top of that reserved slot is exactly the "strange big
  // bottom margin" device-feedback-round-3 item 4 flagged — the Copy/Share
  // buttons read as detached from the key field above them. This card's own
  // `Box` therefore carries NO uniform `gap` — every child's spacing is
  // stated explicitly here instead, so the field's already-reserved slot is
  // the field's own trailing space, not doubled up with a second one.
  keyWarning: {
    marginBottom: theme.spacing(3),
  },
}));
