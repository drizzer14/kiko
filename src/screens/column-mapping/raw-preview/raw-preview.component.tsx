import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView } from 'react-native';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import SymbolIcon from '@kiko/design-system/components/symbol';
import { HEADER_SCAN_ROW_COUNT } from '@kiko/statement-import/column-mapping';

import { styles } from './raw-preview.styles';
import { computeColumnWidths } from './column-widths';
import type { RawPreviewProps } from './raw-preview.props';

const PREVIEW_ROW_COUNT = 5;
// The raw preview shows at most this many columns per row — every
// `ColumnSelectField` option list still derives from the FULL header row.
const PREVIEW_COLUMN_COUNT = 5;
// The toggle's caption line plus its own padding sits below the 44pt floor;
// it has no neighbouring target within reach, so vertical hitSlop restores it.
const TOGGLE_HIT_SLOP = { top: 10, bottom: 10 } as const;

/**
 * The column-mapping screen's own raw-table preview: `PREVIEW_ROW_COUNT` rows
 * starting AT the header row (row 0 before one is known), exactly as
 * `readTableRows` parsed them, capped to the first `PREVIEW_COLUMN_COUNT`
 * columns, rendered inside one shared horizontal `ScrollView` so every row's
 * cells stay column-aligned as the user scrolls sideways. "Show all" expands
 * to every row `guessHeaderRowIndex` scans (`HEADER_SCAN_ROW_COUNT`), rows
 * above the header included, so a wrong guess can be corrected; "Show less"
 * collapses back to the header's own window. Tapping a row sets it as the
 * header row — the row whose cells become every `ColumnSelectField`'s own
 * option list below.
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
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [expanded, setExpanded] = useState(false);

  const headerStart = headerRowIndex ?? 0;
  const collapsedEnd = headerStart + PREVIEW_ROW_COUNT;
  // Never shorter than the collapsed window, so expanding from a header near
  // the end of the scanned span hides none of the rows already shown.
  const expandedRows = rows.slice(0, Math.max(HEADER_SCAN_ROW_COUNT, collapsedEnd));
  const collapsedRows = rows.slice(headerStart, collapsedEnd);
  const canExpand = expandedRows.length > collapsedRows.length;
  const firstShownIndex = expanded ? 0 : headerStart;
  const previewRows = (expanded ? expandedRows : collapsedRows).map((row) =>
    row.slice(0, PREVIEW_COLUMN_COUNT),
  );
  const columnWidths = computeColumnWidths(previewRows);

  return (
    <Box gap={2}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID}>
        <Box gap={2}>
          {previewRows.map((row, offset) => {
            const rowIndex = firstShownIndex + offset;
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

      {canExpand && (
        <Pressable
          accessibilityRole="button"
          hitSlop={TOGGLE_HIT_SLOP}
          onPress={() => setExpanded((isExpanded) => !isExpanded)}
          style={styles.toggle}
          testID="raw-preview-toggle"
        >
          <Box direction="row" gap={1} style={styles.toggleContent}>
            <Text variant="caption" tone="accent">
              {expanded ? t('components.pieChart.showLess') : t('components.pieChart.showAll')}
            </Text>

            <SymbolIcon
              testID="raw-preview-toggle-chevron"
              name={expanded ? 'chevron.up' : 'chevron.down'}
              tone="accent"
              size={theme.iconSizes.caption}
            />
          </Box>
        </Pressable>
      )}
    </Box>
  );
};

export default RawPreview;
