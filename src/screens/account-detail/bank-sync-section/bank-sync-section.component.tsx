import { useState } from 'react';
import { Alert } from 'react-native';
import type { FC, ReactNode } from 'react';
import { useSync } from '@kiko/sync/use-sync';
import { useTranslation } from 'react-i18next';
import { syncStateRepo } from '@kiko/sync-state/sync-state.repo';

import {
  bankProviderIdOf,
  isBankProviderId,
  type BankProviderId,
} from '../../../bank-sync/provider';
import { saveToken } from '../../../monobank/token';
import type { AccountRow } from '../../../db/schema';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import { useLiveQuery } from '../../../db/use-live-query';
import Button from '../../../design-system/components/button';
import SymbolIcon from '../../../design-system/components/symbol';
import { bankProviderRegistry } from '../../../bank-sync/registry';
import ConfirmSheet from '../../../design-system/components/confirm-sheet';

import { styles } from '../account-detail.styles';
import AddBankProviderSheet from '../add-bank-sheet';
import { formatLastSyncAt } from '../format-last-sync';
import MonobankConnectField from '../monobank-connect-field';

type BankSyncSectionProps = {
  account: AccountRow;
};

/**
 * The connected provider, resolved THROUGH THE REGISTRY rather than a
 * hardcoded `=== 'monobank'` check, so a later native provider's connection
 * renders the exact same connected-state block below. A multi-bank
 * provider's institution carries a `<providerId>:<...>` suffix
 * (`bankProviderIdOf` strips it); a single-bank one round-trips unchanged.
 * Guarded with `isBankProviderId` rather than asserted with `as` — an
 * institution value that is not a known bank provider id (defensively,
 * should never happen) resolves to `undefined` instead of a false-typed id.
 */
const resolveConnectedProviderId = (institution: string | null): BankProviderId | undefined => {
  if (institution === null) {
    return undefined;
  }

  const providerId = bankProviderIdOf(institution);

  return isBankProviderId(providerId) ? providerId : undefined;
};

type DisconnectCopy = {
  titleKey: 'accountDetail.disconnectMonobank';
  messageKey: 'accountDetail.disconnectMonobankMessage';
};

/**
 * The connected-state Disconnect confirmation copy, keyed by provider id —
 * DATA-DRIVEN (a lookup, not a `=== 'monobank'` ternary), so a later native
 * provider adds one entry here rather than growing a binary conditional.
 * `Partial`, matching `connectFieldByProviderId` below: only the providers
 * with a wired registry entry get a row. Falls back to the Monobank copy for
 * a provider id this map has no entry for (defensive; unreachable today,
 * since this is read only when `connectedEntry` — itself only ever set for
 * a registry-wired provider — is defined). Guideline 5.6 remediation:
 * PrivatBank, bunq, and Starling rows were removed — Monobank is the sole
 * shipped provider.
 */
const DEFAULT_DISCONNECT_COPY: DisconnectCopy = {
  titleKey: 'accountDetail.disconnectMonobank',
  messageKey: 'accountDetail.disconnectMonobankMessage',
};

const disconnectCopyByProviderId: Partial<Record<BankProviderId, DisconnectCopy>> = {
  monobank: DEFAULT_DISCONNECT_COPY,
};

const disconnectCopyFor = (connectedProviderId: BankProviderId): DisconnectCopy =>
  disconnectCopyByProviderId[connectedProviderId] ?? DEFAULT_DISCONNECT_COPY;

