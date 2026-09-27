import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { BankProviderId } from '@kiko/bank-sync/provider';
import { bankProviderRegistry } from '@kiko/bank-sync/registry';
import { type ProviderCatalogEntry, providerCatalog } from '@kiko/bank-sync/provider-catalog';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import BottomSheet from '../../../design-system/components/bottom-sheet';

import { styles } from './add-bank-sheet.styles';
import type { AddBankProviderSheetProps } from './add-bank-sheet.props';

/**
 * The rows `AddBankProviderSheet` offers: every `providerCatalog` entry that
 * has a wired `bankProviderRegistry` entry (a catalog entry with no registry
 * wiring yet is described but not yet connectable, so it stays filtered out).
 * Guideline 5.6 remediation (App Store rejection: "features intentionally
 * hidden during review"): the sheet shows the full wired catalog
 * UNCONDITIONALLY now — there is no release-readiness build flag anymore.
 * A not-yet-safe-to-connect provider must never ship in the app AT ALL
 * (removed from `src/bank-sync/provider-catalog/`, not merely hidden here);
 * see that module's own doc comment. Exported so a test can assert the
 * resolved rows directly.
 */
export const visibleCatalogEntries = (): ProviderCatalogEntry[] =>
  providerCatalog.filter((entry) => bankProviderRegistry[entry.id] !== undefined);

/**
 * The catalog-driven "add a bank" picker: a `BottomSheet` listing the rows
 * `visibleCatalogEntries` resolves. Replaces the previous unconditional
 * `MonobankConnectField` render on `account-detail.screen.tsx` when the
 * account is disconnected; a later provider task adds a row here for free
 * the moment it wires a registry entry, with no change to this component.
 */
const AddBankProviderSheet: FC<AddBankProviderSheetProps> = ({ visible, onDismiss, onSelect }) => {
  const { t } = useTranslation();
  const availableEntries = visibleCatalogEntries();

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
      header={<Text variant="heading">{t('accountDetail.addBankSheetTitle')}</Text>}
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
