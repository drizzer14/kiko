import maybe, { foldMap } from 'fnts/maybe';
import { ratesRepo } from '@kiko/rates/repo';
import Sortable from 'react-native-sortables';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import { useIsFocused } from '@react-navigation/native';
import type { Currency } from '@kiko/currency/currency';
import { type FC, type ReactNode, useMemo } from 'react';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { needsPriceBook } from '@kiko/holdings/priced-value';
import Divider from '@kiko/design-system/components/divider';
import { Pressable, type ScrollViewInstance } from 'react-native';
import MoneyText from '@kiko/design-system/components/money-text';
import { accountIdentity } from '@kiko/holdings/account-identity';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import { onGridDragEnd } from '@kiko/design-system/grid-interaction';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import HoldingCard from '@kiko/design-system/components/holding-card';
import LoadingState from '@kiko/design-system/components/loading-state';
import { writeThenReplan } from '@kiko/reminders/use-reminder-scheduler';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { useCurrentPriceBook } from '@kiko/prices/use-current-price-book';
import { isSyncedAccount, isSyncedHolding } from '@kiko/holdings/deletable';
import { buildRateTable, guardedNetWorth } from '@kiko/rates/net-worth-view';
import EntityIconTile from '@kiko/design-system/components/entity-icon-tile';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';
import { useFocusRefreshedNow } from '@kiko/design-system/use-focus-refreshed-now';
import { type AccountRow, type HoldingRow, useDataReady, useLiveQuery } from '@kiko/db';
import { useScrollToTopOnTabPress } from '@kiko/navigation/use-scroll-to-top-on-tab-press';
import { useCloseHoldingAction } from '@kiko/design-system/components/close-holding-sheet';
import { isImplicitAccount, type ImplicitAccountKind } from '@kiko/holdings/implicit-account';

import { styles } from './accounts.styles';

type AccountsScreenProps = NativeStackScreenProps<AccountsStackParamList, 'Accounts'>;

const openHoldingsOf = (
  holdingsByAccount: Map<string, HoldingRow[]>,
  account: AccountRow | undefined,
): HoldingRow[] => foldMap(maybe(account), (found) => holdingsByAccount.get(found.id)) ?? [];

