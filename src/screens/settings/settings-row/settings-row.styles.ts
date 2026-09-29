import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // The row's header line: the leading icon+label cluster on the left, the
  // trailing chevron (navigating rows only) on the right. Each SettingsRow now
  // sits alone in its own GlassSurface card, which owns the padding, so the row
  // carries no padding or divider of its own.
  header: {
    justifyContent: 'space-between',
    // Keep the trailing chevron on the label's FIRST line, not centered on the
    // label's full (possibly multi-line, once wrapped) height. The chevron's
    // OWN box (`chevron` below) then centers the glyph vertically within that
    // first line, so `flex-start` here does not make it ride high.
    alignItems: 'flex-start',
  },
  // A tappable row with a body below its label: the switch and chevron center
  // on the label and body together, not on the label's first line.
  centeredEnd: {
    alignItems: 'center',
  },
  // The label and the body below it, taking the width the switch and chevron
  // leave so the body wraps beside them.
  body: {
    flex: 1,
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
  // An inline `trailing` control (e.g. a Switch), pinned to the row's
  // trailing edge on the same line as the label — a small leading gap keeps
  // it from crowding a long label that wraps up against it.
  trailing: {
    marginLeft: theme.spacing(3),
  },
  // The trailing chevron's own box. The glyph is sized to the title's fontSize
  // (`settings-row.chevron.ts`), so it is SHORTER than the leading icon and the
  // title's line box. Without a box of its own it would top-align (header
  // `flex-start`) and sit ABOVE the title's optical center. Giving the box the
  // row's first-line height (the leading icon's size, `iconSizes.body`) and
  // centering the glyph lands it on the title's center; the fixed height keeps
  // it on the FIRST line when the label wraps.
  chevron: {
    height: theme.iconSizes.body,
    justifyContent: 'center',
  },
}));
