import { FlatList } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { type FC, useEffect, useState } from 'react';

import Box from '../box';
import Text from '../text';
import TextField from '../text-field';
import BottomSheet from '../bottom-sheet';
import SelectableRow from '../selectable-row';
import FieldTrigger from '../../../screens/forms/field-trigger';
import { type Currency, currencyOptions, currencySymbol } from '../../../currency/currency';

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

// A labeled, searchable single-select currency picker: the field shows the
// current selection (its text currency mark — `currencySymbol`, symbol-where-
// one-exists / ISO-code-otherwise, never a generic icon — plus "CODE —
// Name", or a placeholder when none) and opens a bottom sheet with a pinned
// search TextField above a virtualized list of `SelectableRow`s. Modeled on
// CategoryField's field-plus-sheet chrome (FieldTrigger + BottomSheet + an
// own list), with a search box added above the list so the full
// six-currency (soon more) set stays quick to narrow by code OR name. The
// cash-account form restricts `options` to `fiatCurrencyOptions` (no crypto);
// the holding form keeps the full `currencyOptions` default and marks the
// field `disabled` in edit mode (a holding's currency cannot change after
// creation).
const CurrencyField: FC<CurrencyFieldProps> = ({
  label,
  selected,
  onSelect,
  options = currencyOptions,
  required,
  disabled,
  hideLabel,
  testID,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Reset the query each time the sheet closes so a reopen starts fresh
  // rather than replaying the previous search.
  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const visible = options.filter((code) => matches(t, code, query));

  const handleSelect = (code: Currency): void => {
    onSelect(code);
    setOpen(false);
  };

  const triggerValue =
    selected === undefined
      ? t('forms.fields.selectCurrency')
      : `${selected} — ${currencyName(t, selected)}`;

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        hideLabel={hideLabel}
        required={required}
        disabled={disabled}
        testID={testID}
        onPress={() => setOpen(true)}
        leadingText={selected === undefined ? undefined : currencySymbol[selected]}
        value={triggerValue}
        valueTone={selected === undefined ? 'textSecondary' : 'textPrimary'}
      />

      {/* `scrollable={false}`: this sheet pins a search TextField above its OWN
          virtualized FlatList — BottomSheet's shared ScrollView (F5 fix) would
          otherwise wrap the search field into the same scrollable region as
          the rows, instead of keeping it pinned at the top like the heading.
          A FlatList inside the sheet's `Box` body (not a ScrollView) also
          avoids the "VirtualizedLists nested in plain ScrollViews" warning. */}
      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        scrollable={false}
        header={<Text variant="heading">{label}</Text>}
        testID="currency-picker-sheet"
      >
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t('forms.fields.searchCurrencyPlaceholder')}
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
              label={`${code} — ${currencyName(t, code)}`}
              leadingText={currencySymbol[code]}
            />
          )}
          initialNumToRender={15}
          windowSize={5}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        />
      </BottomSheet>
    </Box>
  );
};

export default CurrencyField;
