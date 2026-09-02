import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import type { HoldingRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import CurrencyBreakdown from '../../design-system/components/currency-breakdown';
import ListRow from '../../design-system/components/list-row';
import MoneyText from '../../design-system/components/money-text';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import { readToken } from '../../monobank/token';
import type { AccountsStackParamList } from '../../navigation/types';
import { sumByCurrency } from '../../rates/currency-totals';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { useSync } from '../use-sync';
import { styles } from './account-detail.styles';
import MonobankTokenField from './monobank-token-field.component';

// The token input now lives on this screen, so a missing token points the user
// up to that field rather than off to global Settings.
const NO_TOKEN_MESSAGE = 'Add your Monobank token above before connecting.';

const formatLastSyncAt = (lastSyncAt: number | null): string =>
  lastSyncAt === null ? 'Never' : new Date(lastSyncAt).toLocaleString();

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

// One holding row: opens the holding on press, and renames its title inline
// through a tap-to-edit affordance. Mirrors the categories rename pattern — a
// pencil control reveals an inline field committed on end-of-editing, and an
// empty (or unchanged) name is never written. Local title state seeds from the
// row so keystrokes show immediately, while the persisted value flows back
// through the live query.
const HoldingListRow: FC<{ holding: HoldingRow; onOpen: () => void }> = ({ holding, onOpen }) => {
  const { theme } = useUnistyles();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(holding.name);

  const commitName = (): void => {
    const trimmed = name.trim();
    setIsEditing(false);

    if (trimmed !== '' && trimmed !== holding.name) {
      holdingsRepo.updateName(holding.id, trimmed);
    }
  };

  return (
    <ListRow
      onPress={() => {
        if (!isEditing) {
          onOpen();
        }
      }}
    >
      {isEditing ? (
        <TextInput
          accessibilityLabel={`${holding.name} title`}
          value={name}
          onChangeText={setName}
          // Commit once on end-of-editing only (return-key submit or blur), so a
          // rename that loses focus still saves without double-writing.
          onEndEditing={commitName}
          autoFocus
          placeholderTextColor={theme.colors.textSecondary}
          style={styles.textField}
        />
      ) : (
        <Text variant="body">{holding.name}</Text>
      )}
      <Box direction="row" gap={2} style={styles.statusLine}>
        <MoneyText money={Money.of(holding.currency, holding.balanceMinorUnits)} />
        {!isEditing && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${holding.name} title`}
            onPress={() => setIsEditing(true)}
            style={styles.iconButton}
          >
            <SymbolIcon name="pencil" tone="textSecondary" />
          </Pressable>
        )}
      </Box>
    </ListRow>
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
  const overallBalance = guardedNetWorth(activeHoldings, baseCurrency, rateTable);
  const breakdown = sumByCurrency(activeHoldings);
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
    <Screen scroll>
      <Box gap={4}>
        <Box gap={1}>
          <Text variant="heading">Balance</Text>
          <MoneyText money={overallBalance} context="balance" style={styles.balance} />
          <CurrencyBreakdown items={breakdown} />
        </Box>

        {showActionButton && <Box style={styles.divider} />}

        {showActionButton && <MonobankTokenField />}

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
            >
              <Text variant="body">{actionLabel}</Text>
            </PressableButton>
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

        <Box gap={2}>
          <Text variant="heading">Holdings</Text>
          {activeHoldings.map((holding) => (
            <HoldingListRow
              key={holding.id}
              holding={holding}
              onOpen={() => navigation.navigate('HoldingDetail', { holdingId: holding.id })}
            />
          ))}
        </Box>

        <PressableButton
          onPress={() => navigation.navigate('HoldingForm', { accountId })}
          backgroundColor={theme.colors.accent}
          alignSelf="flex-start"
          icon={<SymbolIcon name="plus" tone="textPrimary" />}
        >
          <Text variant="body">Add holding</Text>
        </PressableButton>
      </Box>
    </Screen>
  );
};

export default AccountDetailScreen;
