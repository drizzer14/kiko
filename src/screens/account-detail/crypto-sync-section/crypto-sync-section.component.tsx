import { match } from 'ts-pattern';
import {
  type BalanceProviderId,
  isBalanceProviderId,
  providerDisplayName,
} from '@kiko/crypto-sync/provider';
import { formatDate } from '@kiko/dates';
import { type FC, useState } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import {
  type ExchangeCatalogId,
  exchangeCatalogIdOf,
  exchangeLabelOf,
  visibleExchangeEntries,
} from '@kiko/crypto-sync/exchange-catalog';
import { useTranslation } from 'react-i18next';
import {
  type NotImportedKind,
  type ParsedExchangeState,
  parseExchangeState,
} from '@kiko/crypto-sync/exchange/walk-state';
import { syncStateRepo } from '@kiko/sync-state';
import {
  balanceNotesOf,
  balanceSyncedAtOf,
  denseSpansOf,
  fundingHeldOf,
  fundingLeftOutOf,
  keyExpiryOf,
  logKindsOf,
  type NotImportedCount,
  notImportedCountsOf,
  oversizedCoinsOf,
  untrackedCoinsOf,
} from '@kiko/crypto-sync/exchange/history-status';
import type { ParseKeys, TFunction } from 'i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { useTimeClock } from '@kiko/i18n/use-time-clock';
import { useCryptoSync } from '@kiko/sync/use-crypto-sync';
import Button from '@kiko/design-system/components/button';
import SymbolIcon from '@kiko/design-system/components/symbol';
import { resyncRequest } from '@kiko/crypto-sync/resync-request';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import ErrorNotice from '@kiko/design-system/components/error-notice';
import { disconnectCryptoAccount } from '@kiko/crypto-sync/disconnect';
import ConfirmSheet from '@kiko/design-system/components/confirm-sheet';
import NoticeBanner from '@kiko/design-system/components/notice-banner';
import ExpandToggle from '@kiko/design-system/components/expand-toggle';
import { replanReminders } from '@kiko/reminders/use-reminder-scheduler';
import { type AccountRow, type HoldingRow, useLiveQuery } from '@kiko/db';
import type { CryptoSyncRequest } from '@kiko/crypto-sync/run-crypto-sync';
import CryptoSyncForm from '@kiko/design-system/components/crypto-sync-form';
import { exchangeProviderRegistry } from '@kiko/crypto-sync/exchange/registry';
import { type BybitLogKind, keyExpiryStateOf, walletLabelOf } from '@kiko/crypto-sync/bybit';

import ProviderSheet from '../provider-sheet';
import { styles } from '../account-detail.styles';
import SyncDisconnectActionsRow from '../sync-disconnect-actions-row';
import { formatLastSyncAt, latestBalanceSyncAt } from '../format-last-sync';

import {
  hasExchangeHistory,
  hasKeyLines,
  historyOwesRange,
  historyOwesTrades,
  isBinanceHistoryBehind,
  isTrackedAssetOf,
  p2pReadFailed,
  walkCursorsOf,
} from './binance-history-status';
import { conflictingExchangeHoldings, keepsBybitHoldings } from './conflicting-exchange-holdings';

type CryptoSyncSectionProps = {
  account: AccountRow;
  holdings: HoldingRow[];
};

// An id the registry does not wire has no message: the confirm then shows its title alone.
const disconnectMessage = (providerId: BalanceProviderId, t: TFunction): string | undefined =>
  foldMap(maybe(exchangeProviderRegistry[providerId]), (entry) => t(entry.disconnectMessageKey));

type CoinLinesProps = { untrackedCoins: string[]; oversizedCoins: string[]; exchange: string };

// Split out of the section so its own branches stay under the complexity budget.
const CoinLines: FC<CoinLinesProps> = ({ untrackedCoins, oversizedCoins, exchange }) => {
  const { t } = useTranslation();

  return (
    <>
      {untrackedCoins.length > 0 && (
        <Text variant="caption" tone="textSecondary">
          {t('accountDetail.untrackedCoins', { tickers: untrackedCoins.join(', '), exchange })}
        </Text>
      )}

      {oversizedCoins.map((coin) => (
        <Text key={coin} variant="caption" tone="textSecondary">
          {t('accountDetail.oversizedAmount', { coin })}
        </Text>
      ))}
    </>
  );
};

