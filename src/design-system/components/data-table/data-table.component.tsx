import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  Text as RNText,
  View,
} from 'react-native';
import Animated, {
  useAnimatedRef,
  useAnimatedStyle,
  useScrollOffset,
} from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';
import { type FC, useEffect, useMemo, useRef, useState } from 'react';

import {
  CELL_PADDING_UNITS,
  cellHeightKey,
  fillColumnWidths,
  labelHeightKey,
  resolveColumnWidths,
  resolveFixedWidth,
  resolveInitialOffset,
  resolveRowHeights,
} from './data-table.layout';
import { styles } from './data-table.styles';
import type { DataTableProps, DataTableRow } from './data-table.props';

const STICKY_HEADER_INDICES = [1];

const NO_WIDTHS: Record<string, number> = {};

// Every second body row takes the band, the first stays plain; the total row keeps the plain
// ground that sets it apart.
const isBanded = (row: DataTableRow, rowIndex: number) => rowIndex % 2 === 1 && !row.isSummary;

const HIDDEN_FROM_ACCESSIBILITY = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/**
 * A grid of money amounts: a fixed first column of row labels, a header row that stays visible,
 * and the columns scrolling sideways beside it only when they do not all fit. It takes strings
 * and display flags, and one node of the caller's (`topContent`) to scroll above the caption; the
 * caller formats every amount and owns the vertical room.
 *
 * Every width comes from measured text, never from the window or the device type, so an amount
 * is never cut, shrunk or wrapped, and the table follows Dynamic Type. A row is as tall as the
 * taller of its fixed label and its scrolled cells, set as `minHeight` on both. The header sits
 * inside the vertical scroll after the caption and sticks while the caption scrolls away, so a
 * large type size cannot take the body's room; it follows the body's horizontal offset on the UI
 * thread.
 */
