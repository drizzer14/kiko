import type { FC } from 'react';
import { Pressable, ScrollView } from 'react-native';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';

import { styles } from './raw-preview.styles';
import { computeColumnWidths } from './column-widths';
import type { RawPreviewProps } from './raw-preview.props';

const PREVIEW_ROW_COUNT = 10;

/**
 * The column-mapping screen's own raw-table preview: the first
 * `PREVIEW_ROW_COUNT` rows exactly as `readTableRows` parsed them, rendered
 * inside one shared horizontal `ScrollView` so every row's cells stay
 * column-aligned as the user scrolls sideways. Tapping a row sets it as the
 * header row — the row whose cells become every `ColumnSelectField`'s own
 * option list below. Each column takes a CONSISTENT width across every row
 * (device-feedback-round-F1 item 6, `computeColumnWidths`) rather than a flat
 * per-cell minimum, so the grid reads as a real aligned table. The selected
 * header row paints the theme's accent BLUE (item 12, the same fill
 * `SummaryTable`'s sibling controls use for a selected state) with
 * `onAccent` cell text, replacing the former neutral `surfaceHigh` tint.
 */
const RawPreview: FC<RawPreviewProps> = ({ rows, headerRowIndex, onSelectHeaderRow, testID }) => {
  const previewRows = rows.slice(0, PREVIEW_ROW_COUNT);
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
