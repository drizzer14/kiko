import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { FlatList, Keyboard } from 'react-native';
import { type FC, useEffect, useState } from 'react';
import type { CurrencyGroup } from '@kiko/currency/currency-group';
import { type Currency, currencySymbol } from '@kiko/currency/currency';

import Box from '../box';
import Text from '../text';
import TextField from '../text-field';
import BottomSheet from '../bottom-sheet';
import FieldTrigger from '../field-trigger';
import SelectableRow from '../selectable-row';

import { styles } from './currency-field.styles';
import type { CurrencyFieldProps } from './currency-field.props';

// The localized display name for a currency code, looked up from the i18n
// catalogues (`currencyNames.<CODE>`) rather than a static map, so the label
// and search follow the active language.
const currencyName = (t: TFunction, code: Currency): string => t(`currencyNames.${code}`);

// A currency matches a search query when the query is a substring of either
// its code (e.g. "chf") or its localized name (e.g. "pound" / "фунт"), matched
// case-insensitively. An empty (or whitespace-only) query matches everything.
const matches = (t: TFunction, code: Currency, query: string): boolean => {
  const trimmed = query.trim().toLowerCase();

  if (trimmed === '') {
    return true;
  }

  return (
    code.toLowerCase().includes(trimmed) || currencyName(t, code).toLowerCase().includes(trimmed)
  );
};

type PickerRow =
  | { type: 'heading'; kind: CurrencyGroup['kind'] }
  | { type: 'currency'; code: Currency };

const rowKey = (row: PickerRow): string =>
  match(row)
    .with({ type: 'heading' }, ({ kind }) => `heading-${kind}`)
    .with({ type: 'currency' }, ({ code }) => code)
    .exhaustive();

// The rows to render: each group's currencies that match the search, in the order the group
// gives them (the caller's group builder owns ordering, so a search only filters). A group the
// search empties is dropped, and a heading row leads a group only while more than one group is
// left, because a lone group needs no label.
const visibleRows = (
  groups: readonly CurrencyGroup[],
  t: TFunction,
  query: string,
): PickerRow[] => {
  const shown = groups
    .map(({ kind, currencies }) => ({
      kind,
      currencies: currencies.filter((code) => matches(t, code, query)),
    }))
    .filter(({ currencies }) => currencies.length > 0);

  return shown.flatMap(({ kind, currencies }): PickerRow[] => [
    ...(shown.length > 1 ? [{ type: 'heading' as const, kind }] : []),
    ...currencies.map((code) => ({ type: 'currency' as const, code })),
  ]);
};