const DataTable: FC<DataTableProps> = ({
  columns,
  rows,
  caption,
  topContent,
  emptyContent,
  initialColumnIndex,
  testID = 'data-table',
}) => {
  const { theme } = useUnistyles();
  const isEmpty = emptyContent !== undefined;
  const [containerWidth, setContainerWidth] = useState(0);
  const [labelWidth, setLabelWidth] = useState(0);
  const [columnTextWidths, setColumnTextWidths] = useState(NO_WIDTHS);
  const [textHeights, setTextHeights] = useState<Record<string, number>>({});
  const scrolledToIndex = useRef<number | undefined>(undefined);
  const bodyRef = useAnimatedRef<ScrollViewInstance>();
  // No body is mounted when empty, and Reanimated warns about a ref that points at nothing.
  const bodyOffset = useScrollOffset(isEmpty ? null : bodyRef);
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -bodyOffset.value }] }));

  const padding = theme.spacing(CELL_PADDING_UNITS * 2);
  const fixedWidth = resolveFixedWidth(labelWidth, containerWidth, padding, theme.layout.hairline);
  const availableWidth = Math.max(containerWidth - fixedWidth, 0);
  const columnWidths = fillColumnWidths(
    resolveColumnWidths(columns, columnTextWidths, padding),
    availableWidth,
  );
  const rowHeights = useMemo(
    () => resolveRowHeights(rows, columns, textHeights, padding),
    [rows, columns, textHeights, padding],
  );
  const contentWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  // One line per column edge but the last, laid over the track: the edge less the hairline, so the
  // line sits inside its own column, not over the next one.
  const separatorOffsets = columnWidths
    .slice(0, -1)
    .map(
      (_, columnIndex) =>
        columnWidths.slice(0, columnIndex + 1).reduce((sum, width) => sum + width, 0) -
        theme.layout.hairline,
    );
  const overflows = containerWidth > 0 && contentWidth > availableWidth;
  const isMeasured =
    containerWidth > 0 &&
    labelWidth > 0 &&
    columns.every((column) => columnTextWidths[column.key] !== undefined);

  useEffect(() => {
    if (isEmpty) {
      // The body is gone, and the next one mounts at the start without a scroll event, so the
      // offset the header follows and the column the body opened at both start over.
      scrolledToIndex.current = undefined;
      bodyOffset.value = 0;
      // The widths held belong to rows the next fill replaces, and the first effect after it must
      // not target a column with them. The measuring views are unmounted while empty, so the fill
      // mounts them anew: a layout event comes for every one, even for a width equal to the old
      // one, where a layout that never changed would send none and leave the table unmeasured.
      setLabelWidth(0);
      setColumnTextWidths(NO_WIDTHS);

      return;
    }

    if (!isMeasured) {
      return;
    }

    const furthestOffset = Math.max(contentWidth - availableWidth, 0);
    const currentOffset = bodyOffset.value;
    const isNewIndex =
      initialColumnIndex !== undefined && scrolledToIndex.current !== initialColumnIndex;
    // A change of index moves to its column even when that is the start; the first mount at the
    // start has nothing to move.
    const isIndexChange = isNewIndex && scrolledToIndex.current !== undefined;
    // The reset is explicit and does not rely on the platform clamping an offset that the content
    // has shrunk away from.
    const targetOffset = isNewIndex
      ? resolveInitialOffset(columnWidths, initialColumnIndex, furthestOffset)
      : Math.min(currentOffset, furthestOffset);

    if (isNewIndex) {
      scrolledToIndex.current = initialColumnIndex;
    }

    if (isIndexChange || targetOffset !== currentOffset) {
      bodyRef.current?.scrollTo({ x: targetOffset, y: 0, animated: false });
    }
  }, [
    initialColumnIndex,
    isEmpty,
    isMeasured,
    columnWidths,
    contentWidth,
    availableWidth,
    bodyRef,
    bodyOffset,
  ]);

  const recordHeight = (key: string) => (event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;

    setTextHeights((current) =>
      current[key] === height ? current : { ...current, [key]: height },
    );
  };

  const recordColumnWidth = (key: string) => (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;

    setColumnTextWidths((current) =>
      current[key] === width ? current : { ...current, [key]: width },
    );
  };

  const captionNode = (
    <RNText style={styles.caption} accessibilityRole="summary" testID={`${testID}-caption`}>
      {caption}
    </RNText>
  );

  // The sticky wrapper takes this child's own style onto itself and gives the child a fill style,
  // which would drop the row's direction; so the child carries no style.
  const headerNode = (
    <View>
      <View style={styles.headerRow} testID={`${testID}-header-row`}>
        <View style={[styles.headerCorner, { width: fixedWidth }]} />

        <View style={styles.headerClip}>
          <Animated.View style={[styles.headerTrack, trackStyle]} testID={`${testID}-header-track`}>
            {columns.map((column, columnIndex) => (
              <View
                key={column.key}
                style={[
                  styles.headerCell,
                  column.isSum && styles.sumColumn,
                  { width: columnWidths[columnIndex] },
                ]}
                testID={`${testID}-header-${column.key}`}
                {...HIDDEN_FROM_ACCESSIBILITY}
              >
                <RNText style={styles.headerText} testID={`${testID}-header-text-${column.key}`}>
                  {column.header}
                </RNText>
              </View>
            ))}

            {separatorOffsets.map((offset, columnIndex) => (
              <View
                key={columns[columnIndex].key}
                style={[styles.columnSeparator, { left: offset }]}
                pointerEvents="none"
                testID={`${testID}-header-separator-${columns[columnIndex].key}`}
              />
            ))}
          </Animated.View>
        </View>
      </View>
    </View>
  );

  const bodyNode = (
    <View style={styles.bodyRow} testID={`${testID}-body-row`}>
      <View style={[styles.fixedColumn, { width: fixedWidth }]} testID={`${testID}-fixed-column`}>
        {rows.map((row, rowIndex) => (
          <View
            key={row.key}
            style={[
              styles.fixedRow,
              isBanded(row, rowIndex) && styles.bandedRow,
              { minHeight: rowHeights[row.key] },
            ]}
            testID={`${testID}-fixed-row-${row.key}`}
          >
            <RNText
              style={[styles.labelText, row.isSummary && styles.summaryText]}
              onLayout={recordHeight(labelHeightKey(row.key))}
              testID={`${testID}-label-${row.key}`}
            >
              {row.label}
            </RNText>
          </View>
        ))}
      </View>

      <Animated.ScrollView
        ref={bodyRef}
        horizontal
        scrollEnabled={overflows}
        showsHorizontalScrollIndicator={false}
        style={styles.bodyScroll}
        contentContainerStyle={styles.bodyScrollContent}
        testID={`${testID}-body-scroll`}
      >
        <View style={styles.bodyContent} testID={`${testID}-body-content`}>
          {rows.map((row, rowIndex) => (
            <View
              key={row.key}
              style={[
                styles.scrolledRow,
                isBanded(row, rowIndex) && styles.bandedRow,
                { minHeight: rowHeights[row.key] },
              ]}
              testID={`${testID}-scrolled-row-${row.key}`}
            >
              {row.cells.map((cell, cellIndex) => {
                const column = columns[cellIndex];

                return (
                  <Pressable
                    key={column.key}
                    accessibilityLabel={cell.accessibilityLabel}
                    accessibilityValue={{ text: cell.accessibilityValue }}
                    accessibilityRole={cell.onPress === undefined ? undefined : 'button'}
                    accessibilityHint={
                      cell.onPress === undefined ? undefined : cell.accessibilityHint
                    }
                    onPress={cell.onPress}
                    style={[
                      styles.cell,
                      column.isSum && styles.sumColumn,
                      { width: columnWidths[cellIndex] },
                    ]}
                    testID={`${testID}-cell-${row.key}-${column.key}`}
                  >
                    <RNText
                      style={[
                        styles.cellText,
                        cell.tone === 'negative' && styles.negativeText,
                        row.isSummary && styles.summaryText,
                      ]}
                      onLayout={recordHeight(cellHeightKey(row.key, column.key))}
                      testID={`${testID}-cell-text-${row.key}-${column.key}`}
                    >
                      {cell.text}
                    </RNText>
                  </Pressable>
                );
              })}
            </View>
          ))}

          {separatorOffsets.map((offset, columnIndex) => (
            <View
              key={columns[columnIndex].key}
              style={[styles.columnSeparator, { left: offset }]}
              pointerEvents="none"
              testID={`${testID}-separator-${columns[columnIndex].key}`}
            />
          ))}
        </View>
      </Animated.ScrollView>
    </View>
  );

  return (
    <View
      style={styles.container}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
      testID={testID}
    >
      <ScrollView
        testID={`${testID}-vertical-scroll`}
        stickyHeaderIndices={isEmpty ? undefined : STICKY_HEADER_INDICES}
        contentContainerStyle={styles.scrollContent}
      >
        {/* One child holds both, so the header stays the scroll's child at the sticky index. It
            stays the first child in the empty state too, so a control in it is never remounted. */}
        <View style={styles.top} testID={`${testID}-top`}>
          {topContent}

          {isEmpty ? null : captionNode}
        </View>

        {isEmpty ? emptyContent : headerNode}

        {isEmpty ? null : bodyNode}
      </ScrollView>

      {isEmpty ? null : (
        <View
          style={styles.measureLayer}
          pointerEvents="none"
          testID={`${testID}-measure-layer`}
          {...HIDDEN_FROM_ACCESSIBILITY}
        >
          <View
            style={styles.measureColumn}
            onLayout={(event) => setLabelWidth(event.nativeEvent.layout.width)}
            testID={`${testID}-measure-labels`}
          >
            {rows.map((row) => (
              <RNText key={row.key} style={[styles.labelText, row.isSummary && styles.summaryText]}>
                {row.label}
              </RNText>
            ))}
          </View>

          {columns.map((column, columnIndex) => (
            <View
              key={column.key}
              style={styles.measureColumn}
              onLayout={recordColumnWidth(column.key)}
              testID={`${testID}-measure-column-${column.key}`}
            >
              <RNText style={styles.headerText}>{column.header}</RNText>

              {rows.map((row) => (
                <RNText
                  key={row.key}
                  style={[styles.cellText, row.isSummary && styles.summaryText]}
                  testID={`${testID}-measure-text-${column.key}-${row.key}`}
                >
                  {row.cells[columnIndex].text}
                </RNText>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

export default DataTable;
