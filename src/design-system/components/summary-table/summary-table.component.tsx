import type { FC } from 'react';

import Box from '../box';
import Text from '../text';

import { styles } from './summary-table.styles';
import type { SummaryTableProps } from './summary-table.props';

/**
 * The one shared "label left, value right" summary block: an optional
 * heading row, then a `gap`-spaced stack of rows, each split by
 * `space-between` — the deposit/bond value breakdown's own layout
 * (`HoldingDetailScreen`), extracted here so the statement-import preview
 * and column-mapping result section (device-feedback-round-F1, items 3 and
 * 9) reuse the SAME row layout/alignment/styling without copying the
 * deposit table's own COLUMNS (value/percent/tax) — a caller supplies
 * whatever `rows` make sense for its own domain.
 */
const SummaryTable: FC<SummaryTableProps> = ({ title, rows, testID }) => {
  return (
    <Box gap={1} testID={testID}>
      {title !== undefined && <Text variant="heading">{title}</Text>}

      {rows.map((row) => (
        <Box key={row.key} direction="row" style={styles.row}>
          <Text variant="caption" tone="textSecondary">
            {row.label}
          </Text>
          {/* The testID sits on this wrapping Box, around the VALUE only —
              not the whole row — so a caller migrating an existing testID
              (e.g. `statement-import-transaction-count`) keeps the exact
              same `toHaveTextContent` assertion it had before, scoped to the
              value text alone rather than "label + value" concatenated. */}
          <Box testID={row.testID}>{row.value}</Box>
        </Box>
      ))}
    </Box>
  );
};

export default SummaryTable;
