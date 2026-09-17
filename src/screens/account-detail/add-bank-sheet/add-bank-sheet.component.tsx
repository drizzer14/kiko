import { SHOW_UNREADY_BANKS } from '@env';
import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import type { BankProviderId } from '../../../bank-sync/provider';
import { bankProviderRegistry } from '../../../bank-sync/registry';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import { type ProviderCatalogEntry, providerCatalog } from '../../../bank-sync/provider-catalog';

import { styles } from './add-bank-sheet.styles';
import type { AddBankProviderSheetProps } from './add-bank-sheet.props';

/**
 * Pure parse of the `SHOW_UNREADY_BANKS` build flag (mirrors
 * `parseScreenshotMode` in `src/screenshot/screenshot-mode.ts`) — exported so
 * a test can exercise both states directly. `react-native-dotenv` INLINES
 * every `@env` value at BUILD time and deletes the import, so a Jest
 * `jest.mock('@env')` never runs (see that module's own doc comment); a pure
 * function taking the string is the only hermetically testable seam.
 */
export const shouldShowUnreadyBanks = (value: string): boolean => value === 'true';

/**
 * The rows `AddBankProviderSheet` offers: every `providerCatalog` entry that
 * has a wired `bankProviderRegistry` entry (a catalog entry with no registry
 * wiring yet is described but not yet connectable, so it stays filtered out
 * as before) AND is either `connectReady` or the `showUnready` build flag is
 * on. RELEASE READINESS (whole-branch review, item E): a not-`connectReady`
 * provider (bunq, PrivatBank today) must never be selectable by a real user
 * in a release/App Store build — only a TEST build with the flag on shows
 * it, so the honest graceful-fail/fail-closed states stay exercisable
 * end-to-end without shipping a not-yet-safe connection to a real user.
 * Exported (pure, no `@env` read) so a test can assert both flag states
 * directly rather than fighting the build-time `@env` inlining above.
 */
export const visibleCatalogEntries = (showUnready: boolean): ProviderCatalogEntry[] =>
  providerCatalog.filter(
    (entry) => bankProviderRegistry[entry.id] !== undefined && (entry.connectReady || showUnready),
  );

/**
 * The catalog-driven "add a bank" picker: a `BottomSheet` listing the rows
 * `visibleCatalogEntries` resolves for the real, build-time `SHOW_UNREADY_BANKS`
 * flag. Replaces the previous unconditional `MonobankConnectField` render on
 * `account-detail.screen.tsx` when the account is disconnected; a later
 * provider task adds a row here for free the moment it wires a registry
 * entry and flips `connectReady`, with no change to this component.
 */
const AddBankProviderSheet: FC<AddBankProviderSheetProps> = ({ visible, onDismiss, onSelect }) => {
  const { t } = useTranslation();
  const availableEntries = visibleCatalogEntries(shouldShowUnreadyBanks(SHOW_UNREADY_BANKS));

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