type KeyLinesProps = {
  provider: BalanceProviderId;
  /** The state row is still on its first load, so no stored fact can be stated yet. */
  loading: boolean;
  walkState: ParsedExchangeState;
};

// The end of the key in one of its four states, under the last sync line. It reads the stored
// date against the clock; all four states use the one caption tone. Split out of the section so
// its own branches stay under the complexity budget.
const KeyExpiryLine: FC<KeyLinesProps> = ({ provider, loading, walkState }) => {
  const { t } = useTranslation();

  if (loading || !hasKeyLines(provider)) {
    return null;
  }

  return (
    <Text variant="caption" tone="textSecondary">
      {match(keyExpiryStateOf(keyExpiryOf(walkState), Date.now()))
        .returnType<string>()
        .with({ state: 'far' }, ({ endsAtMs }) =>
          t('accountDetail.bybitKeyValidUntil', { date: formatDate(endsAtMs) }),
        )
        .with({ state: 'near' }, ({ daysLeft }) =>
          t('accountDetail.bybitKeyEndsSoon', { count: daysLeft }),
        )
        .with({ state: 'expired' }, ({ endsAtMs }) =>
          t('accountDetail.bybitKeyEnded', { date: formatDate(endsAtMs) }),
        )
        .with({ state: 'unknown' }, () => t('accountDetail.bybitKeyExpiryUnknown'))
        .exhaustive()}
    </Text>
  );
};

// The coin names its wallet: the same coin can be set aside in one wallet and held in another.
const coinLabelOf = ({ wallet, coin }: { wallet: string; coin: string }): string =>
  `${coin} (${walletLabelOf(wallet)})`;

// What the last balance reads left out: a coin set aside for a loan or an open order, a coin Bybit
// sent in a shape that could not be read, a wallet the key was refused for or that was not read.
// Split out like `CoinLines`.
const BalanceNotesLines: FC<KeyLinesProps> = ({ provider, loading, walkState }) => {
  const { t } = useTranslation();

  if (loading || !hasKeyLines(provider)) {
    return null;
  }

  const { borrowed, openOrder, refusedCoins, refusedWallets, notReadWallets } =
    balanceNotesOf(walkState);

  return (
    <>
      {borrowed.map((note) => (
        <Text key={coinLabelOf(note)} variant="caption" tone="textSecondary">
          {t('accountDetail.bybitCoinBorrowed', { coin: coinLabelOf(note) })}
        </Text>
      ))}

      {openOrder.map((note) => (
        <Text key={coinLabelOf(note)} variant="caption" tone="textSecondary">
          {t('accountDetail.bybitCoinOpenOrder', { coin: coinLabelOf(note) })}
        </Text>
      ))}

      {refusedCoins.map((note) => (
        <Text key={coinLabelOf(note)} variant="caption" tone="textSecondary">
          {t('accountDetail.bybitCoinRefused', { coin: coinLabelOf(note) })}
        </Text>
      ))}

      {refusedWallets.map((wallet) => (
        <Text key={wallet} variant="caption" tone="textSecondary">
          {t('accountDetail.bybitWalletRefused', { wallet: walletLabelOf(wallet) })}
        </Text>
      ))}

      {notReadWallets.map((wallet) => (
        <Text key={wallet} variant="caption" tone="textSecondary">
          {t('accountDetail.bybitWalletNotRead', { wallet: walletLabelOf(wallet) })}
        </Text>
      ))}
    </>
  );
};

type LeftOutLogKind = Exclude<BybitLogKind, 'spotTrade' | 'coveredElsewhere'>;

// The kinds of log entry the log walk names and does not import. Keyed by the kind, so a kind that
// is added or renamed fails the type check here. A kind the stored list holds that this build does
// not name is left out of the line.
const logKindCopyKeys: Record<LeftOutLogKind, ParseKeys> = {
  derivatives: 'accountDetail.bybitLogKind.derivatives',
  convertEntries: 'accountDetail.bybitLogKind.convertEntries',
  interestAndLoans: 'accountDetail.bybitLogKind.interestAndLoans',
  bonuses: 'accountDetail.bybitLogKind.bonuses',
  earn: 'accountDetail.bybitLogKind.earn',
  stocks: 'accountDetail.bybitLogKind.stocks',
  custody: 'accountDetail.bybitLogKind.custody',
  other: 'accountDetail.bybitLogKind.other',
};

