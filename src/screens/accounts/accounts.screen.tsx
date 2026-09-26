import { type FC, useMemo } from 'react';
import { ratesRepo } from '@kiko/rates/repo';
import Sortable from 'react-native-sortables';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { useUnistyles } from 'react-native-unistyles';
import { useDataReady, useLiveQuery } from '@kiko/db';
import { Pressable, type ScrollViewInstance } from 'react-native';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useScrollToTopOnTabPress } from '@kiko/navigation/use-scroll-to-top-on-tab-press';

import Box from '../../design-system/components/box';
import Card from '../../design-system/components/card';
import Text from '../../design-system/components/text';
import type { Currency } from '../../currency/currency';
import { usePriceBook } from '../../prices/use-price-book';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import { isSyncedAccount } from '../../holdings/deletable';
import { needsPriceBook } from '../../holdings/priced-value';
import Divider from '../../design-system/components/divider';
import MoneyText from '../../design-system/components/money-text';
import { accountKindSymbol } from '../../holdings/entity-symbols';
import { defaultAccountColor } from '../../holdings/entity-colors';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { onGridDragEnd } from '../../design-system/grid-interaction';
import type { AccountsStackParamList } from '../../navigation/types';
import LoadingState from '../../design-system/components/loading-state';
import EntityIconTile from '../../design-system/components/entity-icon-tile';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import CardContextMenu from '../../design-system/components/card-context-menu';
import { useFocusRefreshedNow } from '../../design-system/use-focus-refreshed-now/use-focus-refreshed-now';

import { styles } from './accounts.styles';

type AccountsScreenProps = NativeStackScreenProps<AccountsStackParamList, 'Accounts'>;

