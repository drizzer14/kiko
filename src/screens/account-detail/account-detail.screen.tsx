import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import Sortable from 'react-native-sortables';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import type { AccountRow } from '../../db/schema';
import { formatDateTime } from '../../dates/format';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import CurrencyBreakdown from '../../design-system/components/currency-breakdown';
import MoneyText from '../../design-system/components/money-text';
import Screen from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import { isSyncedHolding } from '../../holdings/deletable';
import { defaultAccountColor } from '../../holdings/entity-colors';
import { disconnectMonobank } from '../../monobank/disconnect';
import { readToken } from '../../monobank/token';
import type { AccountsStackParamList } from '../../navigation/types';
import { sumByCurrency } from '../../rates/currency-totals';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import CardContextMenu from '../card-context-menu.component';
import ColorPicker from '../forms/color-picker';
import HoldingIdentityField from '../forms/holding-identity-field';
import { onGridDragEnd } from '../grid-interaction';
import { useSync } from '../use-sync';
import { KIND_ICON } from '../accounts/accounts.screen';
import { styles } from './account-detail.styles';
import HoldingCard from './holding-card.component';
import MonobankTokenField from './monobank-token-field.component';

// The token input now lives on this screen, so a missing token points the user
// up to that field rather than off to global Settings.
const NO_TOKEN_MESSAGE = 'Add your Monobank token above before connecting.';

const formatLastSyncAt = (lastSyncAt: number | null): string =>
  lastSyncAt === null ? 'Never' : formatDateTime(lastSyncAt);

// Connect (mark institution + first import) and Sync now (re-import) are the
// same action; only the label and glyph differ. A link glyph while the action
// still establishes the connection, a refresh glyph once it re-imports.
const actionPresentation = (
  isConnectedToMonobank: boolean,
  isSyncing: boolean,
): { label: string; icon: string } => {
  if (!isConnectedToMonobank) {
    return { label: 'Connect Monobank', icon: 'link' };
  }

  return {
    label: isSyncing ? 'Syncing…' : 'Sync now',
    icon: 'arrow.triangle.2.circlepath',
  };
};

// The account's own metadata, edited here rather than on the tiny accounts-list
// row: the icon opens the shared picker (with remove-to-default) under one
// labelled "Icon" block reused from the create form, and the name is a proper
// labelled field. Local name state seeds from the account so keystrokes show
// immediately while the persisted value flows back through the live query; the
// rename commits once on end-of-editing (return-key submit or blur) via the
// generic accountsRepo.update, and an empty or unchanged name is never written.
const AccountMetadataHeader: FC<{ account: AccountRow }> = ({ account }) => {
  const [name, setName] = useState(account.name);

  const commitName = (): void => {
    const trimmed = name.trim();

    if (trimmed !== '' && trimmed !== account.name) {
      accountsRepo.update(account.id, { name: trimmed });
    }
  };

  // The effective color: the account's own pick, or its kind default while
  // unset — the same fallback the icon uses, so the picker highlights that
  // swatch. Editing here mirrors the create form: a pick persists immediately.
  const effectiveColor = account.color ?? defaultAccountColor[account.kind];

  return (
    <Box gap={4}>
      {/* The same shared icon+name identity block the holding-detail header and
          the create forms use — a fixed-height icon chip beside a labelled name
          field, so the account and holding sides present one identical control
          rather than a bespoke input here. */}
      <HoldingIdentityField
        icon={account.icon}
        fallbackIcon={KIND_ICON[account.kind]}
        iconColor={effectiveColor}
        name={name}
        onChangeName={setName}
        onSelectIcon={(icon) => accountsRepo.setIcon(account.id, icon)}
        onRemoveIcon={() => accountsRepo.setIcon(account.id, null)}
        nameAccessibilityLabel={`${account.name} name`}
        onEndEditingName={commitName}
      />

      <ColorPicker
        label="Color"
        value={effectiveColor}
        onSelect={(color) => accountsRepo.update(account.id, { color })}
      />
    </Box>
  );
};

type AccountDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountDetail'>;

