import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Row + wrap turns the pill list into a grid. The negative margin cancels
  // each cell's own gutter padding below so the grid's outer edge stays flush
  // while the gaps between cells still read as the theme's spacing(2) gap.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    margin: -theme.spacing(1),
  },
  // Each pill's slot padding. Width is NOT set here — the component computes
  // it from the `columns` prop (`${100 / columns}%`, default 2, matching this
  // grid's original always-2-column behavior) and merges it in per-instance,
  // so a consumer with a different, known option count (e.g. 3) can force a
  // single equal-width row instead of the 2-column wrap.
  cell: {
    padding: theme.spacing(1),
  },
  // A compact segmented pill. Only the shape lives here; the selected/unselected
  // fill is a runtime theme color layered on at the call site (see the
  // component), so the transparent-unselected rationale stays next to its use.
  // This is the DEFAULT (`labelVariant="body"`) sizing — every existing
  // consumer that omits `labelVariant` (CurrencySwitch, LanguageSwitch, the
  // base-currency and lock-grace settings pills) keeps this exact shape.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    // Centered, not leading: the label/icon sit centered in the pill, the iOS
    // segmented-control convention.
    justifyContent: 'center',
    gap: theme.spacing(2),
    // The iOS HIG 44pt minimum touch target (H2 in the HIG audit); the padding
    // below still sets the visual height when the content is shorter.
    minHeight: 44,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // A compact size for `labelVariant="caption"` (the trend-filter sheet's value
  // pills, which sit under their own larger `body` section label): the pill
  // stayed body-sized around a caption label and read oversized. Only the
  // vertical size shrinks — `minHeight`/`paddingVertical` — mirroring Button's
  // `small` size (`SMALL_MIN_HEIGHT` in button.styles.ts, also 34), so the
  // visible pill reads clearly smaller around the smaller text. This visible
  // height is BELOW the 44pt HIG floor on purpose; the component restores the
  // 44pt tap target with `hitSlop` (`COMPACT_HIT_SLOP`,
  // option-pills.component.tsx), the same pattern Button's `small` size uses.
  // Merged onto `pill` (never replaces it), so `paddingHorizontal`/
  // `borderRadius`/etc. stay shared with the default size.
  pillCompact: {
    minHeight: 34,
    paddingVertical: theme.spacing(1),
  },
}));
