import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The key-warning line's own bottom gutter before the Encryption-Key field,
  // matching the screen's normal 12pt rhythm. Wrapped in its own View because
  // `Text`'s `style` prop deliberately excludes layout properties like
  // `marginBottom` (see `text.props.d.ts`) — the same reason `SettingsRow`'s
  // own label sits in its own View.
  keyWarning: {
    marginBottom: theme.spacing(3),
  },
  // The Encryption-Key field's own bottom gutter before the Copy/Share
  // buttons, matching `keyWarning`'s own 12pt rhythm above the field:
  // `TextField` renders nothing below the input when there is no `error`
  // (`text-field.component.tsx`), so this screen must supply its OWN spacing,
  // the same way every other gap on this screen does. This field passes no
  // `error` (it is a read-only display of an already-generated key), so this
  // margin is exactly the field's only trailing space, never doubled up with
  // a `FieldError` reflow.
  keyField: {
    marginBottom: theme.spacing(3),
  },
}));