// The order of the closed list.
const LOG_KIND_ORDER: readonly LeftOutLogKind[] = [
  'derivatives',
  'convertEntries',
  'interestAndLoans',
  'bonuses',
  'earn',
  'stocks',
  'custody',
  'other',
];

// The entries of the transaction log the last reads met and did not import. Split out like
// `CoinLines`.
const LogLeftOutLine: FC<KeyLinesProps> = ({ provider, loading, walkState }) => {
  const { t } = useTranslation();
  const met = logKindsOf(walkState);
  const kinds = LOG_KIND_ORDER.filter((kind) => met.includes(kind)).map((kind) =>
    t(logKindCopyKeys[kind]),
  );

  if (loading || !hasKeyLines(provider) || kinds.length === 0) {
    return null;
  }

  return (
    <Text variant="caption" tone="textSecondary">
      {t('accountDetail.bybitLogLeftOut', { kinds: kinds.join(', ') })}
    </Text>
  );
};

// The Funding moves the last reconcile held back for looking like a move Kiko already has, and the
// ledger rows Bybit gave no id. Both are standing facts of the stored state. Split out like
// `CoinLines`.
const FundingLines: FC<KeyLinesProps> = ({ provider, loading, walkState }) => {
  const { t } = useTranslation();
  const heldCount = fundingHeldOf(walkState);

  if (loading || !hasKeyLines(provider)) {
    return null;
  }

  return (
    <>
      {heldCount > 0 && (
        <Text variant="caption" tone="textSecondary">
          {t('accountDetail.bybitFundingHeld', { count: heldCount })}
        </Text>
      )}

      {fundingLeftOutOf(walkState) && (
        <Text variant="caption" tone="textSecondary">
          {t('accountDetail.bybitFundingNoId')}
        </Text>
      )}
    </>
  );
};

type HistoryCaptionProps = KeyLinesProps & { isBehind: boolean; exchange: string };

// The caption under the lines of a history that is not whole. A burst of records inside one second
// that a read cannot pass stands in place of the pending caption, whose "will keep importing" does
// not hold there. Its mark is a standing fact of the last run, so it needs no lag. Split out of the
// section so its own branches stay under the complexity budget.
const HistoryCaption: FC<HistoryCaptionProps> = ({
  provider,
  loading,
  walkState,
  isBehind,
  exchange,
}) => {
  const { t } = useTranslation();
  const [denseSince] = Object.values(denseSpansOf(walkState))
    .filter((start): start is number => typeof start === 'number')
    .sort((first, second) => first - second);

  if (!loading && hasKeyLines(provider) && denseSince !== undefined) {
    return (
      <Text variant="caption" tone="textSecondary">
        {t('accountDetail.bybitHistoryDense', { date: formatDate(denseSince) })}
      </Text>
    );
  }

  if (!isBehind) {
    return null;
  }

  return (
    <Text variant="caption" tone="textSecondary">
      {t('accountDetail.exchangeHistoryPending', { exchange })}
    </Text>
  );
};

// What Kiko reads of the exchange and what it leaves out. It states no stored fact, so it needs no
// loaded state. The text is long, so it renders only once the shared toggle opens it; the toggle
// stays above it, so it does not move when the text appears.
const KindsLine: FC<Pick<KeyLinesProps, 'provider'>> = ({ provider }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (!hasKeyLines(provider)) {
    return null;
  }

  return (
    <Box gap={1}>
      <ExpandToggle
        expanded={expanded}
        onPress={() => setExpanded((isExpanded) => !isExpanded)}
        collapsedLabel={t('accountDetail.bybitSyncDetails')}
        testID="bybit-kinds-toggle"
      />

      {expanded && (
        <Text variant="caption" tone="textSecondary">
          {t('accountDetail.bybitKinds')}
        </Text>
      )}
    </Box>
  );
};

const notImportedKindCopyKeys: Record<NotImportedKind, ParseKeys> = {
  'p2p-sale': 'accountDetail.notImportedKind.p2pSale',
  'p2p-advertiser': 'accountDetail.notImportedKind.p2pAdvertiser',
  'p2p-amount': 'accountDetail.notImportedKind.p2pAmount',
  'p2p-unrecognized': 'accountDetail.notImportedKind.p2pUnrecognized',
  'convert-unrecognized': 'accountDetail.notImportedKind.convertUnrecognized',
  'fiat-unrecognized': 'accountDetail.notImportedKind.fiatUnrecognized',
};

