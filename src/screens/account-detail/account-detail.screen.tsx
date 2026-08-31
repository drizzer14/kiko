import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { Money } from '../../currency/money';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import ListRow from '../../design-system/components/list-row';
import MoneyText from '../../design-system/components/money-text';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import type { RootStackParamList } from '../../navigation/types';
import { holdingsRepo } from '../../repositories/holdings.repo';

type AccountDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'AccountDetail'>;

const AccountDetailScreen: FC<AccountDetailScreenProps> = ({ route, navigation }) => {
  const { accountId } = route.params;
  const { theme } = useUnistyles();
  const { data: holdings } = useLiveQuery(holdingsRepo.listByAccountQuery(accountId), ['holdings']);

  const activeHoldings = holdings.filter(holding => holding.closedAt == null);

  return (
    <Screen>
      <Box gap={4}>
        <Text variant="title">Account</Text>

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
