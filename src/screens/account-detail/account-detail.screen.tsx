import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import type { AccountRow, HoldingRow } from '../../db/schema';
import { formatDateTime } from '../../dates/format';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import CurrencyBreakdown from '../../design-system/components/currency-breakdown';
import ListRow from '../../design-system/components/list-row';
import MoneyText from '../../design-system/components/money-text';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import SwipeableRow from '../../design-system/components/swipeable-row';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import { isSyncedHolding } from '../../holdings/deletable';
import { holdingTypeIcon } from '../../holdings/holding-icon';
import { holdingValue } from '../../holdings/holding-value';
import { disconnectMonobank } from '../../monobank/disconnect';
import { readToken } from '../../monobank/token';
import type { AccountsStackParamList } from '../../navigation/types';
import { sumByCurrency } from '../../rates/currency-totals';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import IconEditor from '../icon-editor';
import { useSync } from '../use-sync';
import { KIND_ICON } from '../accounts/accounts.screen';
import { styles } from './account-detail.styles';
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

// One holding row: display-only and tappable to open the holding. The holding's
// name and icon are now edited on HoldingDetail (not inline here), so the row
// shows the icon (custom, or the type-default fallback) beside the name and the
// balance — pressing anywhere opens the detail page. The row renders the
// holding's COMPUTED value as of `now` (deposits/bonds accrue over time and
// carry a stored balance of 0), matching the headline and holding-detail.
const HoldingListRow: FC<{ holding: HoldingRow; now: number; onOpen: () => void }> = ({
  holding,
  now,
  onOpen,
}) => {
  return (
    <ListRow onPress={onOpen}>
      <Box direction="row" gap={3} style={styles.holdingLead}>
        <SymbolIcon
          name={holding.icon ?? holdingTypeIcon[holding.type]}
          accessibilityLabel={`${holding.name} icon`}
        />

        <Text variant="body">{holding.name}</Text>
      </Box>
      <Box
        direction="row"
        gap={2}
        style={styles.statusLine}
        testID={`holding-balance-${holding.id}`}
      >
        <MoneyText money={holdingValue(holding, now)} />
      </Box>
    </ListRow>
  );
};

// The account's own metadata, edited here rather than on the tiny accounts-list
// row: the icon opens the shared picker (with remove-to-default) under one
// labelled "Icon" block reused from the create form, and the name is a proper
// labelled field. Local name state seeds from the account so keystrokes show
// immediately while the persisted value flows back through the live query; the
// rename commits once on end-of-editing (return-key submit or blur) via the
// generic accountsRepo.update, and an empty or unchanged name is never written.
const AccountMetadataHeader: FC<{ account: AccountRow }> = ({ account }) => {
  const { theme } = useUnistyles();
  const [name, setName] = useState(account.name);

  const commitName = (): void => {
    const trimmed = name.trim();

    if (trimmed !== '' && trimmed !== account.name) {
      accountsRepo.update(account.id, { name: trimmed });
    }
  };

  return (
    <Box direction="row" gap={3} style={styles.metadataHeader}>
      <IconEditor
        label="Icon"
        icon={account.icon}
        fallbackIcon={KIND_ICON[account.kind]}
        onSelect={(icon) => accountsRepo.setIcon(account.id, icon)}
        onRemove={() => accountsRepo.setIcon(account.id, null)}
      />

      <Box gap={1} style={styles.metadataNameBlock}>
        <Text variant="caption" tone="textSecondary">
          Name
        </Text>

        <TextInput
          accessibilityLabel={`${account.name} name`}
          value={name}
          onChangeText={setName}
          onEndEditing={commitName}
          placeholderTextColor={theme.colors.textSecondary}
          style={styles.nameField}
        />
      </Box>
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
            <PressableButton
              onPress={() => {
                handlePress();
              }}
              disabled={isSyncing}
              backgroundColor={theme.colors.accent}
              alignSelf="flex-start"
              icon={<SymbolIcon name={actionIcon} tone="textPrimary" />}
              label={actionLabel}
            />
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
          <PressableButton
            onPress={confirmDisconnect}
            backgroundColor={theme.colors.surfaceHigh}
            alignSelf="flex-start"
            icon={<SymbolIcon name="link.badge.plus" tone="textPrimary" />}
            label="Disconnect Monobank"
          />
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
          {activeHoldings.map((holding) => (
            <SwipeableRow
              key={holding.id}
              radius={theme.radii.sm}
              disabled={isSyncedHolding(holding)}
              onDelete={() => holdingsRepo.remove(holding.id)}
            >
              <HoldingListRow
                holding={holding}
                now={now}
                onOpen={() => navigation.navigate('HoldingDetail', { holdingId: holding.id })}
              />
            </SwipeableRow>
          ))}
        </Box>
      </Box>
    </Screen>
  );
};

export default AccountDetailScreen;
