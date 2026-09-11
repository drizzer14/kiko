import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView } from 'react-native';

import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import OptionPills from '../../../design-system/components/option-pills';
import SelectableRow from '../../../design-system/components/selectable-row';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import {
  DEFAULT_TREND_FILTER,
  type TrendFilter,
  type TrendMeasure,
  type TrendMode,
} from '../../../statistics/trend-filter';
import { FILTER_ALL } from '../../home/filter-menu/filter-menu.component';
import type { FilterOption } from '../../home/filter-menu/filter-menu.props';

import type { TrendFilterFieldProps } from './trend-filter-field.props';
import { styles } from './trend-filter-field.styles';

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

const seedDraft = (filter: TrendFilter): Draft => ({
  mode: filter.mode,
  manualKeys: filter.mode === 'manual' ? new Set(filter.keys) : new Set<string>(),
  amount: filter.mode === 'top' ? filter.amount : DEFAULT_TOP.amount,
  by: filter.mode === 'top' ? filter.by : DEFAULT_TOP.by,
});

const draftToFilter = (draft: Draft): TrendFilter =>
  draft.mode === 'manual'
    ? { mode: 'manual', keys: [...draft.manualKeys] }
    : { mode: 'top', amount: draft.amount, by: draft.by };

// A grouped-list section header: the body type step in the PRIMARY (white)
// tone — the iOS grouped-form header treatment, pulled up from the dim grey
// (`textSecondary`) it used before so it reads as a clear white sub-heading
// above its section's controls rather than a weak, washed-out label. `body`
// (not the former `caption`) keeps the label ABOVE its OptionPills value in
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
// identity color (the OptionPills / ChipRow selection vocabulary).
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

  if (draft.mode === 'manual') {
    return (
      draft.manualKeys.size !== applied.manualKeys.size ||
      [...draft.manualKeys].some((key) => !applied.manualKeys.has(key))
    );
  }

  return draft.amount !== applied.amount || draft.by !== applied.by;
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

  // The applied-filter button label: the manual count (plural/all) or the live
  // "Top N by <measure>" summary.
  const buttonLabel = ((): string => {
    if (filter.mode === 'manual') {
      return filter.keys.length === 0
        ? t('statistics.trendFilter.button.allCategories')
        : t('statistics.trendFilter.button.manual', { count: filter.keys.length });
    }

    return t('statistics.trendFilter.button.top', {
      count: filter.amount,
      measure: measureLabel(filter.by),
    });
  })();

  function measureLabel(measure: TrendMeasure): string {
    return t(`statistics.trendFilter.measure.${measure}`);
  }

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

  return (
    <Box gap={1}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('statistics.trendFilter.title')}
        onPress={openSheet}
        testID={testID}
      >
        <Box direction="row" gap={2} style={styles.field}>
          <SymbolIcon name="line.3.horizontal.decrease.circle" size={18} tone="textPrimary" />

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
            drop to the `caption` step via `OptionPills`' `labelVariant` so
            they stay visually subordinate to their now-larger label. */}
        <Box gap={2} testID={`${testID}-group-selection`}>
          <SectionHeader>{t('statistics.trendFilter.selection')}</SectionHeader>

          <OptionPills
            options={MODES}
            selected={draft.mode}
            onSelect={setMode}
            label={(mode) => t(`statistics.trendFilter.${mode}`)}
            columns={2}
            labelVariant="caption"
          />
        </Box>

        {draft.mode === 'top' ? (
          <>
            <Box gap={2} testID={`${testID}-group-amount`}>
              <SectionHeader>{t('statistics.trendFilter.amount')}</SectionHeader>

              <OptionPills
                options={AMOUNTS}
                selected={draft.amount}
                onSelect={setAmount}
                columns={AMOUNTS.length}
                labelVariant="caption"
              />
            </Box>

            <Box gap={2} testID={`${testID}-group-by`}>
              <SectionHeader>{t('statistics.trendFilter.by')}</SectionHeader>

              <OptionPills
                options={MEASURES}
                selected={draft.by}
                onSelect={setBy}
                label={measureLabel}
                columns={MEASURES.length}
                labelVariant="caption"
              />
            </Box>
          </>
        ) : (
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
                      option.value === FILTER_ALL ? t('common.all') : (option.label ?? option.value)
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
        )}

        <Box direction="row" gap={3} style={styles.actions}>
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
        </Box>
      </BottomSheet>
    </Box>
  );
};

export default TrendFilterField;
