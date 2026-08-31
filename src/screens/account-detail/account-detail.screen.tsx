import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useState } from 'react';
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
  const account = accounts.at(0);

  const activeHoldings = holdings.filter(holding => holding.closedAt == null);
  const isBankAccount = account?.kind === 'bank';
  const isConnectedToMonobank = account?.institution === 'monobank';

  const { isSyncing, error, sync } = useSync();
  const [tokenMessage, setTokenMessage] = useState<string | undefined>();

  // Connect (mark institution + first import) and Sync now (re-import) are the
  // same action against a bank account; only the label differs. Guard on a
  // stored token first so a missing token points the user at Settings instead
  // of surfacing an opaque sync failure.
  const handlePress = async (): Promise<void> => {
    setTokenMessage(undefined);
    if ((await readToken()) === undefined) {
      setTokenMessage(NO_TOKEN_MESSAGE);
      return;
    }
    await sync(accountId);
  };

  const actionLabel = !isConnectedToMonobank
    ? 'Connect Monobank'
    : isSyncing
      ? 'Syncing…'
      : 'Sync now';

  return (
    <Screen>
      <Box gap={4}>
        <Text variant="title" tone="textPrimary">
          {account?.name ?? ''}
        </Text>

        {isBankAccount && (
          <PressableButton
            onPress={() => void handlePress()}
            disabled={isSyncing}
            backgroundColor={theme.colors.accent}
            alignSelf="flex-start"
          >
            <Text variant="body">{actionLabel}</Text>
          </PressableButton>
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
