import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { Pressable } from 'react-native';
import Sortable from 'react-native-sortables';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import type { AccountRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import GlassSurface from '../../design-system/components/glass-surface';
import MoneyText from '../../design-system/components/money-text';
import Screen from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import { isSyncedAccount } from '../../holdings/deletable';
import { defaultAccountColor } from '../../holdings/entity-colors';
import type { AccountsStackParamList } from '../../navigation/types';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { onGridDragEnd, showDeleteActionSheet } from '../grid-interaction';
import { styles } from './accounts.styles';

type AccountsScreenProps = NativeStackScreenProps<AccountsStackParamList, 'Accounts'>;

const KIND_LABEL: Record<AccountRow['kind'], string> = {
  bank: 'Bank',
  cash: 'Cash',
  crypto: 'Crypto',
};

// Leading SF Symbol per account kind, mirroring KIND_LABEL. Exported so the
// account-detail header reuses the same kind-default glyph without a second
// copy of the map drifting out of sync.
export const KIND_ICON: Record<AccountRow['kind'], string> = {
  bank: 'building.columns',
  cash: 'banknote',
  crypto: 'bitcoinsign.circle',
};

const AccountsScreen: FC<AccountsScreenProps> = ({ navigation }) => {
  const { theme } = useUnistyles();
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);
  const now = Date.now();

  // The grid renders in the query's `sortOrder` order (the drag-and-drop order),
  // filtered to the non-archived accounts.
  const activeAccounts = accounts.filter((account) => account.archivedAt == null);
  const accountsById = new Map(activeAccounts.map((account) => [account.id, account]));

  // Long-press-in-place on a card opens its delete menu — but only for a manual
  // account; a still-connected (Monobank) account must be disconnected from
  // account-detail first, so it offers no menu here.
  const openAccountMenu = (accountId: string): void => {
    const account = accountsById.get(accountId);
    if (account && !isSyncedAccount(account)) {
      showDeleteActionSheet(account.name, () => accountsRepo.remove(accountId));
    }
  };

  return (
    <Screen
      scroll
      footer={
        <Box testID="add-account-footer" style={styles.addAccountButton}>
          <Button
            variant="primary"
            fullWidth
            onPress={() => navigation.navigate('AccountForm', {})}
          >
            Add account
          </Button>
        </Box>
      }
    >
      <Box gap={4} style={styles.content}>
        {activeAccounts.length === 0 ? (
          <Box style={styles.empty}>
            <Text tone="textSecondary">No accounts yet</Text>
          </Box>
        ) : (
          // A single-column drag-and-drop grid of the existing wide account
          // cards. A plain tap opens the account; a long-press lifts a card to
          // drag (reorder), and a long-press released in place opens the delete
          // menu — see `onGridDragEnd`.
          <Box testID="accounts-grid">
            <Sortable.Grid
              data={activeAccounts}
              sortEnabled={activeAccounts.length > 1}
              columns={1}
              rowGap={theme.spacing(4)}
              keyExtractor={(account) => account.id}
              renderItem={({ item }) => {
                const accountHoldings = holdings.filter(
                  (holding) => holding.accountId === item.id && holding.closedAt == null,
                );
                const balance = guardedNetWorth(accountHoldings, baseCurrency, rateTable, now);

                return (
                  <GlassSurface testID="account-card" padding={4}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => navigation.navigate('AccountDetail', { accountId: item.id })}
                      style={styles.row}
                    >
                      <Box direction="row" gap={3} style={styles.rowLead}>
                        <SymbolIcon
                          name={item.icon ?? KIND_ICON[item.kind]}
                          color={item.color ?? defaultAccountColor[item.kind]}
                          accessibilityLabel={`${item.name} icon`}
                        />
                        <Box gap={1}>
                          <Text variant="body">{item.name}</Text>
                          <Text variant="caption" tone="textSecondary">
                            {KIND_LABEL[item.kind]}
                          </Text>
                        </Box>
                      </Box>
                      <MoneyText money={balance} context="balance" />
                    </Pressable>
                  </GlassSurface>
                );
              }}
              onDragEnd={({ key, fromIndex, toIndex, indexToKey }) =>
                onGridDragEnd(
                  { key, fromIndex, toIndex, indexToKey },
                  accountsRepo.reorder,
                  openAccountMenu,
                )
              }
            />
          </Box>
        )}
      </Box>
    </Screen>
  );
};

export default AccountsScreen;
