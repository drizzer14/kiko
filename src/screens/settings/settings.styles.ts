import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create(() => ({
  // The row's header line: the leading icon+label cluster on the left, the
  // trailing chevron (navigating rows only) on the right. Each SettingsRow now
  // sits alone in its own GlassSurface card, which owns the padding, so the row
  // carries no padding or divider of its own.
  header: {
    justifyContent: 'space-between',
    // Top-align the trailing chevron to the label's FIRST line, not the
    // label's full (possibly multi-line, once wrapped) height.
    alignItems: 'flex-start',
  },
  // The leading cluster of a row: icon + label, kept together on the left so
  // the header's space-between only splits this cluster from the chevron.
  rowLead: {
    alignItems: 'flex-start',
    // RN's `flexShrink` defaults to 0, so without this the cluster never
    // shrinks below its content width when the label is long — it pushes the
    // chevron out past the row instead of wrapping. This lets the cluster
    // take only the width left over after the chevron.
    flexShrink: 1,
  },
  // The label itself, wrapped in its own View so it can carry a layout style
  // the shared `Text` component's own `style` prop deliberately does not
  // expose (see `text.props.d.ts`). Same `flexShrink` reasoning as
  // `rowLead`, one level down: this is what actually lets the label text
  // wrap instead of overflowing past the icon/chevron.
  label: {
    flexShrink: 1,
  },
}));
