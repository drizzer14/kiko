import { match } from 'ts-pattern';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView } from 'react-native';

import {
  DEFAULT_TREND_FILTER,
  type TrendFilter,
  type TrendMeasure,
  type TrendMode,
} from '../../../statistics/trend-filter';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import ChipRow from '../../../design-system/components/chip-row';
import SymbolIcon from '../../../design-system/components/symbol';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import SheetFooter from '../../../design-system/components/sheet-footer';
import { FILTER_ALL } from '../../home/filter-menu/filter-menu.component';
import SelectableRow from '../../../design-system/components/selectable-row';
import type { FilterOption } from '../../home/filter-menu/filter-menu.props';
import SegmentedControl from '../../../design-system/components/segmented-control';

import { styles } from './trend-filter-field.styles';
import type { TrendFilterFieldProps } from './trend-filter-field.props';

const MODES: readonly TrendMode[] = ['top', 'manual'];
const AMOUNTS: readonly number[] = [1, 2, 3, 4, 5];
const MEASURES: readonly TrendMeasure[] = ['contribution', 'frequency', 'rising'];

// The saved default is always a "top" filter, so its amount/by seed the top
// controls when the sheet opens on a manual-mode filter.
const DEFAULT_TOP = DEFAULT_TREND_FILTER as Extract<TrendFilter, { mode: 'top' }>;

// The draft the sheet edits: mode, the manual selection (empty = all), and the
// top amount/measure — all four held at once so switching mode preserves the
// other mode's choices until Save.
type Draft = { mode: TrendMode; manualKeys: Set<string>; amount: number; by: TrendMeasure };

const seedDraft = (filter: TrendFilter): Draft => {
  const derived: { manualKeys: Set<string>; amount: number; by: TrendMeasure } = match(filter)
    .with({ mode: 'manual' }, (manualFilter) => ({
      manualKeys: new Set(manualFilter.keys),
      amount: DEFAULT_TOP.amount,
      by: DEFAULT_TOP.by,
    }))
    .with({ mode: 'top' }, (topFilter) => ({
      manualKeys: new Set<string>(),
      amount: topFilter.amount,
      by: topFilter.by,
    }))
    .exhaustive();

  return { mode: filter.mode, ...derived };
};

const draftToFilter = (draft: Draft): TrendFilter =>
  match(draft)
    .with(
      { mode: 'manual' },
      (manualDraft): TrendFilter => ({ mode: 'manual', keys: [...manualDraft.manualKeys] }),
    )
    .with(
      { mode: 'top' },
      (topDraft): TrendFilter => ({ mode: 'top', amount: topDraft.amount, by: topDraft.by }),
    )
    .exhaustive();

// A grouped-list section header: the body type step in the PRIMARY (white)
// tone — the iOS grouped-form header treatment, pulled up from the dim grey
// (`textSecondary`) it used before so it reads as a clear white sub-heading
// above its section's controls rather than a weak, washed-out label. `body`
// (not the former `caption`) keeps the label ABOVE its ChipRow value in
// the type scale — the value pills below now render at `caption` via
// `labelVariant`, so the hierarchy reads `heading` (sheet title) > `body`
// (this label) > `caption` (the value) rather than the inverted
// label-smaller-than-value it used to be. Title case, per the design
// system's heading rule.
const SectionHeader: FC<{ children: string }> = ({ children }) => (
  <Box style={styles.label}>
    <Text variant="body" tone="textPrimary">
      {children}
    </Text>
  </Box>
);

// One manual-mode category row (or the leading "All" row). It delegates to the
// shared `SelectableRow` — the single source of truth for a category-picker row
// across the app — so the selected row paints the filled accent surface with an
// `onAccent` checkmark/icon/label and an unselected row keeps the category's own
// identity color (ChipRow's selection vocabulary).
const ManualCategoryRow: FC<{
  option: FilterOption;
  checked: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}> = ({ option, checked, label, onPress, testID }) => {
  return (
    <SelectableRow
      accessibilityRole="checkbox"
      selected={checked}
      onPress={onPress}
      label={label}
      icon={option.icon}
      iconColor={option.color}
      testID={testID}
    />
  );
};

// Whether the sheet's draft differs from the applied filter. Save is disabled
// until it does, so a no-op Save (nothing new selected) is impossible.
const isDraftDirty = (draft: Draft, filter: TrendFilter): boolean => {
  const applied = seedDraft(filter);

  if (draft.mode !== applied.mode) {
    return true;
  }

  return match(draft)
    .with(
      { mode: 'manual' },
      (manualDraft) =>
        manualDraft.manualKeys.size !== applied.manualKeys.size ||
        [...manualDraft.manualKeys].some((key) => !applied.manualKeys.has(key)),
    )
    .with(
      { mode: 'top' },
      (topDraft) => topDraft.amount !== applied.amount || topDraft.by !== applied.by,
    )
    .exhaustive();
};

