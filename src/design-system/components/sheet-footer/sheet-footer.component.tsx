import type { FC } from 'react';

import Box from '../box';

import type { SheetFooterProps } from './sheet-footer.props';
import { styles } from './sheet-footer.styles';

/**
 * The one shared CHOICE-sheet footer: a horizontal action row pinned to the
 * body end, replacing the three previously-inconsistent per-screen footer
 * patterns (trend-filter-field's and date-range-field's own duplicated
 * `actions` style, and the icon picker's outlier top-right title-row actions).
 * A pure layout container — it renders its `children` (Buttons) in trailing-
 * aligned row order and owns none of their variants/labels, so a call site
 * stays free to choose its own button set while sharing one layout. `gap={3}`
 * matches the two existing choice sheets' own former row gap.
 *
 * This is NOT for a multi-option / destructive-adjacent CONFIRM sheet (e.g.
 * the transaction form's category-override confirm) — those keep their
 * vertical, full-width stacked Buttons, the standard iOS pattern for that
 * class of sheet, and never route through this component.
 */
const SheetFooter: FC<SheetFooterProps> = ({ children, testID }) => (
  <Box direction="row" gap={3} style={styles.footer} testID={testID}>
    {children}
  </Box>
);

export default SheetFooter;