const AccountsScreen: FC<AccountsScreenProps> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const {
    data: accounts,
    isLoading: accountsLoading,
    isFresh: accountsFresh,
  } = useLiveQuery(accountsRepo.listQuery(), ['accounts'], true, { cached: true });
  const { data: holdings, isLoading: holdingsLoading } = useLiveQuery(
    holdingsRepo.allQuery(),
    ['holdings'],
    true,
    { cached: true },
  );
  const { data: rates, isLoading: ratesLoading } = useLiveQuery(
    ratesRepo.allQuery(),
    ['currency_rates'],
    true,
    { cached: true },
  );
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    { cached: true },
  );
  // kiko-architecture: skip the price_points read while nothing rendered on
  // this screen ever reads it — a holding whose type carries no priced spec
  // and is not a loan (`needsPriceBook`) never touches `price_points`. It
  // stays enabled while holdings are still on their first load, so the two
  // reads run in parallel instead of price_points waiting on holdings. Only a
  // loan reads the linked-payments half of the book.
  const { book: priceBook, isLoading: priceBookLoading } = usePriceBook(
    holdingsLoading || holdings.some((holding) => needsPriceBook(holding.type)),
    { cached: true },
    holdingsLoading || holdings.some((holding) => holding.type === 'loan'),
  );
  // The empty-accounts text must never render while any of this screen's own
  // queries is still on its first load (kiko-architecture's useLiveQuery
  // consumer rule) — gated below, right at the return.
  const isReady = useDataReady(
    accountsLoading,
    holdingsLoading,
    ratesLoading,
    settingsLoading,
    priceBookLoading,
  );

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = useMemo(() => buildRateTable(rates), [rates]);
  // Stable across a re-render, refreshed only on focus — a bare `Date.now()`
  // here recomputed `debtsTotal`'s (and every card's) time-dependent value on
  // EVERY render, not just when the screen actually regains focus.
  const now = useFocusRefreshedNow();

  // The grid renders in the query's `sortOrder` order (the drag-and-drop order),
  // filtered to the non-archived accounts.
  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.archivedAt == null),
    [accounts],
  );

  // A property or debt account gets its OWN section, in its own
  // drag-and-drop grid below the main one — never mixed into it, so a drag
  // reorder in any grid can only ever reorder within that same section
  // (`Sortable.Grid`'s `data` is scoped per grid). All three stay in the
  // query's `sortOrder` order, same as the single grid did before this
  // split. One partition pass over `activeAccounts` rather than three
  // separate filters.
  const { mainAccounts, propertyAccounts, debtAccounts } = useMemo(() => {
    const main: typeof activeAccounts = [];
    const property: typeof activeAccounts = [];
    const debt: typeof activeAccounts = [];

    for (const account of activeAccounts) {
      if (account.kind === 'debt') {
        debt.push(account);
      } else if (account.kind === 'property') {
        property.push(account);
      } else {
        main.push(account);
      }
    }

    return { mainAccounts: main, propertyAccounts: property, debtAccounts: debt };
  }, [activeAccounts]);

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

  // The Property section shows a SECTION total, the same "sum every member
  // account's holdings through guardedNetWorth" pattern the Debts section
  // below uses. Every property-kind account holds only `property_item`
  // holdings (`holdingTypesForAccountKind`), so this total is always the sum
  // the section's own cards already individually show.
  const propertyTotal = useMemo(
    () =>
      guardedNetWorth(
        propertyAccounts.flatMap((account) => holdingsByAccount.get(account.id) ?? []),
        baseCurrency,
        rateTable,
        now,
        priceBook,
      ),
    [propertyAccounts, holdingsByAccount, baseCurrency, rateTable, now, priceBook],
  );

  // The Debts section shows a SECTION total
  // (negative), not just each card's own balance. Every debt-kind account holds
  // only `loan` holdings (`holdingTypesForAccountKind`), so summing them all
  // through `guardedNetWorth` gives the same negative total the section's
  // cards already individually show, added together.
  const debtsTotal = useMemo(
    () =>
      guardedNetWorth(
        debtAccounts.flatMap((account) => holdingsByAccount.get(account.id) ?? []),
        baseCurrency,
        rateTable,
        now,
        priceBook,
      ),
    [debtAccounts, holdingsByAccount, baseCurrency, rateTable, now, priceBook],
  );

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

  // A single-column drag-and-drop grid of wide account cards, shared by the
  // main grid and the Debts grid below — the two differ only in which
  // accounts they list and how a reorder is persisted (see the main grid's
  // own `persistOrder` comment below for why).
  const renderGrid = (
    data: typeof activeAccounts,
    persistOrder: (orderedIds: string[]) => void,
  ) => (
    <Sortable.Grid
      data={data}
      // A drag persists the WHOLE account order from the rows on screen, so it
      // never starts from the cached (possibly one-read-old) order — only
      // once the accounts query's own fresh read has applied
      // (kiko-architecture).
      sortEnabled={accountsFresh && data.length > 1}
      // A subtle lift on touch-and-hold: the library default (1.1) pops the
      // card up too much, so scale it just barely (see the account-detail
      // grid, which uses the same value).
      activeItemScale={1.03}
      columns={1}
      // Keep a dragged card on its vertical axis — a single column has no
      // horizontal move to make, so the library default ('both') only lets a
      // card wander sideways off the list.
      overDrag="vertical"
      rowGap={theme.spacing(4)}
      scrollableRef={scrollableRef}
      autoScrollActivationOffset={75}
      keyExtractor={(account) => account.id}
      renderItem={({ item }) => renderAccountCard(item)}
      onDragEnd={({ fromIndex, toIndex, indexToKey }) =>
        onGridDragEnd({ fromIndex, toIndex, indexToKey }, persistOrder)
      }
    />
  );

  if (!isReady) {
    return (
      <Screen scroll scrollableRef={scrollableRef}>
        <LoadingState testID="accounts-loading" />
      </Screen>
    );
  }

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
              // parent list.
              // `accountsRepo.reorder` rewrites `sortOrder`
              // for ONLY the ids it is given. Persisting just this grid's own
              // reordered ids would restart every section at 0, so a later
              // read of the FULL account list (Statistics' account filter,
              // the transaction-form account rank, Home, statement import —
              // every other `listQuery` consumer) interleaves the sections
              // instead of keeping assets first, then property, then debts.
              // Always persist the WHOLE order: this grid's new order, then
              // every property and debt account's id unchanged.
              <Box testID="accounts-grid">
                {renderGrid(mainAccounts, (ids) =>
                  accountsRepo.reorder([
                    ...ids,
                    ...propertyAccounts.map((account) => account.id),
                    ...debtAccounts.map((account) => account.id),
                  ]),
                )}
              </Box>
            )}

            {propertyAccounts.length > 0 && (
              // The "Property" section — its own heading + its
              // own grid, so a drag reorder here can never move a property
              // account into the main grid above (or vice versa). Rendered
              // only when the user actually has a property account
              // (data-driven, not a build flag — Guideline 5.6).
              <>
                {mainAccounts.length > 0 && <Divider spacing={2} />}
                <Box gap={3}>
                  <Box direction="row" style={styles.sectionHeadingRow}>
                    <Text variant="heading">{t('accounts.propertySection')}</Text>
                    <Box testID="accounts-property-total">
                      <MoneyText money={propertyTotal} context="balance" />
                    </Box>
                  </Box>
                  <Box testID="accounts-property-grid">
                    {/* Mirrors the main grid's persist-order fix above. */}
                    {renderGrid(propertyAccounts, (ids) =>
                      accountsRepo.reorder([
                        ...mainAccounts.map((account) => account.id),
                        ...ids,
                        ...debtAccounts.map((account) => account.id),
                      ]),
                    )}
                  </Box>
                </Box>
              </>
            )}

            {debtAccounts.length > 0 && (
              // The "Debts" section — its own heading + its
              // own grid, so a drag reorder here can never move a debt account
              // into the main grid above (or vice versa). Rendered only when
              // the user actually has a debt account (data-driven, not a
              // build flag — Guideline 5.6).
              <>
                {(mainAccounts.length > 0 || propertyAccounts.length > 0) && (
                  <Divider spacing={2} />
                )}
                <Box gap={3}>
                  <Box direction="row" style={styles.sectionHeadingRow}>
                    <Text variant="heading">{t('accounts.debtsSection')}</Text>
                    <Box testID="accounts-debts-total">
                      <MoneyText money={debtsTotal} context="balance" />
                    </Box>
                  </Box>
                  <Box testID="accounts-debts-grid">
                    {/* Mirrors the main grid's persist-order fix above. */}
                    {renderGrid(debtAccounts, (ids) =>
                      accountsRepo.reorder([
                        ...mainAccounts.map((account) => account.id),
                        ...propertyAccounts.map((account) => account.id),
                        ...ids,
                      ]),
                    )}
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