// The bank account's Synchronization section — the counterpart of
// `CryptoSyncSection` for a native stored-token/credential provider. Before a
// connection: an "Add a bank" trigger opens `AddBankProviderSheet`, then the
// chosen provider's own connect field (Monobank's single token). Once
// connected: Sync with the last-sync stamp, and a confirmed Disconnect —
// both routed THROUGH THE REGISTRY (`bankProviderRegistry[connectedProviderId]`),
// never hardcoded to Monobank, so a later native provider needs only a
// registry entry and a row in `connectFieldByProviderId` below, never a
// rewrite of this section. Guideline 5.6 remediation: PrivatBank, bunq, and
// Starling connect flows were removed — Monobank is the sole shipped
// provider.
const BankSyncSection: FC<BankSyncSectionProps> = ({ account }) => {
  const { t } = useTranslation();
  // The bank "last sync" line reads this account's OWN cursor from the
  // per-connection `sync_state` table (de-globalized from `settings` — see
  // the `syncState` table comment in `db/schema.ts`), so a second connection
  // never shows another's time.
  const { data: syncStateRows } = useLiveQuery(syncStateRepo.getQuery(account.id), ['sync_state']);

  const connectedProviderId = resolveConnectedProviderId(account.institution);
  const connectedEntry =
    connectedProviderId === undefined ? undefined : bankProviderRegistry[connectedProviderId];

  // Which provider's connect field to show BEFORE a connection exists — set
  // by `AddBankProviderSheet`'s selection, or DEFAULTED straight to the
  // account's own `bankId` (item 1, F3): the account form's BankTypeField
  // already identified this account as Monobank, so re-asking through the
  // generic "Add a bank" picker (today a picker of exactly one entry) is
  // redundant friction and the label was misleading ("Add a bank" on an
  // account already known to be Monobank) — the section goes straight to
  // the Connect field instead. Reset back to `undefined` on Disconnect
  // (below), so the picker/trigger reappears rather than re-showing the
  // just-disconnected provider's field.
  const [selectedProviderId, setSelectedProviderId] = useState<BankProviderId | undefined>(
    isBankProviderId(account.bankId) ? account.bankId : undefined,
  );
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  // Whether the themed Disconnect confirm (`ConfirmSheet`) is up, replacing the
  // old native `Alert.alert`; a scrim/back dismiss behaves like Cancel.
  const [disconnectPending, setDisconnectPending] = useState(false);

  // Monobank's existing, battle-tested sync hook — unchanged, still used
  // directly for the Monobank connect/re-sync flow (reuse by import, never
  // rewrite `src/monobank/sync/sync.ts`). The sole provider today, so it is
  // the section's one sync action — a later native provider's own action
  // joins it behind the same `{ isSyncing, error, sync }` shape.
  const { isSyncing, error, sync } = useSync();

  // The bank counterpart of the create-form's `connectMonobank` closure
  // (`account-form.screen.tsx`): store the validated token to the Keychain
  // (keyed by THIS account's id), then run the first sync. `MonobankConnectField`
  // validates the token with `fetchClientInfo` BEFORE calling this, so an
  // invalid token never reaches `saveToken` — no orphaned Keychain item.
  const connectMonobank = async (token: string): Promise<boolean> => {
    try {
      await saveToken(account.id, token);
    } catch {
      return false;
    }

    return sync(account.id);
  };

  // Disconnect is the required first step before a connected bank account
  // can be deleted: it clears the connection and the stored Keychain
  // credential, turning the account manual (its data kept as a historical
  // snapshot). Routed THROUGH THE REGISTRY (`connectedEntry.disconnect`),
  // never a hardcoded provider call.
  const runDisconnect = async (): Promise<void> => {
    if (!connectedEntry) {
      return;
    }

    try {
      await connectedEntry.disconnect(account.id);
    } catch {
      Alert.alert(t('accountDetail.disconnectErrorTitle'), t('accountDetail.tryAgainMessage'));
    }
  };

  const confirmDisconnect = (): void => {
    setDisconnectPending(true);
  };

  const cancelDisconnect = (): void => {
    setDisconnectPending(false);
  };

  const disconnect = (): void => {
    setDisconnectPending(false);
    setSelectedProviderId(undefined);
    runDisconnect();
  };

  if (connectedEntry && connectedProviderId) {
    const { titleKey, messageKey } = disconnectCopyFor(connectedProviderId);

    return (
      <Box gap={3}>
        <Text variant="heading">{t('accountDetail.synchronization')}</Text>

        {/* gap={4} (not 2) so the "last synced" line ↔ actions-row spacing
            equals the surrounding content container's gap={4}
            (`account-detail-content`), keeping one even vertical rhythm. The
            Sync and Disconnect buttons themselves sit SIDE BY SIDE in the
            single actions row below, not stacked. */}
        <Box gap={4} testID="bank-sync-status-actions">
          <Box direction="row" gap={2} style={styles.statusLine}>
            <SymbolIcon name="clock" tone="textSecondary" />
            <Text variant="body" tone="textSecondary">
              {t('accountDetail.lastSync', {
                // The DISPLAY stamp (moves on any run that imported rows,
                // including a partial failure), falling back to the pure
                // statement cursor for installs that predate the display
                // column (it reads null there).
                time: formatLastSyncAt(
                  syncStateRows.at(0)?.lastSyncDisplayAt ?? syncStateRows.at(0)?.lastSyncAt ?? null,
                  t,
                ),
              })}
            </Text>
          </Box>

          {/* Sync and Disconnect share a single row. Sync is the affirmative
              blue `primary` re-import CTA; Disconnect stays a neutral tonal
              action beside it — never blue. */}
          <Box direction="row" gap={2} testID="bank-sync-actions-row">
            <Button
              variant="primary"
              size="small"
              fullWidth={false}
              onPress={() => {
                sync(account.id);
              }}
              disabled={isSyncing}
              // iOS-26 rotate glyph; the central IOS26_SYMBOL_FALLBACKS map
              // (symbol.availability.ts) hands SymbolIcon the iOS-16-safe
              // `arrow.triangle.2.circlepath` on a pre-26 device automatically,
              // even through the shared Button's `icon` prop.
              icon="arrow.trianglehead.2.clockwise.rotate.90"
            >
              {isSyncing ? t('accountDetail.syncing') : t('accountDetail.syncNow')}
            </Button>
            <Button
              variant="secondaryTonal"
              size="small"
              fullWidth={false}
              onPress={confirmDisconnect}
              icon="lock.open"
            >
              {t('accountDetail.disconnectAction')}
            </Button>
          </Box>
        </Box>

        {error !== undefined && (
          <Text variant="body" tone="negative">
            {error}
          </Text>
        )}

        {/* The bank Disconnect confirmation — the same shared themed
            `ConfirmSheet` the grid-card long-press delete uses, replacing the
            old native `Alert.alert`. A scrim/back dismiss behaves like
            Cancel. */}
        <ConfirmSheet
          visible={disconnectPending}
          title={t(titleKey)}
          message={t(messageKey)}
          confirmLabel={t('accountDetail.disconnectAction')}
          onConfirm={disconnect}
          onCancel={cancelDisconnect}
          destructive
          confirmTestID="bank-disconnect-confirm"
        />
      </Box>
    );
  }

  // A provider-id -> connect-field map, so a later provider task adds one row
  // here without rewriting the rest of this section.
  const connectFieldByProviderId: Partial<Record<BankProviderId, ReactNode>> = {
    monobank: <MonobankConnectField onConnect={connectMonobank} />,
  };

  return (
    <Box gap={3}>
      <Text variant="heading">{t('accountDetail.synchronization')}</Text>

      {selectedProviderId === undefined ? (
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          icon="plus"
          onPress={() => setProviderPickerOpen(true)}
        >
          {t('accountDetail.addBankAction')}
        </Button>
      ) : (
        <Box gap={2}>
          {connectFieldByProviderId[selectedProviderId]}

          <Button
            variant="ghost"
            size="small"
            fullWidth={false}
            onPress={() => setSelectedProviderId(undefined)}
          >
            {t('accountDetail.changeBankAction')}
          </Button>
        </Box>
      )}

      {error !== undefined && (
        <Text variant="body" tone="negative">
          {error}
        </Text>
      )}

      <AddBankProviderSheet
        visible={providerPickerOpen}
        onDismiss={() => setProviderPickerOpen(false)}
        onSelect={setSelectedProviderId}
      />
    </Box>
  );
};

export default BankSyncSection;
