import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Money } from '../../currency/money';
import { useLiveQuery } from '../../db/use-live-query';
import { Box } from '../../design-system/components/box';
import { MoneyText } from '../../design-system/components/money-text';
import { Screen } from '../../design-system/components/screen';
import { Text } from '../../design-system/components/text';
import type { RootStackParamList } from '../../navigation/types';
import { holdingsRepo } from '../../repositories/holdings.repo';

type AccountDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'AccountDetail'>;

export const AccountDetailScreen: FC<AccountDetailScreenProps> = ({ route, navigation }) => {
  const { accountId } = route.params;
  const { theme } = useUnistyles();
  const { data: holdings } = useLiveQuery(holdingsRepo.listByAccountQuery(accountId), ['holdings']);

  return (
    <Screen>
      <Box gap={4}>
        <Text variant="title">Account</Text>

        <Box gap={2}>
          <Text variant="heading">Holdings</Text>
          {holdings.map(holding => (
            <Pressable
              key={holding.id}
              accessibilityRole="button"
              onPress={() => navigation.navigate('HoldingDetail', { holdingId: holding.id })}
              style={[styles.row, { backgroundColor: theme.colors.surface }]}
            >
              <Text variant="body">{holding.name}</Text>
              <MoneyText money={Money.of(holding.currency, holding.balanceMinorUnits)} />
            </Pressable>
          ))}
        </Box>

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('HoldingForm', { accountId })}
          style={[styles.button, { backgroundColor: theme.colors.accent, alignSelf: 'flex-start' }]}
        >
          <Text variant="body">Add holding</Text>
        </Pressable>
      </Box>
    </Screen>
  );
};

const styles = StyleSheet.create(theme => ({
  button: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