// Toggle one category key in an immutable copy of the selection.
const toggleKey = (keys: Set<string>, key: string): Set<string> => {
  const next = new Set(keys);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }

  return next;
};

/**
 * The Statistics trend chart's filter control: a single button whose label
 * reflects the APPLIED filter, opening a bottom sheet to edit it. Manual mode
 * pins explicit categories (empty = all); Top mode stores an amount + measure
 * re-ranked live. Save applies AND persists then closes; Clear reverts the
 * sheet to the saved filter without closing; a dismiss discards unsaved edits.
 */
const TrendFilterField: FC<TrendFilterFieldProps> = ({
  filter,
  categoryOptions,
  onSave,
  testID,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => seedDraft(filter));

  function measureLabel(measure: TrendMeasure): string {
    return t(`statistics.trendFilter.measure.${measure}`);
  }

  // The applied-filter button label: the manual count (plural/all) or the live
  // "Top N by <measure>" summary.
  const buttonLabel = match(filter)
    .with({ mode: 'manual' }, (manualFilter) =>
      manualFilter.keys.length === 0
        ? t('statistics.trendFilter.button.allCategories')
        : t('statistics.trendFilter.button.manual', { count: manualFilter.keys.length }),
    )
    .with({ mode: 'top' }, (topFilter) =>
      t('statistics.trendFilter.button.top', {
        count: topFilter.amount,
        measure: measureLabel(topFilter.by),
      }),
    )
    .exhaustive();

  const openSheet = (): void => {
    setDraft(seedDraft(filter));
    setOpen(true);
  };

  const handleSave = (): void => {
    onSave(draftToFilter(draft));
    setOpen(false);
  };

  // Clear reverts the draft to the currently SAVED filter (which the screen has
  // already resolved to the default when nothing is saved). It does NOT close.
  const handleClear = (): void => {
    setDraft(seedDraft(filter));
  };

  const setMode = (mode: TrendMode): void => setDraft((previous) => ({ ...previous, mode }));
  const setAmount = (amount: number): void => setDraft((previous) => ({ ...previous, amount }));
  const setBy = (by: TrendMeasure): void => setDraft((previous) => ({ ...previous, by }));
  const clearManual = (): void =>
    setDraft((previous) => ({ ...previous, manualKeys: new Set<string>() }));
  const toggleManual = (key: string): void =>
    setDraft((previous) => ({ ...previous, manualKeys: toggleKey(previous.manualKeys, key) }));

  const isChecked = (key: string): boolean =>
    key === FILTER_ALL ? draft.manualKeys.size === 0 : draft.manualKeys.has(key);
  const manualRows: FilterOption[] = [{ value: FILTER_ALL }, ...categoryOptions];
  // Save stays disabled until the draft differs from the applied filter, so
  // pressing it can never re-persist the already-applied selection unchanged.
  const dirty = isDraftDirty(draft, filter);
  // ChipRow takes a `labels` record, not a function — `measureLabel` stays a
  // function for the button-label
  // interpolation above, and this is its one-time resolution into a record
  // for the By pills below.
  const measureLabels: Record<TrendMeasure, string> = {
    contribution: measureLabel('contribution'),
    frequency: measureLabel('frequency'),
    rising: measureLabel('rising'),
  };

  return (
    <Box gap={1}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('statistics.trendFilter.title')}
        onPress={openSheet}
        testID={testID}
      >
        <Box direction="row" gap={2} style={styles.field}>
          {/* The trigger glyph reflects the APPLIED filter mode (the same
              `filter.mode` `buttonLabel` reads): the categories `tag` in
              Manual mode, the ranking `chart.bar.fill` in Top mode. */}
          <SymbolIcon
            name={match(filter)
              .with({ mode: 'manual' }, () => 'tag' as const)
              .with({ mode: 'top' }, () => 'chart.bar.fill' as const)
              .exhaustive()}
            size={18}
            tone="textPrimary"
          />

          <Text variant="body" tone="textPrimary">
            {buttonLabel}
          </Text>
        </Box>
      </Pressable>

      {/* `scrollable={false}`: the sheet title, the section controls, and the
          Clear/Save action row all stay FIXED. Only the manual-category list
          (below) owns a ScrollView, so a long category list scrolls while the
          header and the actions never leave the screen — the whole modal never
          scrolls as one block (on-device review: the flat, all-scrolling sheet
          read as almost unreadable). */}
      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={4}
        scrollable={false}
        header={<Text variant="heading">{t('statistics.trendFilter.title')}</Text>}
        testID={`${testID}-sheet`}
        backdropTestID={`${testID}-backdrop`}
      >
        {/* Each section is a white `body`-step sub-heading directly ABOVE its
            value control — no frosted `GlassSurface` card behind the values
            any more (design review: the gray-filled card read as a
            competing surface under a sheet that is already glass). The
            values sit straight on the sheet, the iOS grouped-form look, and
            drop to the `caption` step via `ChipRow`'s `labelVariant` so
            they stay visually subordinate to their now-larger label. */}
        <Box gap={2} testID={`${testID}-group-selection`}>
          <SectionHeader>{t('statistics.trendFilter.selection')}</SectionHeader>

          {/* Top/Manual swaps which section renders below — the amount/
              measure controls or the category list — so this is a mode
              toggle, not a same-form value pick: a SegmentedControl (no
              leading-icon slot — no SegmentedControl consumer in the app
              carries one), not a ChipRow. `labelVariant="caption"` keeps the
              mode labels visually SUBORDINATE to their own larger
              `SectionHeader` above ("Selection", `body`) — the same
              label-above-value hierarchy `ChipRow`'s `labelVariant` follows
              elsewhere in this same sheet (the Amount/By value pills below),
              rather than the mode toggle reading as a competing PEER of its
              own section header. */}
          <SegmentedControl<TrendMode>
            options={MODES}
            selected={draft.mode}
            onSelect={setMode}
            labels={{
              top: t('statistics.trendFilter.top'),
              manual: t('statistics.trendFilter.manual'),
            }}
            labelVariant="caption"
            accessibilityLabel={t('statistics.trendFilter.selection')}
            testID={`${testID}-mode-control`}
          />
        </Box>

        {match(draft.mode)
          .with('top', () => (
            <>
              <Box gap={2} testID={`${testID}-group-amount`}>
                <SectionHeader>{t('statistics.trendFilter.amount')}</SectionHeader>

                <ChipRow<number>
                  options={AMOUNTS}
                  selected={draft.amount}
                  onSelect={setAmount}
                  labelVariant="caption"
                />
              </Box>

              <Box gap={2} testID={`${testID}-group-by`}>
                <SectionHeader>{t('statistics.trendFilter.by')}</SectionHeader>

                <ChipRow<TrendMeasure>
                  options={MEASURES}
                  selected={draft.by}
                  onSelect={setBy}
                  labels={measureLabels}
                  labelVariant="caption"
                />
              </Box>
            </>
          ))
          .with('manual', () => (
            <Box gap={2} style={styles.manualSection}>
              <SectionHeader>{t('statistics.trendFilter.categories')}</SectionHeader>

              {/* The list card carries NO `padding`: each `ManualCategoryRow`
                  already self-insets, so an edge-to-edge scroll region inside the
                  card is the iOS grouped-list row treatment (and avoids doubling
                  the row's own inset). It shares the manual section's shrink so
                  only the list scrolls under the sheet's height cap. This is a
                  plain `Box`, not `GlassSurface` — no frosted gray fill behind
                  the rows and no hairline border any more — it keeps only the one
                  thing `GlassSurface` was still relied on for: the
                  `overflow: hidden` corner clip on the scroll region
                  (`styles.manualGroup`), so the list sits transparent on the
                  sheet with just its rounded-corner clip. */}
              <Box style={styles.manualGroup} testID={`${testID}-group-categories`}>
                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={styles.scrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {manualRows.map((option) => (
                    <ManualCategoryRow
                      key={option.value}
                      option={option}
                      checked={isChecked(option.value)}
                      label={
                        option.value === FILTER_ALL
                          ? t('common.all')
                          : (option.label ?? option.value)
                      }
                      onPress={() =>
                        option.value === FILTER_ALL ? clearManual() : toggleManual(option.value)
                      }
                      testID={`${testID}-option-${option.value}`}
                    />
                  ))}
                </ScrollView>
              </Box>
            </Box>
          ))
          .exhaustive()}

        <SheetFooter>
          {/* Both actions are disabled while the draft equals the applied
              filter: Clear would revert to what is already applied, and Save
              would re-persist it unchanged — neither does anything, so neither is
              offered until the draft is dirty. */}
          <Button
            variant="secondary"
            fullWidth={false}
            disabled={!dirty}
            onPress={handleClear}
            testID={`${testID}-clear`}
          >
            {t('common.clear')}
          </Button>

          <Button
            fullWidth={false}
            disabled={!dirty}
            onPress={handleSave}
            testID={`${testID}-save`}
          >
            {t('common.save')}
          </Button>
        </SheetFooter>
      </BottomSheet>
    </Box>
  );
};

export default TrendFilterField;