const AccountDetailScreen: FC<AccountDetailScreenProps> = ({ route, navigation }) => {
  const { accountId } = route.params;
  const { theme } = useUnistyles();
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(accountId), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.listByAccountQuery(accountId), ['holdings']);
  const { data: connectedAccounts } = useLiveQuery(accountsRepo.connectedQuery(), ['accounts']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const account = accounts.at(0);

  // The stack sets no static title for this screen, so drive the header title
  // from the account's own name once it loads — otherwise the header falls
  // back to the raw "AccountDetail" route name. Skip until the name is known
  // so the header never flashes an empty title.
  const accountName = account?.name;
  useLayoutEffect(() => {
    if (accountName !== undefined) {
      navigation.setOptions({ title: accountName });
    }
  }, [navigation, accountName]);

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
  const isBankAccount = account?.kind === 'bank';
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
        setTokenMessage(NO_TOKEN_MESSAGE);
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
      Alert.alert('Could not disconnect', 'Please try again.');
    }
  };

  const confirmDisconnect = (): void => {
    Alert.alert(
      'Disconnect Monobank',
      'This clears the connection and the stored token. Your holdings and transactions stay as a manual snapshot.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
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
      footer={
        <Button
          variant="primary"
          fullWidth
          onPress={() => navigation.navigate('HoldingForm', { accountId })}
        >
          Add holding
        </Button>
      }
    >
      <Box gap={4}>
        {account && <AccountMetadataHeader account={account} />}

        <Box gap={1} style={styles.balanceBlock}>
          <Text variant="heading">Balance</Text>
          <MoneyText money={overallBalance} context="balance" style={styles.balance} />
          <Box style={styles.breakdown}>
            <CurrencyBreakdown items={breakdown} />
          </Box>
        </Box>

        {showActionButton && <Box style={styles.divider} />}

        {showActionButton && <MonobankTokenField isConnected={isConnectedToMonobank} />}

        {showActionButton && (
          <Box direction="row" gap={2} style={styles.statusLine}>
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
            {isConnectedToMonobank && (
              <Box direction="row" gap={2} style={styles.statusLine}>
                <SymbolIcon name="clock" tone="textSecondary" />
                <Text variant="body" tone="textSecondary">
                  Last sync: {formatLastSyncAt(settingsRows.at(0)?.lastSyncAt ?? null)}
                </Text>
              </Box>
            )}
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
            Disconnect Monobank
          </Button>
        )}

        {showConnectedElsewhereHint && (
          <Text variant="caption" tone="textSecondary">
            Monobank is connected to another account
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
          <Text variant="heading">Holdings</Text>

          {/* A drag-and-drop 2-column grid of square holding cards. A plain tap
              opens the holding; a touch-and-hold on a manual card opens the
              native context menu (Delete); a hold-and-move drags to reorder —
              see `CardContextMenu` and `onGridDragEnd`. `sortEnabled` is off with
              a single holding, where there is nothing to reorder. */}
          <Box testID="holdings-grid">
            <Sortable.Grid
              data={activeHoldings}
              sortEnabled={activeHoldings.length > 1}
              columns={2}
              rowGap={theme.spacing(3)}
              columnGap={theme.spacing(3)}
              keyExtractor={(holding) => holding.id}
              renderItem={({ item }) => (
                <Box testID="holding-grid-item">
                  <CardContextMenu
                    name={item.name}
                    deletable={!isSyncedHolding(item)}
                    onDelete={() => holdingsRepo.remove(item.id)}
                  >
                    <HoldingCard
                      holding={item}
                      now={now}
                      onOpen={() => navigation.navigate('HoldingDetail', { holdingId: item.id })}
                    />
                  </CardContextMenu>
                </Box>
              )}
              onDragEnd={({ key, fromIndex, toIndex, indexToKey }) =>
                onGridDragEnd({ key, fromIndex, toIndex, indexToKey }, holdingsRepo.reorder)
              }
            />
          </Box>
        </Box>
      </Box>
    </Screen>
  );
};

export default AccountDetailScreen;
