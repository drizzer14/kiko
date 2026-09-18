import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type FC, useState } from 'react';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import { bankCatalog, type BankId } from '../../../bank-sync/bank-catalog';

import FieldTrigger from '../field-trigger';

import { styles } from './bank-type-field.styles';
import type { BankTypeFieldProps } from './bank-type-field.props';

// The Option A "which bank is this account" picker (device-feedback-round-1
// item 3): a labeled trigger (FieldTrigger, the same family CurrencyField
// and CategoryField use) that opens a BottomSheet listing every
// `bankCatalog` entry — ALWAYS all six, never conditionally hidden
// (Guideline 5.6). Selecting a row reports the id and closes the sheet; the
// trigger stays visible and re-openable afterward (no vanish-after-select —
// see the account-detail BankSyncSection fix this plan also ships for the
// SAME class of bug there).
const BankTypeField: FC<BankTypeFieldProps> = ({ label, selected, onSelect, testID }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const selectedEntry =
    selected === null ? undefined : bankCatalog.find((entry) => entry.id === selected);

  const handleSelect = (bankId: BankId): void => {
    onSelect(bankId);
    setOpen(false);
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        onPress={() => setOpen(true)}
        value={selectedEntry?.displayName ?? t('forms.account.selectBankPlaceholder')}
        valueTone={selectedEntry === undefined ? 'textSecondary' : 'textPrimary'}
        testID={testID}
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        header={<Text variant="heading">{label}</Text>}
        testID="bank-type-sheet"
      >
        {bankCatalog.map((entry) => {
          const caption = entry.connectable
            ? t('forms.account.bankConnectable')
            : t('forms.account.bankImportOnly');

          return (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`${entry.displayName}. ${caption}`}
              onPress={() => handleSelect(entry.id)}
              style={styles.option}
              testID={`bank-type-option-${entry.id}`}
            >
              <Box gap={1}>
                <Text variant="body" tone="textPrimary">
                  {entry.displayName}
                </Text>
                <Text variant="caption" tone="textSecondary">
                  {caption}
                </Text>
              </Box>
            </Pressable>
          );
        })}
      </BottomSheet>
    </Box>
  );
};

export default BankTypeField;
