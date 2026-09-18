import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import SymbolIcon from '../../../design-system/components/symbol';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import { bankCatalog, type BankId } from '../../../bank-sync/bank-catalog';
import SelectableRow from '../../../design-system/components/selectable-row';

import FieldTrigger from '../field-trigger';

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
  const { theme } = useUnistyles();
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
          const isSelected = entry.id === selected;
          const caption = entry.connectable
            ? t('forms.account.bankConnectable')
            : t('forms.account.bankImportOnly');
          // The compliance-load-bearing branch: `entry.connectable` (a plain
          // catalog data field, never a build/env flag — see bank-catalog.ts)
          // is the ONLY thing gating the live-sync icon. An import-only bank
          // NEVER renders it, so its description stays honestly
          // statements-only (Guideline 5.6 — no fake connect affordance).
          const descriptionTone = isSelected ? 'onAccent' : 'textSecondary';
          // The capability icons now sit in `trailing` (device-feedback-round-3
          // item 7: far right of the option, aligned with the title), so they
          // reuse the TITLE's own tone and icon-size step (`body`, the size
          // paired with the label's `body` type step — see the "SF Symbol
          // sizing" HIG rule) rather than the caption's smaller tone/size.
          const titleTone = isSelected ? 'onAccent' : 'textPrimary';

          return (
            <SelectableRow
              key={entry.id}
              selected={isSelected}
              onPress={() => handleSelect(entry.id)}
              label={entry.displayName}
              accessibilityLabel={`${entry.displayName}. ${caption}`}
              testID={`bank-type-option-${entry.id}`}
              trailing={
                <Box direction="row" gap={1}>
                  {entry.connectable && (
                    <SymbolIcon
                      name="arrow.trianglehead.2.clockwise.rotate.90"
                      size={theme.iconSizes.body}
                      tone={titleTone}
                    />
                  )}
                  <SymbolIcon name="receipt" size={theme.iconSizes.body} tone={titleTone} />
                </Box>
              }
              // No `numberOfLines`/truncation — a caption must wrap onto a
              // second line rather than clip (device-feedback-round-3 item 7).
              description={
                <Text variant="caption" tone={descriptionTone}>
                  {caption}
                </Text>
              }
            />
          );
        })}
      </BottomSheet>
    </Box>
  );
};

export default BankTypeField;
