import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useRef, useState } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { Money } from '../../currency/money';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import ListRow from '../../design-system/components/list-row';
import MoneyText from '../../design-system/components/money-text';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import { readToken } from '../../monobank/token';
import type { AccountsStackParamList } from '../../navigation/types';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { useSync } from '../use-sync';

const NO_TOKEN_MESSAGE = 'Add your Monobank token in Settings before connecting.';

type AccountDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountDetail'>;

const AccountDetailScreen: FC<AccountDetailScreenProps> = ({ route, navigation }) => {
  const { accountId } = route.params;
  const { theme } = useUnistyles();
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(accountId), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.listByAccountQuery(accountId), ['holdings']);
  const { data: connectedAccounts } = useLiveQuery(accountsRepo.connectedQuery(), ['accounts']);
  const account = accounts.at(0);

  const activeHoldings = holdings.filter(holding => holding.closedAt == null);
  const isBankAccount = account?.kind === 'bank';
  const isConnectedToMonobank = account?.institution === 'monobank';
  // The single-connection invariant: another account already holds the one
  // Monobank connection, so this one may not connect a second.
  const otherAccountConnected = connectedAccounts.some(connected => connected.id !== accountId);

  const { isSyncing, error, sync } = useSync();
  const [tokenMessage, setTokenMessage] = useState<string | undefined>();
  // Guards a fast double-tap: the button is disabled only on `isSyncing`, which
  // is still false during the `readToken()` await below, so a second press
  // could fire `sync` again before the first resolves.
  const inFlight = useRef(false);

  // Connect (mark institution + first import) and Sync now (re-import) are the
  // same action against a bank account; only the label differs. Guard on a
  // stored token first so a missing token points the user at Settings instead
  // of surfacing an opaque sync failure.
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

  const actionLabel = !isConnectedToMonobank
    ? 'Connect Monobank'
    : isSyncing
      ? 'Syncing…'
      : 'Sync now';

  // Show the action button for the connected account (Sync now) or for an
  // unconnected bank account only while no OTHER account holds the connection.
  const showActionButton = isBankAccount && (isConnectedToMonobank || !otherAccountConnected);
  // A different account already owns the single Monobank connection.
  const showConnectedElsewhereHint =
    isBankAccount && !isConnectedToMonobank && otherAccountConnected;

  return (
    <Screen>
      <Box gap={4}>
        <Text variant="title" tone="textPrimary">
          {account?.name ?? ''}
        </Text>

        {showActionButton && (
          <PressableButton
            onPress={() => void handlePress()}
            disabled={isSyncing}
            backgroundColor={theme.colors.accent}
            alignSelf="flex-start"
          >
            <Text variant="body">{actionLabel}</Text>
          </PressableButton>
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

        <Box gap={2}>
          <Text variant="heading">Holdings</Text>
          {activeHoldings.map(holding => (
            <ListRow
              key={holding.id}
              onPress={() => navigation.navigate('HoldingDetail', { holdingId: holding.id })}
            >
              <Text variant="body">{holding.name}</Text>
              <MoneyText money={Money.of(holding.currency, holding.balanceMinorUnits)} />
            </ListRow>
          ))}
        </Box>

        <PressableButton
          onPress={() => navigation.navigate('HoldingForm', { accountId })}
          backgroundColor={theme.colors.accent}
          alignSelf="flex-start"
        >
          <Text variant="body">Add holding</Text>
        </PressableButton>
      </Box>
    </Screen>
  );
};

export default AccountDetailScreen;