type NotImportedLineProps = {
  counts: NotImportedCount[];
  exchange: string;
};

// Split out of the section so its own branches stay under the complexity budget.
const NotImportedLine: FC<NotImportedLineProps> = ({ counts, exchange }) => {
  const { t } = useTranslation();

  if (counts.length === 0) {
    return null;
  }

  return (
    <Text variant="caption" tone="textSecondary">
      {t('accountDetail.notImported', {
        items: counts
          .map(({ kind, count }) => t(notImportedKindCopyKeys[kind], { count }))
          .join(', '),
        exchange,
      })}
    </Text>
  );
};

type ConnectExchangeProps = {
  account: AccountRow;
  holdings: HoldingRow[];
  onConnectWallet: (address: string) => Promise<boolean>;
  onConnectBinance: () => Promise<boolean>;
  onConnectBybit: () => Promise<boolean>;
};

// The bank section's "Add a bank" pattern for a crypto account: the provider's field directly when
// the account's bank id names a wired one, else a button that opens the provider sheet. A sheet
// pick is session-only and never written to the account's bank id. Split out of the section so its
// own branches stay under the complexity budget.
const ConnectExchange: FC<ConnectExchangeProps> = ({
  account,
  holdings,
  onConnectWallet,
  onConnectBinance,
  onConnectBybit,
}) => {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<ExchangeCatalogId | undefined>(undefined);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const entries = visibleExchangeEntries();
  const catalogId = exchangeCatalogIdOf(account);
  const namedId = entries.find((entry) => entry.id === catalogId)?.id;
  const shownId = selectedId ?? namedId;

  const providerSheetEntries = entries.map((entry) => ({
    id: entry.id,
    label: exchangeLabelOf(entry, t),
    captions: [t(entry.captionKey)],
  }));
  // The pick is refused, and its form never shown, while the account keeps another provider's
  // holdings: a disconnect keeps their keys, so they would read as synced with no sync behind
  // them.
  const isRefused =
    shownId !== undefined && conflictingExchangeHoldings(shownId, holdings).length > 0;
  const shownLabel = providerSheetEntries.find((entry) => entry.id === shownId)?.label ?? '';

  return (
    <>
      {shownId === undefined ? (
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          icon="plus"
          onPress={() => setProviderPickerOpen(true)}
        >
          {t('accountDetail.connectExchangeAction')}
        </Button>
      ) : (
        <Box gap={2}>
          {isRefused ? (
            <NoticeBanner
              message={t('accountDetail.exchangeSwitchRefused', { exchange: shownLabel })}
              testID="exchange-switch-refused"
            />
          ) : (
            <CryptoSyncForm
              accountId={account.id}
              source={shownId}
              onConnectWallet={onConnectWallet}
              onConnectBinance={onConnectBinance}
              onConnectBybit={onConnectBybit}
              keepsBybitHoldings={keepsBybitHoldings(holdings)}
            />
          )}

          {/* Hidden when the bank id itself names the provider: the live bank id would put the
              same pick straight back, so pressing it would visibly change nothing. */}
          {namedId === undefined && (
            <Button
              variant="secondaryTonal"
              size="small"
              fullWidth={false}
              onPress={() => setSelectedId(undefined)}
            >
              {t('accountDetail.changeExchangeAction')}
            </Button>
          )}
        </Box>
      )}

      <ProviderSheet
        visible={providerPickerOpen}
        title={t('accountDetail.connectExchangeSheetTitle')}
        entries={providerSheetEntries}
        onDismiss={() => setProviderPickerOpen(false)}
        onSelect={setSelectedId}
        testIDPrefix="connect-exchange"
      />
    </>
  );
};