// A labeled, searchable single-select currency picker: the field shows the
// current selection (its text currency mark — `currencySymbol`, symbol-where-
// one-exists / ISO-code-otherwise, never a generic icon — plus its localized
// NAME only, matching the option rows below; no ISO code in the displayed
// value), or a placeholder when none, and opens a bottom sheet with a pinned
// search TextField above a virtualized list of `SelectableRow`s. Modeled on
// CategoryField's field-plus-sheet chrome (FieldTrigger + BottomSheet + an
// own list), with a search box added above the list so the whole supported
// set stays quick to narrow by code OR name. The list is the caller's `groups`,
// already ordered (`useCurrencyPickerGroups` builds them from the form's context),
// so this component only filters and labels them; the holding form marks the
// field `disabled` in edit mode (a holding's currency cannot change after creation).
const CurrencyField: FC<CurrencyFieldProps> = ({
  label,
  sheetTitle,
  selected,
  onSelect,
  groups,
  required,
  disabled,
  error,
  hideLabel,
  testID,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // A hosting Screen's `automaticallyAdjustKeyboardInsets` misfires a
  // scroll/inset adjustment on its OWN background ScrollView when this
  // sheet's search field gets focus, even though that ScrollView does not
  // contain the responder — and it never self-corrects. `updateOpen`
  // notifies `onOpenChange` at every open/close site (synchronously with the
  // state update, so a caller can gate that prop off before the search field
  // can be focused) instead of calling `setOpen` directly.
  const updateOpen = (next: boolean): void => {
    setOpen(next);
    onOpenChange?.(next);
  };

  // Reset the query each time the sheet closes so a reopen starts fresh
  // rather than replaying the previous search.
  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const rows = visibleRows(groups, t, query);

  const handleSelect = (code: Currency): void => {
    // The search TextField above is the app's only focusable input inside a
    // sheet — without a dismiss on selection the keyboard stays up (and the
    // background form stays scrolled, per Screen's
    // automaticallyAdjustKeyboardInsets) even after the sheet closes.
    Keyboard.dismiss();
    onSelect(code);
    updateOpen(false);
  };

  const handleDismiss = (): void => {
    Keyboard.dismiss();
    updateOpen(false);
  };

  // The trigger's value mirrors the option rows exactly: the currency NAME
  // only, no ISO code — `SelectableRow`'s own row shows `currencyName(t,
  // code)` as its `label` with the mark carried separately via
  // `leadingText`, never a "CODE — Name" compound string, which would
  // duplicate the ISO code (the same mark/code pairing already sits in
  // `leadingText` below).
  const triggerValue =
    selected === undefined ? t('forms.fields.selectCurrency') : currencyName(t, selected);

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        hideLabel={hideLabel}
        required={required}
        disabled={disabled}
        error={error}
        testID={testID}
        onPress={() => updateOpen(true)}
        leadingText={foldMap(maybe(selected), (currency) => currencySymbol[currency])}
        value={triggerValue}
        valueTone={selected === undefined ? 'textSecondary' : 'textPrimary'}
      />

      {/* `scrollable={false}`: this sheet pins a search TextField above its OWN
          virtualized FlatList — BottomSheet's shared ScrollView would
          otherwise wrap the search field into the same scrollable region as
          the rows, instead of keeping it pinned at the top like the heading.
          A FlatList inside the sheet's `Box` body (not a ScrollView) also
          avoids the "VirtualizedLists nested in plain ScrollViews" warning. */}
      <BottomSheet
        visible={open}
        onDismiss={handleDismiss}
        gap={2}
        scrollable={false}
        header={<Text variant="heading">{sheetTitle}</Text>}
        testID="currency-picker-sheet"
        backdropTestID="currency-picker-sheet-backdrop"
      >
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t('forms.fields.searchCurrencyPlaceholder')}
          leadingIcon="magnifyingglass"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <FlatList
          data={rows}
          keyExtractor={rowKey}
          renderItem={({ item: row }) =>
            match(row)
              .with({ type: 'heading' }, ({ kind }) => (
                <Box
                  style={styles.heading}
                  accessibilityRole="header"
                  testID={`currency-group-${kind}`}
                >
                  <Text variant="caption" tone="textSecondary">
                    {t(`components.currencyField.groups.${kind}`)}
                  </Text>
                </Box>
              ))
              .with({ type: 'currency' }, ({ code }) => (
                <SelectableRow
                  testID={`currency-option-${code}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${code} ${currencyName(t, code)}`}
                  selected={code === selected}
                  onPress={() => handleSelect(code)}
                  label={currencyName(t, code)}
                  leadingText={currencySymbol[code]}
                />
              ))
              .exhaustive()
          }
          initialNumToRender={15}
          windowSize={5}
          showsVerticalScrollIndicator={false}
          // The search TextField above keeps the keyboard up
          // while this list is on screen, and a FlatList's default
          // `keyboardShouldPersistTaps` ("never") swallows the FIRST tap on a
          // row as a keyboard-dismiss instead of delivering it to the row's
          // `onPress` — a second tap was needed to actually select. "handled"
          // (the same fix `screen.component.tsx`'s own background ScrollView
          // already uses) fires the row's `onPress` on the first tap while
          // still dismissing the keyboard on a tap to an inert area of the
          // list.
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}
          testID="currency-picker-list"
        />
      </BottomSheet>
    </Box>
  );
};

export default CurrencyField;
