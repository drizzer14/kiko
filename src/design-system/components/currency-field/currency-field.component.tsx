import {
  type Currency,
  currencyOptions,
  currencySymbol,
  isCrypto,
  isFiat,
} from '@kiko/currency/currency';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { FlatList, Keyboard } from 'react-native';
import { type FC, useEffect, useState } from 'react';

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

// Orders currency codes by their LOCALIZED name in the active language,
// case- and accent-insensitively (`sensitivity: 'base'`), so the list reads
// alphabetically in whatever language the app is showing rather than by ISO
// code. Curried so it can be handed straight to `Array.prototype.sort`.
const byLocalizedName =
  (t: TFunction, language: string) =>
  (a: Currency, b: Currency): number =>
    currencyName(t, a).localeCompare(currencyName(t, b), language, { sensitivity: 'base' });

// UAH pins to the TOP of the fiat list, ahead of the alphabetical order — but
// only when the list is not being searched (see `visibleCurrencies`).
const pinUahFirst = (fiat: readonly Currency[]): Currency[] => {
  const others = fiat.filter((code) => code !== 'UAH');

  return fiat.includes('UAH') ? ['UAH', ...others] : [...others];
};

// The rows to render: fiat first (alphabetical by localized name, with UAH
// pinned to the top only while the search box is empty), then the crypto set
// (BTC/ETH/USDT — classified through the domain's `isCrypto`, never a local
// code check) as a separate group, also alphabetical by localized name, after
// all fiats — or before them when `cryptoFirst` is set. Filtering by the search
// query happens first, so a search reorders only what it matched.
const visibleCurrencies = (input: {
  options: readonly Currency[];
  t: TFunction;
  language: string;
  query: string;
  cryptoFirst: boolean;
}): Currency[] => {
  const { options, t, language, query, cryptoFirst } = input;
  const compare = byLocalizedName(t, language);
  const matched = options.filter((code) => matches(t, code, query));
  const fiat = matched.filter(isFiat).sort(compare);
  const crypto = matched.filter(isCrypto).sort(compare);
  const orderedFiat = query.trim() === '' ? pinUahFirst(fiat) : fiat;

  return cryptoFirst ? [...crypto, ...orderedFiat] : [...orderedFiat, ...crypto];
};

// A labeled, searchable single-select currency picker: the field shows the
// current selection (its text currency mark — `currencySymbol`, symbol-where-
// one-exists / ISO-code-otherwise, never a generic icon — plus its localized
// NAME only, matching the option rows below; no ISO code in the displayed
// value), or a placeholder when none, and opens a bottom sheet with a pinned
// search TextField above a virtualized list of `SelectableRow`s. Modeled on
// CategoryField's field-plus-sheet chrome (FieldTrigger + BottomSheet + an
// own list), with a search box added above the list so the full
// six-currency (soon more) set stays quick to narrow by code OR name. The
// cash-account form restricts `options` to `fiatCurrencyOptions` (no crypto);
// the holding form passes its type's own set (`holdingCurrencyOptions`: fiat
// for cash, the full set otherwise, crypto first for a crypto holding) and
// marks the field `disabled` in edit mode (a holding's currency cannot change
// after creation).
const CurrencyField: FC<CurrencyFieldProps> = ({
  label,
  sheetTitle,
  selected,
  onSelect,
  options = currencyOptions,
  cryptoFirst = false,
  required,
  disabled,
  error,
  hideLabel,
  testID,
  onOpenChange,
}) => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // A hosting Screen's
  // `automaticallyAdjustKeyboardInsets` misfires a scroll/inset adjustment
  // on its OWN background ScrollView when this sheet's search field gets
  // focus, even though that ScrollView does not contain the responder — and
  // it never self-corrects. `updateOpen` notifies `onOpenChange` at every
  // open/close site (synchronously with the state update, so a caller can
  // gate that prop off before the search field can be focused) instead of
  // calling `setOpen` directly.
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

  const visible = visibleCurrencies({
    options,
    t,
    language: i18n.language,
    query,
    cryptoFirst,
  });

  const handleSelect = (code: Currency): void => {
    // The search TextField above is the app's only
    // focusable input inside a sheet — without a dismiss on selection the
    // keyboard stays up (and the background form stays
    // scrolled, per Screen's automaticallyAdjustKeyboardInsets) even after
    // the sheet closes.
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
  // `leadingText`, never a "CODE — Name" compound string. This used to read
  // `"${selected} — ${currencyName(t, selected)}"`, which duplicated the
  // ISO code redundantly (the same mark/code pairing already sits in
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
          data={visible}
          keyExtractor={(code) => code}
          renderItem={({ item: code }) => (
            <SelectableRow
              testID={`currency-option-${code}`}
              accessibilityRole="button"
              accessibilityLabel={`${code} ${currencyName(t, code)}`}
              selected={code === selected}
              onPress={() => handleSelect(code)}
              label={currencyName(t, code)}
              leadingText={currencySymbol[code]}
            />
          )}
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
