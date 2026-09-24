import { type FC, useMemo } from 'react';
import { ratesRepo } from '@kiko/rates/repo';
import Sortable from 'react-native-sortables';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { useUnistyles } from 'react-native-unistyles';
import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { Pressable, type ScrollViewInstance } from 'react-native';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import Box from '../../design-system/components/box';
import Card from '../../design-system/components/card';
import { useLiveQuery } from '../../db/use-live-query';
import Text from '../../design-system/components/text';
import type { Currency } from '../../currency/currency';
import { usePriceBook } from '../../prices/use-price-book';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import { isSyncedAccount } from '../../holdings/deletable';
import MoneyText from '../../design-system/components/money-text';
import { accountKindSymbol } from '../../holdings/entity-symbols';
import { defaultAccountColor } from '../../holdings/entity-colors';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { onGridDragEnd } from '../../design-system/grid-interaction';
import type { AccountsStackParamList } from '../../navigation/types';
import EntityIconTile from '../../design-system/components/entity-icon-tile';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import CardContextMenu from '../../design-system/components/card-context-menu';
import { useScrollToTopOnTabPress } from '../../navigation/use-scroll-to-top-on-tab-press';

import { styles } from './accounts.styles';

type AccountsScreenProps = NativeStackScreenProps<AccountsStackParamList, 'Accounts'>;

