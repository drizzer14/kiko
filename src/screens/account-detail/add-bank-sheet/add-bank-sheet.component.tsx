import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import type { BankProviderId } from '../../../bank-sync/provider';
import { bankProviderRegistry } from '../../../bank-sync/registry';
import { providerCatalog } from '../../../bank-sync/provider-catalog';
import BottomSheet from '../../../design-system/components/bottom-sheet';

import { styles } from './add-bank-sheet.styles';
import type { AddBankProviderSheetProps } from './add-bank-sheet.props';

/**
 * The catalog-driven "add a bank" picker: a `BottomSheet` listing every
 * `providerCatalog` entry that ALSO has a wired `bankProviderRegistry`
 * entry — a catalog entry with no registry wiring yet is described but not
 * yet connectable, so it is filtered out rather than shown as a dead-end
 * row. Replaces the previous unconditional `MonobankConnectField` render on
 * `account-detail.screen.tsx` when the account is disconnected; a later
 * provider task adds a row here for free the moment it wires a registry
 * entry, with no change to this component.
 */
const AddBankProviderSheet: FC<AddBankProviderSheetProps> = ({ visible, onDismiss, onSelect }) => {
  const { t } = useTranslation();
  const availableEntries = providerCatalog.filter(
    (entry) => bankProviderRegistry[entry.id] !== undefined,
  );

  const handleSelect = (providerId: BankProviderId): void => {
    onSelect(providerId);
    // Selecting a row both reports the choice AND closes the sheet — a single
    // self-contained action, so a caller wires only `onSelect` for its own
    // state and gets the dismiss behavior for free.
    onDismiss();
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      header={<Text variant="heading">{t('accountDetail.addBankAction')}</Text>}
      testID="add-bank-sheet"
    >
      {availableEntries.map((entry) => (
        <Pressable
          key={entry.id}
          accessibilityRole="button"
          accessibilityLabel={`${entry.displayName}. ${t(entry.aboutKey)}. ${t(entry.eligibilityKey)}`}
          onPress={() => handleSelect(entry.id)}
          style={styles.option}
          testID={`add-bank-option-${entry.id}`}
        >
          <Box gap={1}>
            <Text variant="body" tone="textPrimary">
              {entry.displayName}
            </Text>
            <Text variant="caption" tone="textSecondary">
              {t(entry.aboutKey)}
            </Text>
            <Text variant="caption" tone="textSecondary">
              {t(entry.eligibilityKey)}
            </Text>
          </Box>
        </Pressable>
      ))}
    </BottomSheet>
  );
};

export default AddBankProviderSheet;
