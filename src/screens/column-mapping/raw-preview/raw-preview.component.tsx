import type { FC } from 'react';
import { Pressable, ScrollView } from 'react-native';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';

import { styles } from './raw-preview.styles';
import { computeColumnWidths } from './column-widths';
import type { RawPreviewProps } from './raw-preview.props';

// The raw preview shows at least this many rows. A selected header row past
// them extends the preview to that row (a bank export's preamble lines can sit
// above its header), so the chosen header is never hidden or untappable.
const PREVIEW_ROW_COUNT = 5;
// The raw preview shows at most this many columns per row — every
// `ColumnSelectField` option list still derives from the FULL header row.
const PREVIEW_COLUMN_COUNT = 5;

/**
 * The column-mapping screen's own raw-table preview: the first
 * `PREVIEW_ROW_COUNT` rows (or up to the selected header row, if later)
 * exactly as `readTableRows` parsed them, capped to
 * the first `PREVIEW_COLUMN_COUNT` columns, rendered inside one
 * shared horizontal `ScrollView` so every row's cells stay column-aligned as
 * the user scrolls sideways. Tapping a row sets it as the header row — the
 * row whose cells become every `ColumnSelectField`'s own option list below.
 * Each column takes a CONSISTENT width across every row (`computeColumnWidths`)
 * rather than a flat per-cell minimum, so the grid reads as a real aligned
 * table. The selected header row paints the theme's accent BLUE (the same
 * fill `SummaryTable`'s sibling controls use for a selected state) with
 * `onAccent` cell text, replacing the former neutral `surfaceHigh` tint, and
 * its cell text turns SEMIBOLD (`'600'` — the app's selected-label weight
 * elsewhere, not `'700'`) so the chosen header row reads as clearly distinct
 * from every other previewed row, not just differently colored.
 */
const RawPreview: FC<RawPreviewProps> = ({ rows, headerRowIndex, onSelectHeaderRow, testID }) => {
  const previewRowCount = Math.max(PREVIEW_ROW_COUNT, (headerRowIndex ?? 0) + 1);
  const previewRows = rows
    .slice(0, previewRowCount)
    .map((row) => row.slice(0, PREVIEW_COLUMN_COUNT));
  const columnWidths = computeColumnWidths(previewRows);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID}>
      <Box gap={2}>
        {previewRows.map((row, rowIndex) => {
          // A raw table row's own on-file POSITION is its identity here (the
          // row above IS the header row, regardless of two rows sharing
          // identical content — a real export can repeat an identical
          // section-marker or header line, as Sensebank's own fixture does),
          // so the index is a legitimate, necessary part of this key.
          const rowKey = `${rowIndex}␟${row.map(String).join('␟')}`;
          const isSelected = rowIndex === headerRowIndex;

          return (
            <Pressable
              key={rowKey}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelectHeaderRow(rowIndex)}
              testID={`raw-preview-row-${rowIndex}`}
            >
              <Box
                direction="row"
                style={[styles.row, isSelected && styles.selectedRow]}
                testID={`raw-preview-row-${rowIndex}-fill`}
              >
                {row.map((cell, cellIndex) => {
                  // A raw table row's cells are a fixed-width, never-reordered
                  // structure — the cell's own position IS its column
                  // identity, and two cells in the same row can share an
                  // identical (or empty) value, so the index is the only
                  // stable part of this key.
                  const cellKey = `${cellIndex}␟${String(cell)}`;

                  return (
                    <Box key={cellKey} style={[styles.cell, { width: columnWidths[cellIndex] }]}>
                      <Text
                        variant="caption"
                        tone={isSelected ? 'onAccent' : 'textPrimary'}
                        numberOfLines={1}
                        style={isSelected ? styles.selectedCellText : undefined}
                      >
                        {String(cell)}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
            </Pressable>
          );
        })}
      </Box>
    </ScrollView>
  );
};

export default RawPreview;