const AccountsScreen: FC<AccountsScreenProps> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const priceBook = usePriceBook();

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = useMemo(() => buildRateTable(rates), [rates]);
  const now = Date.now();

  // The grid renders in the query's `sortOrder` order (the drag-and-drop order),
  // filtered to the non-archived accounts.
  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.archivedAt == null),
    [accounts],
  );

  // T27 (spec §5.3): a debt account gets its OWN "Debts" section, in its own
  // drag-and-drop grid below the main one — never mixed into it, so a drag
  // reorder in either grid can only ever reorder within that same section
  // (`Sortable.Grid`'s `data` is scoped per grid). Both stay in the query's
  // `sortOrder` order, same as the single grid did before this split.
  const mainAccounts = useMemo(
    () => activeAccounts.filter((account) => account.kind !== 'debt'),
    [activeAccounts],
  );
  const debtAccounts = useMemo(
    () => activeAccounts.filter((account) => account.kind === 'debt'),
    [activeAccounts],
  );

  // Group every open holding by its account id in ONE O(H) pass, so each card
  // indexes into this map instead of re-filtering all holdings per card — the
  // per-card `holdings.filter` was O(A×H) on every render and re-ran on every
  // reactive fire during a sync. A closed holding is excluded here exactly as
  // the per-card filter did, and each account's holdings keep the query's order.
  const holdingsByAccount = useMemo(() => {
    const byAccount = new Map<string, typeof holdings>();

    for (const holding of holdings) {
      if (holding.closedAt != null) {
        continue;
      }

      const existing = byAccount.get(holding.accountId);

      if (existing) {
        existing.push(holding);
      } else {
        byAccount.set(holding.accountId, [holding]);
      }
    }

    return byAccount;
  }, [holdings]);

  // The parent ScrollView's animated ref, shared with the sortable grid so a
  // drag near the top/bottom edge auto-scrolls the list (the grid is nested
  // inside this Screen's ScrollView, so it cannot scroll it without the ref).
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();

  // Re-tapping the Accounts tab while already on it returns this scrolling list
  // to the top (the standard iOS active-tab re-tap), driven off the native tab
  // navigator's `tabPress`. It reuses the same ScrollView ref the grid holds.
  // The live `contentOffset.y`, so the hook can skip a redundant scroll.
  const scrollOffset = useScrollOffset(scrollableRef);
  useScrollToTopOnTabPress(scrollableRef, scrollOffset);

  // One account card, shared by the main grid and the Debts grid below — a
  // debt account's balance reads negative through the SAME `MoneyText`
  // rendering every other account uses (`holding-value.ts` already values a
  // `loan` holding at minus its outstanding balance, so nothing here needs to
  // know it is rendering a debt specifically).
  const renderAccountCard = (item: (typeof activeAccounts)[number]) => {
    const accountHoldings = holdingsByAccount.get(item.id) ?? [];
    const balance = guardedNetWorth(accountHoldings, baseCurrency, rateTable, now, priceBook);
    const color = resolveEntityColor(item.color, defaultAccountColor[item.kind]);

    return (
      <CardContextMenu
        name={item.name}
        deletable={!isSyncedAccount(item)}
        onDelete={() => accountsRepo.remove(item.id)}
      >
        <Card
          testID="account-card"
          padding={4}
          // The card itself is the shared solid content-layer
          // surface — the entity color lives on the icon tile (see
          // `EntityIconTile`) instead of the whole card.
        >
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('AccountDetail', { accountId: item.id, name: item.name })
            }
            style={styles.row}
          >
            <Box direction="row" gap={3} style={styles.rowLead}>
              <EntityIconTile
                name={item.icon ?? accountKindSymbol[item.kind]}
                color={color}
                accessibilityLabel={t('accounts.icon', { name: item.name })}
              />
              <Box gap={1}>
                <Text variant="body">{item.name}</Text>
                <Text variant="caption" tone="textSecondary">
                  {t(`forms.account.${item.kind}`)}
                </Text>
              </Box>
            </Box>
            <MoneyText money={balance} context="balance" />
          </Pressable>
        </Card>
      </CardContextMenu>
    );
  };

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      footer={
        <Box testID="add-account-footer" style={styles.addAccountButton}>
          <Button
            variant="primary"
            fullWidth
            onPress={() => navigation.navigate('AccountForm', {})}
          >
            {t('accounts.addAccount')}
          </Button>
        </Box>
      }
    >
      <Box gap={4} style={styles.content}>
        {activeAccounts.length === 0 ? (
          <Box style={styles.empty}>
            <Text tone="textSecondary">{t('accounts.emptyState')}</Text>
          </Box>
        ) : (
          <>
            {mainAccounts.length > 0 && (
              // A single-column drag-and-drop grid of the existing wide account
              // cards. A plain tap opens the account; a touch-and-hold-still on a
              // manual card opens the deep-press (haptic) delete menu; a hold-and-move
              // drags to reorder — see `CardContextMenu` and `onGridDragEnd`. `scrollableRef`
              // + `autoScrollActivationOffset` let a drag near an edge scroll the
              // parent list (F9).
              <Box testID="accounts-grid">
                <Sortable.Grid
                  data={mainAccounts}
                  sortEnabled={mainAccounts.length > 1}
                  // A subtle lift on touch-and-hold: the library default (1.1) pops
                  // the card up too much, so scale it just barely (see the account-
                  // detail grid, which uses the same value).
                  activeItemScale={1.03}
                  columns={1}
                  // Keep a dragged card on its vertical axis — a single column has no
                  // horizontal move to make, so the library default ('both') only lets
                  // a card wander sideways off the list.
                  overDrag="vertical"
                  rowGap={theme.spacing(4)}
                  scrollableRef={scrollableRef}
                  autoScrollActivationOffset={75}
                  keyExtractor={(account) => account.id}
                  renderItem={({ item }) => renderAccountCard(item)}
                  onDragEnd={({ fromIndex, toIndex, indexToKey }) =>
                    onGridDragEnd({ fromIndex, toIndex, indexToKey }, accountsRepo.reorder)
                  }
                />
              </Box>
            )}

            {debtAccounts.length > 0 && (
              // T27 (spec §5.3): the "Debts" section — its own heading + its
              // own grid, so a drag reorder here can never move a debt account
              // into the main grid above (or vice versa). Rendered only when
              // the user actually has a debt account (data-driven, not a
              // build flag — Guideline 5.6).
              <>
                {mainAccounts.length > 0 && <Box style={styles.divider} />}
                <Box gap={3}>
                  <Text variant="heading">{t('accounts.debtsSection')}</Text>
                  <Box testID="accounts-debts-grid">
                    <Sortable.Grid
                      data={debtAccounts}
                      sortEnabled={debtAccounts.length > 1}
                      activeItemScale={1.03}
                      columns={1}
                      overDrag="vertical"
                      rowGap={theme.spacing(4)}
                      scrollableRef={scrollableRef}
                      autoScrollActivationOffset={75}
                      keyExtractor={(account) => account.id}
                      renderItem={({ item }) => renderAccountCard(item)}
                      onDragEnd={({ fromIndex, toIndex, indexToKey }) =>
                        onGridDragEnd({ fromIndex, toIndex, indexToKey }, accountsRepo.reorder)
                      }
                    />
                  </Box>
                </Box>
              </>
            )}
          </>
        )}
      </Box>
    </Screen>
  );
};

export default AccountsScreen;