const AccountsScreen: FC<AccountsScreenProps> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  // Deliberately `paused` (not `enabled`) while another tab or an account's
  // own screens show: this screen stays mounted, so its subscriptions stay and
  // a write elsewhere only marks each query dirty — hiding Accounts costs no
  // read and no re-render, and returning to it runs one read per dirty query
  // (`enabled: false` would unsubscribe and drop every card to empty; see
  // kiko-architecture's `paused` vs `enabled`).
  const isFocused = useIsFocused();
  const liveOptions = { cached: true, paused: !isFocused } as const;
  const {
    data: accounts,
    isLoading: accountsLoading,
    isFresh: accountsFresh,
  } = useLiveQuery(accountsRepo.listQuery(), ['accounts'], true, liveOptions);
  const {
    data: holdings,
    isLoading: holdingsLoading,
    isFresh: holdingsFresh,
  } = useLiveQuery(holdingsRepo.allQuery(), ['holdings'], true, liveOptions);
  const { data: rates, isLoading: ratesLoading } = useLiveQuery(
    ratesRepo.allQuery(),
    ['currency_rates'],
    true,
    liveOptions,
  );
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    liveOptions,
  );
  // Stable across a re-render, refreshed only on focus — a bare `Date.now()`
  // here recomputed `debtsTotal`'s (and every card's) time-dependent value on
  // EVERY render, not just when the screen actually regains focus.
  const now = useFocusRefreshedNow();
  // kiko-architecture: skip the price_points read while nothing rendered on
  // this screen ever reads it — a holding whose type carries no priced spec
  // and is not a loan (`needsPriceBook`) never touches `price_points`. It
  // stays enabled while holdings are still on their first load, so the two
  // reads run in parallel instead of price_points waiting on holdings. Only a
  // loan reads the linked-payments half of the book. It reads the current
  // rows for the day of `now`, the instant this screen values at.
  const { book: priceBook, isLoading: priceBookLoading } = useCurrentPriceBook(
    holdingsLoading || holdings.some((holding) => needsPriceBook(holding.type)),
    liveOptions,
    holdingsLoading || holdings.some((holding) => holding.type === 'loan'),
    now,
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

  // The grid renders in the query's `sortOrder` order (the drag-and-drop order),
  // filtered to the non-archived accounts.
  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.archivedAt == null),
    [accounts],
  );

  // The live property and debt accounts are the implicit accounts: never a
  // card of their own, and no AccountDetail page. Each one's open holdings
  // are listed as cards in its own section, in its own drag-and-drop grid
  // below the main one — never mixed into it, so a drag reorder in any grid
  // can only ever reorder within that same section (`Sortable.Grid`'s `data`
  // is scoped per grid). One partition pass over `activeAccounts`.
  const { mainAccounts, implicitAccountByKind } = useMemo(() => {
    const main: typeof activeAccounts = [];
    const byKind: Partial<Record<ImplicitAccountKind, AccountRow>> = {};

    for (const account of activeAccounts) {
      if (isImplicitAccount(account)) {
        byKind[account.kind] = account;
      } else {
        main.push(account);
      }
    }

    return { mainAccounts: main, implicitAccountByKind: byKind };
  }, [activeAccounts]);
  const { property: propertyAccount, debt: debtAccount } = implicitAccountByKind;

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

  // A section's cards are the OPEN holdings of its implicit account, in the
  // query's order. A section whose account is missing or holds nothing open
  // is empty, and does not render.
  const propertyHoldings = useMemo(
    () => openHoldingsOf(holdingsByAccount, propertyAccount),
    [holdingsByAccount, propertyAccount],
  );
  const debtHoldings = useMemo(
    () => openHoldingsOf(holdingsByAccount, debtAccount),
    [holdingsByAccount, debtAccount],
  );

  // Each section shows a SECTION total: the sum of its own cards' values
  // through `guardedNetWorth`. A property section holds only `property_item`
  // holdings and the debts section only `loan` holdings
  // (`holdingTypesForAccountKind`), so the debts total is negative.
  const propertyTotal = useMemo(
    () => guardedNetWorth(propertyHoldings, baseCurrency, rateTable, now, priceBook),
    [propertyHoldings, baseCurrency, rateTable, now, priceBook],
  );
  const debtsTotal = useMemo(
    () => guardedNetWorth(debtHoldings, baseCurrency, rateTable, now, priceBook),
    [debtHoldings, baseCurrency, rateTable, now, priceBook],
  );

  // One close hook per implicit account: its sync check reads that account.
  // Each hook's own `closeSheet` must render, or "Close" in that section
  // opens nothing.
  const { closeActionFor: closePropertyActionFor, closeSheet: closePropertySheet } =
    useCloseHoldingAction(propertyAccount);
  const { closeActionFor: closeDebtActionFor, closeSheet: closeDebtSheet } =
    useCloseHoldingAction(debtAccount);

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

  // One card of the main grid. The implicit property and debt accounts never
  // render here: their holdings are the cards of their own sections below.
  const renderAccountCard = (item: (typeof activeAccounts)[number]) => {
    const accountHoldings = holdingsByAccount.get(item.id) ?? [];
    const balance = guardedNetWorth(accountHoldings, baseCurrency, rateTable, now, priceBook);
    const { icon, color } = accountIdentity(item);

    return (
      <CardContextMenu
        name={item.name}
        deletable={!isSyncedAccount(item)}
        // The delete takes the account's reminders with it; only a re-plan
        // takes their notifications off iOS.
        onDelete={() => writeThenReplan(() => accountsRepo.remove(item.id), t)}
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
                name={icon}
                color={color}
                accessibilityLabel={t('accounts.icon', { name: item.name })}
              />
              <Box gap={1} style={styles.rowDescription}>
                <Text variant="body">{item.name}</Text>
                <Text variant="caption" tone="textSecondary">
                  {t(`forms.account.${item.kind}`)}
                </Text>
              </Box>
            </Box>
            <Box style={styles.rowAmount}>
              <MoneyText money={balance} context="balance" />
            </Box>
          </Pressable>
        </Card>
      </CardContextMenu>
    );
  };

  // One Property or Debts section: its heading with the section total, then
  // a grid with one card per open holding of that implicit account. A drag
  // persists that account's open holdings only (`holdingsRepo.reorder`),
  // the account-detail contract. The grid is gated on the HOLDINGS query's
  // fresh read, since it persists the holdings on screen.
  const renderHoldingSection = ({
    account,
    sectionHoldings,
    total,
    heading,
    totalTestID,
    gridTestID,
    closeActionFor,
    showDivider,
  }: {
    account: AccountRow | undefined;
    sectionHoldings: HoldingRow[];
    total: ReturnType<typeof guardedNetWorth>;
    heading: ReactNode;
    totalTestID: string;
    gridTestID: string;
    closeActionFor: ReturnType<typeof useCloseHoldingAction>['closeActionFor'];
    showDivider: boolean;
  }) => (
    <>
      {showDivider && <Divider spacing={2} />}
      <Box gap={3}>
        <Box direction="row" style={styles.sectionHeadingRow}>
          {heading}
          <Box testID={totalTestID}>
            <MoneyText money={total} context="balance" />
          </Box>
        </Box>
        <Box testID={gridTestID}>
          <Sortable.Grid
            data={sectionHoldings}
            sortEnabled={holdingsFresh && sectionHoldings.length > 1}
            activeItemScale={1.03}
            columns={1}
            overDrag="vertical"
            rowGap={theme.spacing(4)}
            scrollableRef={scrollableRef}
            autoScrollActivationOffset={75}
            keyExtractor={(holding) => holding.id}
            renderItem={({ item }) => (
              <CardContextMenu
                name={item.name}
                deletable={!isSyncedHolding(item, account)}
                onDelete={() => holdingsRepo.remove(item.id)}
                closeAction={closeActionFor(item)}
              >
                <HoldingCard
                  holding={item}
                  now={now}
                  baseCurrency={baseCurrency}
                  rateTable={rateTable}
                  priceBook={priceBook}
                  onOpen={() =>
                    navigation.navigate('HoldingDetail', { holdingId: item.id, name: item.name })
                  }
                />
              </CardContextMenu>
            )}
            onDragEnd={({ fromIndex, toIndex, indexToKey }) =>
              onGridDragEnd({ fromIndex, toIndex, indexToKey }, holdingsRepo.reorder)
            }
          />
        </Box>
      </Box>
    </>
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
            onPress={() => navigation.navigate('AccountForm', {})}
            icon={genericEntitySymbol.account}
          >
            {t('accounts.addAccount')}
          </Button>
        </Box>
      }
    >
      <Box gap={4} style={styles.content}>
        {mainAccounts.length === 0 && propertyHoldings.length === 0 && debtHoldings.length === 0 ? (
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
              // the property and debt accounts' ids unchanged.
              <Box testID="accounts-grid">
                <Sortable.Grid
                  data={mainAccounts}
                  // A drag persists the WHOLE account order from the rows on screen, so it
                  // never starts from the cached (possibly one-read-old) order — only
                  // once the accounts query's own fresh read has applied
                  // (kiko-architecture).
                  sortEnabled={accountsFresh && mainAccounts.length > 1}
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
                    onGridDragEnd({ fromIndex, toIndex, indexToKey }, (ids) =>
                      accountsRepo.reorder([
                        ...ids,
                        ...[propertyAccount, debtAccount].flatMap((account) =>
                          account ? [account.id] : [],
                        ),
                      ]),
                    )
                  }
                />
              </Box>
            )}

            {/* The "Property" and "Debts" sections render from data (a
                non-empty holding list), never a build flag (Guideline 5.6). */}
            {propertyHoldings.length > 0 &&
              renderHoldingSection({
                account: propertyAccount,
                sectionHoldings: propertyHoldings,
                total: propertyTotal,
                heading: <Text variant="heading">{t('accounts.propertySection')}</Text>,
                totalTestID: 'accounts-property-total',
                gridTestID: 'accounts-property-grid',
                closeActionFor: closePropertyActionFor,
                showDivider: mainAccounts.length > 0,
              })}

            {debtHoldings.length > 0 &&
              renderHoldingSection({
                account: debtAccount,
                sectionHoldings: debtHoldings,
                total: debtsTotal,
                heading: <Text variant="heading">{t('accounts.debtsSection')}</Text>,
                totalTestID: 'accounts-debts-total',
                gridTestID: 'accounts-debts-grid',
                closeActionFor: closeDebtActionFor,
                showDivider: mainAccounts.length > 0 || propertyHoldings.length > 0,
              })}
          </>
        )}

        {closePropertySheet}
        {closeDebtSheet}
      </Box>
    </Screen>
  );
};

export default AccountsScreen;
