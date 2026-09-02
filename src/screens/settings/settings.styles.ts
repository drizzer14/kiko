import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // The row's header line: the leading icon+label cluster on the left, the
  // trailing chevron (navigating rows only) on the right. Each SettingsRow now
  // sits alone in its own GlassSurface card, which owns the padding, so the row
  // carries no padding or divider of its own.
  header: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // The leading cluster of a row: icon + label, kept together on the left so
  // the header's space-between only splits this cluster from the chevron.
  rowLead: {
    alignItems: 'center',
  },
}));