// The crypto account's Synchronization section — the counterpart of the bank
// account's Monobank token field + Connect/Sync/Disconnect row. Before a
// connection: the account's exchange or wallet field, or a button that picks one
// (each field's Connect runs the first sync, which marks the account). Once
// connected: Sync with the last-sync stamp, and a confirmed Disconnect.
const CryptoSyncSection: FC<CryptoSyncSectionProps> = ({ account, holdings }) => {
  const { t } = useTranslation();
  const clock = useTimeClock();
  const { isSyncing, error, sync } = useCryptoSync();
  // The history walks' marks live in this account's own `sync_state` row, read through its own
  // live query and gated on its own isLoading: the caption never answers "behind" from a row that
  // is still on its first load (kiko-architecture's useLiveQuery consumer rule).
  const { data: syncStateRows, isLoading: syncStateLoading } = useLiveQuery(
    syncStateRepo.getQuery(account.id),
    ['sync_state'],
  );
  // Multi-connection: each crypto account connects independently, so
  // there is no "connected elsewhere" gate — another account holding this source
  // does not block connecting it here.
  const connectedProvider = isBalanceProviderId(account.institution)
    ? account.institution
    : undefined;
  // Whether the themed Disconnect confirm (`ConfirmSheet`) is up; a scrim/back
  // dismiss behaves like Cancel.
  const [disconnectPending, setDisconnectPending] = useState(false);

  // A synced account sends no reminder, and a disconnected one sends them
  // again, so both re-plan; the sync can make the account synced even when it
  // fails later on.
  const connectThenReplan = async (request: CryptoSyncRequest): Promise<boolean> => {
    const synced = await sync(request);

    replanReminders();

    return synced;
  };

  const connectWallet = (address: string): Promise<boolean> =>
    connectThenReplan({ providerId: 'btc_wallet', targetAccountId: account.id, address });

  const connectBinance = (): Promise<boolean> =>
    connectThenReplan({ providerId: 'binance', targetAccountId: account.id });

  const connectBybit = (): Promise<boolean> =>
    connectThenReplan({ providerId: 'bybit', targetAccountId: account.id });

  const runDisconnect = async (providerId: BalanceProviderId): Promise<void> => {
    try {
      await disconnectCryptoAccount(account.id, providerId);
    } catch {
      alertOnCatch(t, 'accountDetail.disconnectErrorTitle', 'accountDetail.tryAgainMessage');

      return;
    }

    replanReminders();
  };

  const confirmDisconnect = (): void => {
    setDisconnectPending(true);
  };

  const cancelDisconnect = (): void => {
    setDisconnectPending(false);
  };

  const disconnect = (providerId: BalanceProviderId): void => {
    setDisconnectPending(false);
    // runDisconnect catches and alerts every failure itself.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    runDisconnect(providerId);
  };

  if (connectedProvider !== undefined) {
    // Only an exchange imports a separate transaction history behind the balance —
    // a wallet's balance IS the whole synced picture, so it never lags. Hidden
    // while a sync is in flight: `syncedAt` moves the instant the balance leg
    // commits, but the history walk's own cursor only catches up a few seconds
    // later (a SEPARATE, slower step), so the caption would otherwise flash on
    // every sync after more than a day away.
    const exchangeHistory = hasExchangeHistory(connectedProvider);
    const walkState = parseExchangeState(syncStateRows.at(0)?.exchangeState ?? null);
    // A state this build cannot read pauses the history (the run starts no walk on it), and its
    // caption replaces the "behind" one: a null cursor of such a state would read as behind. It is
    // a standing fact of the stored state, not a lag a sync closes, so a sync in flight keeps it.
    const historyPaused = !syncStateLoading && exchangeHistory && walkState.kind === 'malformed';
    // The coin lines state what the last read found, so a sync in flight keeps them; a state that
    // is malformed holds no list, and a wallet has none.
    const coinLinesShown = !syncStateLoading && exchangeHistory;
    // An account with no tracked holding has no holding stamp, so the state's stamp is its sync
    // time; a wallet's state holds none, so it reads its holdings alone.
    const lastBalanceSyncAt = latestBalanceSyncAt(holdings, balanceSyncedAtOf(walkState));
    const historyBehind =
      !isSyncing &&
      !syncStateLoading &&
      !historyPaused &&
      exchangeHistory &&
      isBinanceHistoryBehind({
        cursors: walkCursorsOf(walkState, connectedProvider),
        lastBalanceSyncAt,
        owesRange: historyOwesRange(walkState, lastBalanceSyncAt, connectedProvider),
        tradesUnread: historyOwesTrades(walkState),
      });

    return (
      <Box gap={3}>
        <Text variant="heading">{t('accountDetail.synchronization')}</Text>

        {/* gap={3} (not 2) so the "last synced" line ↔ actions-row spacing equals
            the section root's gap={3}, keeping one even vertical rhythm. The Sync
            and Disconnect buttons themselves sit SIDE BY SIDE in the single
            actions row below, not stacked. */}
        <Box gap={3} testID="crypto-sync-status-actions">
          <Box direction="row" gap={2} style={styles.statusLine}>
            <SymbolIcon name="clock" tone="textSecondary" />

            <Text variant="body" tone="textSecondary">
              {t('accountDetail.lastSync', {
                time: formatLastSyncAt(lastBalanceSyncAt, t, clock),
              })}
            </Text>
          </Box>

          <KeyExpiryLine
            provider={connectedProvider}
            loading={syncStateLoading}
            walkState={walkState}
          />

          {coinLinesShown && (
            <CoinLines
              untrackedCoins={untrackedCoinsOf(walkState, isTrackedAssetOf(connectedProvider))}
              oversizedCoins={oversizedCoinsOf(walkState)}
              exchange={providerDisplayName(connectedProvider, t)}
            />
          )}

          {coinLinesShown && (
            <NotImportedLine
              counts={notImportedCountsOf(walkState)}
              exchange={providerDisplayName(connectedProvider, t)}
            />
          )}

          <LogLeftOutLine
            provider={connectedProvider}
            loading={syncStateLoading}
            walkState={walkState}
          />

          <FundingLines
            provider={connectedProvider}
            loading={syncStateLoading}
            walkState={walkState}
          />

          <BalanceNotesLines
            provider={connectedProvider}
            loading={syncStateLoading}
            walkState={walkState}
          />

          {historyPaused && (
            <Text variant="caption" tone="textSecondary">
              {t('accountDetail.exchangeHistoryPaused', {
                exchange: providerDisplayName(connectedProvider, t),
              })}
            </Text>
          )}

          {/* A standing fact of the last run, like the coin lines, so a sync in flight keeps it; a
              state that is malformed holds no mark, so it never doubles the paused caption. */}
          {coinLinesShown && p2pReadFailed(walkState) && (
            <Text variant="caption" tone="textSecondary">
              {t('accountDetail.exchangeP2pReadFailed', {
                exchange: providerDisplayName(connectedProvider, t),
              })}
            </Text>
          )}

          <HistoryCaption
            provider={connectedProvider}
            loading={syncStateLoading}
            walkState={walkState}
            isBehind={historyBehind}
            exchange={providerDisplayName(connectedProvider, t)}
          />

          <KindsLine provider={connectedProvider} />

          {/* Sync and Disconnect share a single row — the shared
              SyncDisconnectActionsRow (both the neutral `secondaryTonal`
              treatment, never blue). */}
          <SyncDisconnectActionsRow
            onSync={() => {
              // The shared sync action folds a failure into its error state and never rejects.
              // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
              sync(resyncRequest(connectedProvider, account.id));
            }}
            isSyncing={isSyncing}
            onDisconnect={confirmDisconnect}
            testID="crypto-sync-actions-row"
          />
        </Box>

        {error !== undefined && <ErrorNotice message={error} />}

        {/* The crypto provider Disconnect confirmation — the same shared themed
            `ConfirmSheet` the grid-card long-press delete uses. A scrim/back
            dismiss behaves like Cancel. */}
        <ConfirmSheet
          visible={disconnectPending}
          title={t('accountDetail.disconnectProvider', {
            provider: providerDisplayName(connectedProvider, t),
          })}
          message={disconnectMessage(connectedProvider, t)}
          confirmLabel={t('accountDetail.disconnectAction')}
          onConfirm={() => disconnect(connectedProvider)}
          onCancel={cancelDisconnect}
          destructive
          confirmTestID="crypto-disconnect-confirm"
        />
      </Box>
    );
  }

  return (
    <Box gap={3}>
      <Text variant="heading">{t('accountDetail.synchronization')}</Text>

      <ConnectExchange
        account={account}
        holdings={holdings}
        onConnectWallet={connectWallet}
        onConnectBinance={connectBinance}
        onConnectBybit={connectBybit}
      />

      {error !== undefined && <ErrorNotice message={error} />}
    </Box>
  );
};

export default CryptoSyncSection;
