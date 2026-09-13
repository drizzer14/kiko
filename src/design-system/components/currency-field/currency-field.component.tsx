import type { TFunction } from 'i18next';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { type Currency, currencyOptions } from '../../../currency/currency';
import { currencySignSymbol } from '../../../currency/currency-symbols';
import FieldTrigger from '../../../screens/forms/field-trigger';
import BottomSheet from '../bottom-sheet';
import Box from '../box';
import SelectableRow from '../selectable-row';
import Text from '../text';
import TextField from '../text-field';

import type { CurrencyFieldProps } from './currency-field.props';
import { styles } from './currency-field.styles';

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
// current selection (its SF Symbol sign glyph + "CODE — Name", or a
// placeholder when none) and opens a bottom sheet with a pinned search
// TextField above a scrollable list of `SelectableRow`s. Modeled on
// CategoryField's field-plus-sheet chrome (FieldTrigger + BottomSheet + an
// own ScrollView), with a search box added above the list so the full
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
        required={required}
        disabled={disabled}
        testID={testID}
        onPress={() => setOpen(true)}
        icon={selected === undefined ? undefined : currencySignSymbol[selected]}
        value={triggerValue}
        valueTone={selected === undefined ? 'textSecondary' : 'textPrimary'}
      />

      {/* `scrollable={false}`: this sheet pins a search TextField above its OWN
          inner ScrollView — BottomSheet's shared ScrollView (F5 fix) would
          otherwise wrap the search field into the same scrollable region as
          the rows, instead of keeping it pinned at the top like the
          heading. */}
      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        scrollable={false}
        testID="currency-picker-sheet"
      >
        <Text variant="heading">{label}</Text>

        <TextField
          label={t('forms.fields.searchCurrency')}
          value={query}
          onChangeText={setQuery}
          placeholder={t('forms.fields.searchCurrency')}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
          {visible.map((code) => (
            <SelectableRow
              key={code}
              testID={`currency-option-${code}`}
              accessibilityRole="button"
              accessibilityLabel={`${code} ${currencyName(t, code)}`}
              selected={code === selected}
              onPress={() => handleSelect(code)}
              label={`${code} — ${currencyName(t, code)}`}
              icon={currencySignSymbol[code]}
            />
          ))}
        </ScrollView>
      </BottomSheet>
    </Box>
  );
};

export default CurrencyField;
