import type { FC } from 'react';

import Box from '../box';

import { styles } from './sheet-footer.styles';
import type { SheetFooterProps } from './sheet-footer.props';

/**
 * The one shared CHOICE-sheet footer: a horizontal action row pinned to the
 * body end, so no choice sheet carries its own duplicated `actions` style or
 * an outlier top-right title-row action pattern.
 * A pure layout container — it renders its `children` (Buttons) in trailing-
 * aligned row order and owns none of their variants/labels, so a call site
 * stays free to choose its own button set while sharing one layout. `gap={3}`
 * is the row gap every choice sheet shares.
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
