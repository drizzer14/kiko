import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TFunction } from 'i18next';
import type { FC } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, type ScrollViewInstance } from 'react-native';
import { useAnimatedRef } from 'react-native-reanimated';
import Sortable from 'react-native-sortables';
import { useUnistyles } from 'react-native-unistyles';

import type { Currency } from '../../currency/currency';
import type { AccountRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import CurrencyBreakdown from '../../design-system/components/currency-breakdown';
import Screen from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { isSyncedHolding } from '../../holdings/deletable';
import { defaultAccountColor } from '../../holdings/entity-colors';
import { accountKindSymbol } from '../../holdings/entity-symbols';
import { disconnectMonobank } from '../../monobank/disconnect';
import { readToken } from '../../monobank/token';
import type { AccountsStackParamList } from '../../navigation/types';
import { sumByCurrency } from '../../rates/currency-totals';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import CardContextMenu from '../card-context-menu';
import EditHeaderButton from '../edit-header-button';
import EntityAmountHeader from '../entity-amount-header';
import EntityHeaderIcon from '../entity-header-icon';
import { onGridDragEnd } from '../grid-interaction';
import { useSync } from '../use-sync';

import { styles } from './account-detail.styles';
import CryptoSyncSection from './crypto-sync-section';
import { formatLastSyncAt } from './format-last-sync';
import HoldingCard from './holding-card';
import MonobankTokenField from './monobank-token-field';

// Connect (mark institution + first import) and Sync now (re-import) are the
// same action; only the label and glyph differ. A link glyph while the action
// still establishes the connection, a refresh glyph once it re-imports.
const actionPresentation = (
  isConnectedToMonobank: boolean,
  isSyncing: boolean,
  t: TFunction,
): { label: string; icon: string } => {
  if (!isConnectedToMonobank) {
    return { label: t('accountDetail.connectMonobank'), icon: 'link' };
  }

  return {
    label: isSyncing ? t('accountDetail.syncing') : t('accountDetail.syncNow'),
    icon: 'arrow.triangle.2.circlepath',
  };
};

// The account's display identity for the view-only header: its stored icon (or
// the kind default), and its effective color resolved through the SAME
// `resolveEntityColor` the accounts-list card uses — so the identity color on
// the card and on this header can never diverge. A bare `color ?? default` here
// let an empty-string stored color (neither null nor undefined) through, tinting
// the header with an invalid empty color while the card showed the kind default.
// Extracted so the fallbacks — and the not-yet-loaded (undefined) case — don't
// count against the screen component's cognitive-complexity budget.
const accountIdentity = (
  account: AccountRow | undefined,
): { icon: string; color: string } | undefined =>
  account === undefined
    ? undefined
    : {
        icon: account.icon ?? accountKindSymbol[account.kind],
        color: resolveEntityColor(account.color, defaultAccountColor[account.kind]),
      };

type AccountDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountDetail'>;

const AccountDetailScreen: FC<AccountDetailScreenProps> = ({ route, navigation }) => {
  const { accountId, name: initialName } = route.params;
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(accountId), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.listByAccountQuery(accountId), ['holdings']);
  const { data: connectedAccounts } = useLiveQuery(accountsRepo.connectedQuery(), ['accounts']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const account = accounts.at(0);

  // The nav title shows the account NAME only — the native large title, the
  // standard iOS pattern (the identity icon now sits beside the Balance amount
  // below, not in the title). The name is available from the route params at the
  // FIRST render, so the large title (and the back button on any screen pushed
  // from here) reads immediately; the live-queried name takes over once loaded so
  // a rename flows back through. This drops the old async `headerLargeTitle: false`
  // + custom `headerTitle` toggle, which briefly blanked the pushed screen's back
  // button and flashed the large title collapsing on load.
  const accountName = account?.name ?? initialName;
  // The account's effective icon + color, rendered as the identity glyph beside
  // the Balance amount (via `EntityHeaderIcon` in the `EntityAmountHeader` icon
  // slot below) rather than in the nav title.
  const identity = accountIdentity(account);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: accountName,
      headerRight: () => (
        <EditHeaderButton onPress={() => navigation.navigate('AccountForm', { accountId })} />
      ),
    });
  }, [navigation, accountName, accountId]);

  const activeHoldings = holdings.filter((holding) => holding.closedAt == null);

  // Reuse the accounts-list conversion path: sum this account's open holdings
  // into the base currency, then list each currency's own total beneath.
  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);
  // Deposit/bond holdings grow with time, so net worth is evaluated as of now —
  // otherwise their accrued value never reflects in the account balance.
  const now = Date.now();
  const overallBalance = guardedNetWorth(activeHoldings, baseCurrency, rateTable, now);
  const breakdown = sumByCurrency(activeHoldings, now);
  // The grid renders in the query's order — `listByAccountQuery` already sorts by
  // the user-controlled `sortOrder` (the drag-and-drop order), so manual drag
  // order is the sole ordering key and no screen-level re-sort is needed.

  // The parent ScrollView's animated ref, shared with the sortable grid so a
  // drag near the top/bottom edge auto-scrolls the list (the grid is nested
  // inside this Screen's ScrollView, so it cannot scroll it without the ref).
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();

  const isBankAccount = account?.kind === 'bank';
  const isCryptoAccount = account?.kind === 'crypto';
  const isConnectedToMonobank = account?.institution === 'monobank';
  // The single-connection invariant: another account already holds the one
  // Monobank connection, so this one may not connect a second.
  const otherAccountConnected = connectedAccounts.some((connected) => connected.id !== accountId);

  const { isSyncing, error, sync } = useSync();
  const [tokenMessage, setTokenMessage] = useState<string | undefined>();
  // Guards a fast double-tap: the button is disabled only on `isSyncing`, which
  // is still false during the `readToken()` await below, so a second press
  // could fire `sync` again before the first resolves.
  const inFlight = useRef(false);

  // Connect (mark institution + first import) and Sync now (re-import) are the
  // same action against a bank account; only the label differs. Guard on a
  // stored token first so a missing token points the user at the token field
  // above (NO_TOKEN_MESSAGE) instead of surfacing an opaque sync failure.
  const handlePress = async (): Promise<void> => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      setTokenMessage(undefined);
      if ((await readToken()) === undefined) {
        setTokenMessage(t('accountDetail.noTokenMessage'));
        return;
      }
      await sync(accountId);
    } finally {
      inFlight.current = false;
    }
  };

  // Disconnect is the required first step before a Monobank account can be
  // deleted: it clears the connection and the stored Keychain token, turning the
  // account manual (its data kept as a historical snapshot). Confirm first, since
  // it discards the token. Once it resolves, the live query flips `institution`
  // to null and the account becomes swipe-deletable on the accounts list.
  const runDisconnect = async (): Promise<void> => {
    try {
      await disconnectMonobank(accountId);
    } catch {
      Alert.alert(t('accountDetail.disconnectErrorTitle'), t('accountDetail.tryAgainMessage'));
    }
  };

  const confirmDisconnect = (): void => {
    Alert.alert(
      t('accountDetail.disconnectMonobank'),
      t('accountDetail.disconnectMonobankMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('accountDetail.disconnectAction'),
          style: 'destructive',
          onPress: () => {
            runDisconnect();
          },
        },
      ],
    );
  };

  const { label: actionLabel, icon: actionIcon } = actionPresentation(
    isConnectedToMonobank,
    isSyncing,
    t,
  );

  // Show the action button for the connected account (Sync now) or for an
  // unconnected bank account only while no OTHER account holds the connection.
  const showActionButton = isBankAccount && (isConnectedToMonobank || !otherAccountConnected);
  // A different account already owns the single Monobank connection.
  const showConnectedElsewhereHint =
    isBankAccount && !isConnectedToMonobank && otherAccountConnected;

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      footer={
        <Button
          variant="primary"
          fullWidth
          onPress={() => navigation.navigate('HoldingForm', { accountId })}
        >
          {t('accountDetail.addHolding')}
        </Button>
      }
    >
      <Box gap={4} testID="account-detail-content">
        <Box gap={1} style={styles.balanceBlock}>
          <EntityAmountHeader
            label={t('accountDetail.balanceLabel')}
            money={overallBalance}
            context="balance"
            icon={<EntityHeaderIcon identity={identity} />}
          />
          <Box style={styles.breakdown}>
            <CurrencyBreakdown items={breakdown} />
          </Box>
        </Box>

        {isCryptoAccount && account && (
          <>
            <Box style={styles.divider} />
            <CryptoSyncSection account={account} holdings={activeHoldings} />
          </>
        )}

        {showActionButton && <Box style={styles.divider} />}

        {showActionButton && <MonobankTokenField isConnected={isConnectedToMonobank} />}

        {showActionButton && (
          // gap={4} (not 2) so the "last synced" line ↔ "Sync now" spacing equals
          // the "Sync now" ↔ "Disconnect" spacing (the content container's
          // gap={4}), giving the three stacked elements one even rhythm — the same
          // fix applied to the crypto sync section.
          <Box gap={4} testID="monobank-sync-status-actions">
            {isConnectedToMonobank && (
              <Box direction="row" gap={2} style={styles.statusLine}>
                <SymbolIcon name="clock" tone="textSecondary" />
                <Text variant="body" tone="textSecondary">
                  {t('accountDetail.lastSync', {
                    // The DISPLAY stamp (moves on any run that imported rows,
                    // including a partial failure), falling back to the pure
                    // statement cursor for installs that predate the display
                    // column (it reads null there).
                    time: formatLastSyncAt(
                      settingsRows.at(0)?.lastSyncDisplayAt ??
                        settingsRows.at(0)?.lastSyncAt ??
                        null,
                      t,
                    ),
                  })}
                </Text>
              </Box>
            )}
            <Button
              variant="primary"
              size="compact"
              fullWidth={false}
              onPress={() => {
                handlePress();
              }}
              disabled={isSyncing}
              icon={actionIcon}
            >
              {actionLabel}
            </Button>
          </Box>
        )}

        {isConnectedToMonobank && (
          <Button
            variant="secondary"
            size="compact"
            fullWidth={false}
            onPress={confirmDisconnect}
            icon="link.badge.plus"
          >
            {t('accountDetail.disconnectMonobank')}
          </Button>
        )}

        {showConnectedElsewhereHint && (
          <Text variant="caption" tone="textSecondary">
            {t('accountDetail.connectedElsewhere')}
          </Text>
        )}

        {tokenMessage !== undefined && (
          <Text variant="body" tone="negative">
            {tokenMessage}
          </Text>
        )}

        {error !== undefined && (
          <Text variant="body" tone="negative">
            {error}
          </Text>
        )}

        <Box style={styles.divider} />

        <Box gap={3}>
          <Text variant="heading">{t('accountDetail.holdingsHeading')}</Text>

          {/* A single-column drag-and-drop list of wide holding row cards
              (mirroring the accounts list). A plain tap opens the holding; a
              touch-and-hold-still on a manual card opens the deep-press (haptic)
              delete menu; a hold-and-move drags to reorder — see `CardContextMenu`
              and `onGridDragEnd`. `overDrag="vertical"` keeps a dragged card on
              its vertical axis (a single column has no horizontal move to make).
              `scrollableRef` + `autoScrollActivationOffset` let a drag near an
              edge scroll the parent list (F9). `sortEnabled` is off with a single
              holding, where there is nothing to reorder. */}
          <Box testID="holdings-grid">
            <Sortable.Grid
              data={activeHoldings}
              sortEnabled={activeHoldings.length > 1}
              // A subtle lift on touch-and-hold: the library default (1.1) pops
              // the card up too much, so scale it just barely (matches the
              // accounts grid).
              activeItemScale={1.03}
              columns={1}
              overDrag="vertical"
              rowGap={theme.spacing(3)}
              scrollableRef={scrollableRef}
              autoScrollActivationOffset={75}
              keyExtractor={(holding) => holding.id}
              renderItem={({ item }) => (
                <Box testID="holding-grid-item">
                  <CardContextMenu
                    name={item.name}
                    deletable={!isSyncedHolding(item, account)}
                    onDelete={() => holdingsRepo.remove(item.id)}
                  >
                    <HoldingCard
                      holding={item}
                      now={now}
                      baseCurrency={baseCurrency}
                      rateTable={rateTable}
                      onOpen={() =>
                        navigation.navigate('HoldingDetail', {
                          holdingId: item.id,
                          name: item.name,
                        })
                      }
                    />
                  </CardContextMenu>
                </Box>
              )}
              onDragEnd={({ fromIndex, toIndex, indexToKey }) =>
                onGridDragEnd({ fromIndex, toIndex, indexToKey }, holdingsRepo.reorder)
              }
            />
          </Box>
        </Box>
      </Box>
    </Screen>
  );
};

export default AccountDetailScreen;
