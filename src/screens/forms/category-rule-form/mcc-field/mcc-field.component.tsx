import { match } from 'ts-pattern';
import { useLiveQuery } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { FlatList, Keyboard } from 'react-native';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { mccLabelOf } from '@kiko/categories/mcc-names';
import { transactionsRepo } from '@kiko/transactions/repo';
import { MCC_DIGITS } from '@kiko/categories/category-rules';
import { type FC, useEffect, useMemo, useState } from 'react';
import TextField from '@kiko/design-system/components/text-field';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';
import FieldTrigger from '@kiko/design-system/components/field-trigger';
import SelectableRow from '@kiko/design-system/components/selectable-row';

import { styles } from './mcc-field.styles';
import type { MccFieldProps } from './mcc-field.props';
import { type MccPickerRow, mccPickerRows } from './mcc-picker-rows';

const DIGITS_ONLY = /^\d+$/;

const digitsOf = (text: string): string => text.replace(/\D/g, '').slice(0, MCC_DIGITS);

const rowKey = (row: MccPickerRow): string =>
  match(row)
    .with({ type: 'other' }, () => 'other')
    .with({ type: 'heading' }, ({ section }) => `heading-${section}`)
    .with({ type: 'ownEmpty' }, () => 'own-empty')
    .with({ type: 'noMatch' }, () => 'no-match')
    .with({ type: 'code' }, ({ section, code }) => `${section}-${code}`)
    .exhaustive();

// A searchable single-select merchant-code picker: the trigger shows the picked code with its
// name, and a bottom sheet lists "Other code", the codes in the user's own transactions and the
// full standard list. "Other code" shows a typed field under the trigger, so a code outside the
// list stays enterable. Modeled on CurrencyField's field-plus-sheet chrome.
const MccField: FC<MccFieldProps> = ({ value, onChange, error, testID }) => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // A half-typed code survives a type switch and back, so it starts in the typed field.
  const [typing, setTyping] = useState(value !== '' && value.length !== MCC_DIGITS);
  const [typedText, setTypedText] = useState(value);

  // Only the open sheet shows the own codes, so nothing is read while it is closed.
  const { data: own, isLoading } = useLiveQuery(
    transactionsRepo.mccCountsQuery(),
    ['transactions'],
    open,
  );

  // Reset the query each time the sheet closes so a reopen starts fresh.
  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  // A disabled read gives `[]` with `isLoading` false while the sheet fades out, which would
  // flash the empty text.
  const ownLoading = !open || isLoading;

  const rows = useMemo(
    () => mccPickerRows({ own, ownLoading, query, language: i18n.language }),
    [own, ownLoading, query, i18n.language],
  );

  const handleDismiss = (): void => {
    Keyboard.dismiss();
    setOpen(false);
  };

  const handleSelect = (code: string): void => {
    Keyboard.dismiss();
    setTyping(false);
    onChange(code);
    setOpen(false);
  };

  const handleOther = (): void => {
    const trimmedQuery = query.trim();
    const seed = DIGITS_ONLY.test(trimmedQuery) ? digitsOf(trimmedQuery) : value;

    Keyboard.dismiss();
    setTypedText(seed);
    setTyping(true);

    if (seed !== value) {
      onChange(seed);
    }

    setOpen(false);
  };

  const handleTyped = (text: string): void => {
    const digits = digitsOf(text);

    setTypedText(digits);
    onChange(digits);
  };

  const complete = value.length === MCC_DIGITS;

  const triggerValue = match({ complete, typing })
    .with({ complete: true }, () => mccLabelOf(value, i18n.language))
    .with({ typing: true }, () => t('ruleForm.mccOther'))
    .otherwise(() => t('ruleForm.selectMcc'));

  return (
    <Box gap={1}>
      <FieldTrigger
        label={t('ruleForm.mcc')}
        required
        error={typing ? undefined : error}
        testID={testID}
        onPress={() => setOpen(true)}
        value={triggerValue}
        valueTone={complete || typing ? 'textPrimary' : 'textSecondary'}
      />

      {typing && (
        <TextField
          label={t('ruleForm.mccTypedLabel')}
          value={typedText}
          onChangeText={handleTyped}
          keyboardType="number-pad"
          required
          error={error}
          testID="mcc-typed-field"
        />
      )}

      <Text variant="caption" tone="textSecondary">
        {t('ruleForm.mccHint')}
      </Text>

      {/* `scrollable={false}`: the sheet pins the search field above its OWN virtualized list, as
          CurrencyField does, so the shared ScrollView must not wrap both. */}
      <BottomSheet
        visible={open}
        onDismiss={handleDismiss}
        gap={2}
        scrollable={false}
        header={<Text variant="heading">{t('ruleForm.mccSheetTitle')}</Text>}
        testID="mcc-picker-sheet"
        backdropTestID="mcc-picker-sheet-backdrop"
      >
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t('ruleForm.mccSearchPlaceholder')}
          leadingIcon="magnifyingglass"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <FlatList
          data={rows}
          keyExtractor={rowKey}
          renderItem={({ item: row }) =>
            match(row)
              .with({ type: 'other' }, () => (
                <SelectableRow
                  testID="mcc-other-row"
                  accessibilityRole="button"
                  accessibilityLabel={`${t('ruleForm.mccOther')}, ${t('ruleForm.mccOtherDescription')}`}
                  selected={false}
                  onPress={handleOther}
                  label={t('ruleForm.mccOther')}
                  description={
                    <Text variant="caption" tone="textSecondary">
                      {t('ruleForm.mccOtherDescription')}
                    </Text>
                  }
                />
              ))
              .with({ type: 'heading' }, ({ section }) => (
                <Box
                  style={styles.heading}
                  accessibilityRole="header"
                  testID={`mcc-heading-${section}`}
                >
                  <Text variant="caption" tone="textSecondary">
                    {section === 'own' ? t('ruleForm.mccOwnSection') : t('ruleForm.mccAllSection')}
                  </Text>
                </Box>
              ))
              .with({ type: 'ownEmpty' }, () => (
                <Box style={styles.note} testID="mcc-own-empty">
                  <Text variant="caption" tone="textSecondary">
                    {t('ruleForm.mccOwnEmpty')}
                  </Text>
                </Box>
              ))
              .with({ type: 'noMatch' }, () => (
                <Box style={styles.note} testID="mcc-no-match">
                  <Text variant="caption" tone="textSecondary">
                    {t('ruleForm.mccNoMatch')}
                  </Text>
                </Box>
              ))
              .with({ type: 'code' }, ({ section, code, name, rowCount }) => {
                const selected = code === value;
                const countText = foldMap(maybe(rowCount), (count) =>
                  t('ruleForm.mccTransactionCount', { count }),
                );

                return (
                  <SelectableRow
                    testID={`mcc-${section}-${code}`}
                    accessibilityRole="button"
                    accessibilityLabel={[code, name, countText]
                      .filter((part) => part !== undefined)
                      .join(', ')}
                    selected={selected}
                    onPress={() => handleSelect(code)}
                    label={mccLabelOf(code, i18n.language)}
                    description={foldMap(maybe(countText), (text) => (
                      <Text variant="caption" tone={selected ? 'onAccent' : 'textSecondary'}>
                        {text}
                      </Text>
                    ))}
                  />
                );
              })
              .exhaustive()
          }
          windowSize={5}
          showsVerticalScrollIndicator={false}
          // The search field keeps the keyboard up while the list is on screen, and the default
          // "never" would swallow the first tap on a row as a keyboard dismiss.
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}
          testID="mcc-picker-list"
        />
      </BottomSheet>
    </Box>
  );
};

export default MccField;
