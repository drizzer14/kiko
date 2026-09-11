import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { categoriesRepo } from '@kiko/categories/categories.repo';
import { holdingsRepo } from '@kiko/holdings/holdings.repo';
import { ratesRepo } from '@kiko/rates/rates.repo';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { transactionsRepo } from '@kiko/transactions/transactions.repo';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TFunction } from 'i18next';
import { type FC, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { match } from 'ts-pattern';

import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  resolveCategoryDisplay,
} from '../../categories/category-display';
import type { Currency } from '../../currency/currency';
import { formatMoney } from '../../currency/format';
import { Money } from '../../currency/money';
import { formatDate, formatDateTime } from '../../dates/format';
import type { AccountRow, HoldingRow, TransactionRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import GlassSurface from '../../design-system/components/glass-surface';
import MoneyText from '../../design-system/components/money-text';
import type { MoneyTextTone } from '../../design-system/components/money-text/money-text.props';
import Screen from '../../design-system/components/screen';
import SwipeableRow from '../../design-system/components/swipeable-row';
import { useSwipePopGuard } from '../../design-system/components/swipeable-row/use-swipe-pop-guard';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { isSyncedHolding, isSyncedTransaction } from '../../holdings/deletable';
import { type DerivedEntry, derivedEntries, type EntryTone } from '../../holdings/derived-entries';
import { defaultHoldingColor } from '../../holdings/entity-colors';
import { holdingTypeSymbol } from '../../holdings/entity-symbols';
import { asBondMeta } from '../../holdings/holding-metadata';
import { isTimeExemptHoldingType } from '../../holdings/holding-type';
import {
  bondExpectedProfitMinor,
  type HoldingValueBreakdown,
  holdingValueBreakdown,
} from '../../holdings/holding-value';
import { activeLocale } from '../../i18n/active-locale';
import type { AccountsStackParamList } from '../../navigation/types';
import { convert, type RateTable } from '../../rates/conversion';
import { buildRateTable, canConvert } from '../../rates/net-worth-view';
import { resolveCategoryColor } from '../../statistics/category-breakdown';
import { transactionRowDescription } from '../../transactions/row-description';
import EditHeaderButton from '../edit-header-button';
import EntityAmountHeader from '../entity-amount-header';
import EntityHeaderIcon from '../entity-header-icon';

type HoldingDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingDetail'>;

// The holding's display identity for the view-only header: its stored icon (or
// the type default), and its effective color resolved through the SAME
// `resolveEntityColor` the holding card uses — so the identity color on the card
// and on this header can never diverge. A bare `color ?? default` here let an
// empty-string stored color (neither null nor undefined) through, tinting the
// header with an invalid empty color while the card showed the type default.
// Extracted so the fallbacks don't count against the screen component's
// cognitive-complexity budget.
const holdingIdentity = (holding: HoldingRow): { icon: string; color: string } => ({
  icon: holding.icon ?? holdingTypeSymbol[holding.type],
  color: resolveEntityColor(holding.color, defaultHoldingColor[holding.type]),
});

const isZero = (minorUnits: number): boolean => minorUnits === 0;

// A ledger amount fixed to a color BY KIND (interest always green, tax always
// red) misleadingly implies a nonzero accrual/withholding when the amount
// itself is exactly zero (e.g. before a deposit's first interest period has
// elapsed) — override those two to the muted/gray tone instead. A `neutral`
// entry already resolves a zero amount to textPrimary/white via MoneyText's
// own sign-based fallback, so it is left untouched here. Shared by the
// breakdown summary and the transaction ledger below so the "zero reads gray"
// rule has one source of truth across both.
const ledgerTone = (tone: EntryTone, minorUnits: number): MoneyTextTone =>
  tone !== 'neutral' && isZero(minorUnits) ? 'muted' : tone;

// Rows that break the headline net value into its parts. Only the deposit and
// bond types accrue interest/tax, so the breakdown is meaningful there; other
// types render a flat value where gross == net and these would all read zero.
const breakdownRows = (
  breakdown: HoldingValueBreakdown,
  type: string,
  expectedProfit: Money | null,
  t: TFunction,
): { label: string; money: Money; tone?: MoneyTextTone }[] => [
  {
    label: type === 'bond' ? t('holdingDetail.cost') : t('holdingDetail.principal'),
    money: breakdown.principalOrCost,
  },
  { label: t('holdingDetail.grossValue'), money: breakdown.gross },
  // Interest and tax carry a fixed tone by KIND (interest always green, tax
  // always red), the same rule the derived ledger rows use — not the sign-only
  // balance coloring, which would leave a positive interest/tax magnitude
  // white — except when the amount is exactly zero, where `ledgerTone` mutes
  // it to gray instead.
  {
    label: t('holdingDetail.interestEarned'),
    money: breakdown.interest,
    tone: ledgerTone('positive', breakdown.interest.minorUnits),
  },
  {
    label: t('holdingDetail.taxWithheld'),
    money: breakdown.tax,
    tone: ledgerTone('negative', breakdown.tax.minorUnits),
  },
  // Bonds surface the whole-life expected profit: sum of net coupons + nominal
  // redeemed, less the price paid (the figure the bank statement shows). It
  // reads green as the holding's expected gain.
  ...(expectedProfit
    ? [
        {
          label: t('holdingDetail.expectedProfit'),
          money: expectedProfit,
          tone: 'positive' as const,
        },
      ]
    : []),
];

// The holding's Value converted into the user's main (base) currency, for the
// smaller caption beneath the amount — the same second line the holding card
// shows. Returns null when there is nothing to show: a holding already in the
// base currency, or one whose currency has no cached rate yet (a BTC holding
// before the first sync). The `canConvert` guard is load-bearing — `convert`
// throws on a missing rate pair. Extracted so the guard chain does not count
// against the screen component's cognitive-complexity budget.
const convertedBaseValue = (
  holding: HoldingRow | undefined,
  breakdown: HoldingValueBreakdown | null,
  baseCurrency: Currency,
  rateTable: RateTable,
): Money | null => {
  if (
    holding === undefined ||
    breakdown === null ||
    holding.currency === baseCurrency ||
    !canConvert(holding.currency, baseCurrency, rateTable)
  ) {
    return null;
  }

  return convert(breakdown.net, baseCurrency, rateTable);
};

// Which add action the screen's footer offers.
type FooterAction = 'contribution' | 'transaction' | 'none';

// A term_deposit takes contributions (its own deposit lifecycle); a plain
// holding takes a manual transaction. A bond carries no manual ledger — its
// value derives from metadata (kiko-domain) — and a synced (Monobank) holding's
// ledger is owned by the sync, so neither offers an add action. `isSyncedHolding`
// requires BOTH a connected synced institution AND the sync key in metadata, so
// a disconnected former-Monobank holding counts as manual again and keeps its
// add action. Extracted to module scope so the branch chain does not count
// against the screen component's cognitive-complexity budget.
const footerActionFor = (
  holding: HoldingRow | undefined,
  account: AccountRow | undefined,
): FooterAction => {
  if (holding === undefined) {
    return 'none';
  }

  if (holding.type === 'term_deposit') {
    return 'contribution';
  }

  if (holding.type === 'bond' || isSyncedHolding(holding, account)) {
    return 'none';
  }

  return 'transaction';
};

// One merged ledger row — either a real stored transaction or a computed
// (derived) lifecycle entry. Shared by the FlatList's `data`, `keyExtractor`,
// and `renderItem` so all three agree on the row shape.
type LedgerRow =
  | { kind: 'transaction'; time: number; transaction: TransactionRow }
  | { kind: 'derived'; time: number; entry: DerivedEntry };

// A stable key per row, reusing the exact identity the eager `.map` keyed on: a
// derived entry's synthetic id, a stored row's transaction id.
const ledgerKey = (row: LedgerRow): string =>
  row.kind === 'derived' ? row.entry.id : row.transaction.id;

// The read context a ledger row needs to render, threaded in from the screen so
// the row component stays at module scope (keeping the screen's own
// cognitive-complexity budget clear, the same pattern the helpers above follow).
type LedgerRowContext = {
  currency: Currency;
  showTime: boolean;
  categoryByKey: ReturnType<typeof buildCategoryDisplayMap>;
  defaultCategoryKey: string;
  holdingName: string;
  holdingNameById: Map<string, string>;
  onOpenChange: (open: boolean) => void;
  onPressTransaction: (transactionId: string) => void;
};

// A single ledger row, lifted verbatim out of the old eager `.map` so the
// FlatList mounts only the visible rows — a synced card can carry thousands.
// The row UI, props, spacing, and testIDs are unchanged. A derived (computed)
// entry is read-only; a stored transaction wraps in SwipeableRow and is
// tappable.
const LedgerRowItem: FC<{ row: LedgerRow; context: LedgerRowContext }> = ({ row, context }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const {
    currency,
    showTime,
    categoryByKey,
    defaultCategoryKey,
    holdingName,
    holdingNameById,
    onOpenChange,
    onPressTransaction,
  } = context;

  if (row.kind === 'derived') {
    // A computed lifecycle entry (opening/top-up, interest accrual, the
    // 18%/5% withholding lines, capitalization, or a bond
    // purchase/coupon/redemption): read-only — no SwipeableRow, not
    // tappable — and marked "Computed" so it reads as derived, not a
    // stored transaction. A projected (future-dated) entry — an
    // upcoming accrual, coupon, or redemption — is dimmed and marked
    // "Projected". The amount reads in its kind-derived tone (tax red,
    // interest/coupon green, principal movements neutral/by-sign).
    return (
      <GlassSurface
        transparent
        padding={3}
        testID="ledger-row"
        style={row.entry.isFuture ? styles.futureRow : undefined}
      >
        <Box gap={1}>
          <Box direction="row" style={styles.rowMain}>
            <Box style={styles.rowDescription}>
              <Text variant="body">{row.entry.label}</Text>
            </Box>
            <Box style={styles.rowAmount}>
              <MoneyText
                money={Money.of(currency, row.entry.amountMinorUnits)}
                tone={ledgerTone(row.entry.tone, row.entry.amountMinorUnits)}
              />
            </Box>
          </Box>
          <Box style={styles.rowFooter}>
            <Text variant="caption" tone="textSecondary">
              {row.entry.isFuture ? t('holdingDetail.projected') : t('holdingDetail.computed')} ·{' '}
              {showTime ? formatDateTime(row.entry.time) : formatDate(row.entry.time)}
            </Text>
          </Box>
        </Box>
      </GlassSurface>
    );
  }

  // The row's stored category resolves to its icon + title through the
  // same shared mapping Home uses; a null/unknown category falls back
  // to the neutral display.
  const category = resolveCategoryDisplay(
    row.transaction.category,
    categoryByKey,
    defaultCategoryKey,
  );

  // Every real row is tappable: it opens the shared Transaction form
  // for this id. A manual row edits; a synced (Monobank) row opens
  // read-only — the form resolves which from the transaction's own
  // `source`, so the row only needs to pass the id. Swipe-to-delete
  // is disabled for synced rows (their state is owned by the sync).
  return (
    <SwipeableRow
      disabled={isSyncedTransaction(row.transaction)}
      onDelete={() => transactionsRepo.remove(row.transaction.id)}
      onOpenChange={onOpenChange}
      // Match the wrapped glass card's radius (GlassSurface defaults
      // to `md`) so the swipe reveal clips to the same corners.
      radius={theme.radii.md}
    >
      <Pressable accessibilityRole="button" onPress={() => onPressTransaction(row.transaction.id)}>
        <GlassSurface transparent padding={3} testID="ledger-row">
          <Box gap={1}>
            <Box direction="row" style={styles.rowMain}>
              <Box direction="row" gap={2} style={styles.rowLead}>
                <SymbolIcon
                  name={category.icon}
                  size={theme.iconSizes.body}
                  tone="textSecondary"
                  color={resolveCategoryColor(
                    category.color,
                    row.transaction.category?.toLowerCase() || defaultCategoryKey,
                  )}
                  accessibilityLabel={category.title}
                />
                <Box style={styles.rowDescription}>
                  <Text variant="body">
                    {transactionRowDescription({
                      transaction: row.transaction,
                      holdingName,
                      holdingNameById,
                      t,
                    })}
                  </Text>
                </Box>
              </Box>
              <Box style={styles.rowAmount}>
                <MoneyText
                  money={Money.of(currency, row.transaction.amountMinorUnits)}
                  context="transaction"
                />
              </Box>
            </Box>
            <Box style={styles.rowFooter}>
              <Text variant="caption" tone="textSecondary">
                {showTime ? formatDateTime(row.transaction.time) : formatDate(row.transaction.time)}
              </Text>
            </Box>
          </Box>
        </GlassSurface>
      </Pressable>
    </SwipeableRow>
  );
};

const HoldingDetailScreen: FC<HoldingDetailScreenProps> = ({ route, navigation }) => {
  const { t } = useTranslation();
  const { holdingId, name: initialName } = route.params;
  // Disable this screen's native back-swipe while any transaction row is open,
  // so a right-swipe that closes a row does not also pop the screen.
  const onOpenChange = useSwipePopGuard(navigation);
  // `holdingsRepo` exposes no single-row lookup, so the holding's own
  // currency (needed to render each transaction's signed MoneyText) comes
  // from filtering the full holdings list for this id.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listByHoldingQuery(holdingId), [
    'transactions',
  ]);
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  // The cached conversion rates, so the Value amount can carry a smaller
  // converted base-currency caption beneath it — the same second line the
  // holding card shows for a holding in a non-base currency.
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);

  // Resolve each transaction row's stored category to its display (icon + title)
  // through the same shared mapping Home uses, so a rename flows through here too.
  const categoryByKey = buildCategoryDisplayMap(categories);
  // The configurable catch-all: a null/empty category resolves to this category
  // (seeded to `other`), matching Home and the statistics breakdown.
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;

  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';
  const now = Date.now();
  const breakdown = holding ? holdingValueBreakdown(holding, now) : null;
  // The owning account, so the footer's sync gate can read its `institution`.
  // `isSyncedHolding` requires BOTH a connected synced institution AND a sync
  // key in metadata, so a disconnected former-Monobank holding counts as manual
  // again and keeps its add action.
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(holding?.accountId ?? ''), [
    'accounts',
  ]);
  const account = accounts.at(0);
  // Bonds show a whole-life expected profit line (net coupons + nominal - price).
  const bondMeta = holding?.type === 'bond' ? asBondMeta(holding.metadata) : null;
  const expectedProfit = bondMeta
    ? Money.of(currency, bondExpectedProfitMinor(bondMeta, currency))
    : null;

  // The user's main currency, and the rate table that converts into it. A
  // holding in a different currency shows a smaller converted base-currency
  // caption beneath its Value — the same second line the holding card renders.
  // `convert` throws on a missing rate pair, so the `canConvert` guard is
  // load-bearing: a BTC holding before the first rate sync shows no second line.
  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);
  const convertedToBase = convertedBaseValue(holding, breakdown, baseCurrency, rateTable);

  // The transaction ledger merges the holding's real (stored) transactions with
  // the computed entries a deposit/bond accrues (contributions, interest, tax,
  // purchase, coupon — whatever `derivedEntries` yields for the type). Both
  // carry a `time`; the merged list is sorted newest-first to match the repo's
  // `desc(time)` ordering. Real rows stay interactive (swipe-to-delete, tap to
  // edit); derived rows are read-only and marked "Computed".
  const derived: DerivedEntry[] = holding ? derivedEntries(holding, now, t) : [];
  const ledger = [
    ...transactions.map((transaction) => ({
      kind: 'transaction' as const,
      time: transaction.time,
      transaction,
    })),
    ...derived.map((entry) => ({ kind: 'derived' as const, time: entry.time, entry })),
  ].sort((first, second) => second.time - first.time);
  const showBreakdown = holding?.type === 'term_deposit' || holding?.type === 'bond';
  // Which add action the footer offers — or none, for a bond or a synced
  // holding (see `footerActionFor`).
  const footerAction = footerActionFor(holding, account);
  // A term_deposit/bond event is day-granular (a contribution, coupon, or
  // redemption), so its ledger rows show the date only; every other holding
  // keeps the full date + HH:MM stamp.
  const showTime = holding ? !isTimeExemptHoldingType(holding.type) : true;

  // The nav title shows the holding NAME only — the native large title, the
  // standard iOS pattern (the identity icon now sits beside the Value amount
  // below, not in the title). The name is available from the route params at the
  // FIRST render, so the large title (and the back button on any screen pushed
  // from here) reads immediately; the live-queried name takes over once loaded so
  // a rename flows back through. This drops the old async `headerLargeTitle: false`
  // + custom `headerTitle` toggle, which briefly blanked the pushed screen's back
  // button and flashed the large title collapsing on load.
  const holdingName = holding?.name ?? initialName;
  // Counterpart holding names, so an Exchange/Convert leg on this holding reads
  // as "Exchange to/from <the OTHER holding's CURRENT name>" in the active
  // language — nothing is persisted (see transactions/row-description.ts).
  const holdingNameById = new Map(holdings.map((candidate) => [candidate.id, candidate.name]));
  // The holding's effective icon + color, rendered as the identity glyph beside
  // the Value amount (via `EntityHeaderIcon` in the `EntityAmountHeader` icon slot
  // below) rather than in the nav title.
  const identity = holding ? holdingIdentity(holding) : undefined;
  // The holding's owning account, needed to open its edit form (the form reads
  // the account's kind to constrain the type chips). Always present on a real
  // row (accountId is NOT NULL); the header Edit action is gated on it.
  const holdingAccountId = holding?.accountId;

  // The header/summary block that scrolls above the ledger: the Value amount +
  // identity icon, the optional converted (main-currency) caption tucked
  // directly under that amount, the optional breakdown lines, the hairline
  // divider, and the Transactions heading. It sits in the FlatList's
  // `ListHeaderComponent` so the list owns the scrolling (an eager list nested
  // in a ScrollView breaks virtualization).
  const listHeader = (
    <Box gap={4}>
      {holding && breakdown && (
        <Box gap={1}>
          <EntityAmountHeader
            testID="holding-value-header"
            label={t('holdingDetail.valueLabel')}
            money={breakdown.net}
            icon={<EntityHeaderIcon identity={identity} />}
            // The main (base) currency restatement of the Value sits directly
            // UNDER the holding-currency amount, inside the shared header's tight
            // column — the same grouping the holding card uses (converted line
            // hugging the value) and consistent across every holding type. It
            // used to render as a disconnected caption at the BOTTOM of the whole
            // summary block, which on a deposit/bond floated below the whole
            // breakdown, detached from the value it converts (feedback round-2,
            // item 3).
            secondary={
              convertedToBase ? (
                <Box testID="holding-detail-converted">
                  <Text variant="caption" tone="textSecondary">
                    {formatMoney(convertedToBase, activeLocale())}
                  </Text>
                </Box>
              ) : undefined
            }
          />
          {showBreakdown && (
            <Box gap={1} style={styles.breakdown}>
              {breakdownRows(breakdown, holding.type, expectedProfit, t).map((detail) => (
                <Box
                  key={detail.label}
                  style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                >
                  <Text variant="caption" tone="textSecondary">
                    {detail.label}
                  </Text>
                  <MoneyText money={detail.money} tone={detail.tone} />
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      <Box style={styles.divider} />

      <Text variant="heading">{t('holdingDetail.transactionsHeading')}</Text>
    </Box>
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: holdingName,
      ...(holdingAccountId !== undefined && {
        headerRight: () => (
          <EditHeaderButton
            onPress={() =>
              navigation.navigate('HoldingForm', { accountId: holdingAccountId, holdingId })
            }
          />
        ),
      }),
    });
  }, [navigation, holdingName, holdingAccountId, holdingId]);

  // The per-row read context, threaded into each ledger row so the row
  // component stays at module scope. `holdingName` is always a string (the
  // route param seeds it), so the old `?? ''` fallback is no longer needed.
  const rowContext: LedgerRowContext = {
    currency,
    showTime,
    categoryByKey,
    defaultCategoryKey,
    holdingName,
    holdingNameById,
    onOpenChange,
    onPressTransaction: (transactionId) =>
      navigation.navigate('TransactionForm', { transactionId }),
  };

  return (
    <Screen
      // The FlatList below OWNS this screen's scrolling under the accounts
      // stack's native large title (`headerLargeTitle: true`). `bleedTop` drops
      // Screen's top safe-area edge and its content top padding so the list
      // reaches the top edge and iOS applies the large-title content inset to
      // it (via the FlatList's own `contentInsetAdjustmentBehavior="automatic"`
      // below) — without it the large title floats above / overlaps the summary
      // header at scroll-top (feedback round-2, item 2). This mirrors the
      // working `account-detail` scroll ScrollView, which Screen's `scroll`
      // branch configures the same way; this screen cannot use `scroll` because
      // a virtualized FlatList must not nest inside that branch's ScrollView.
      bleedTop
      footer={
        // A large, full-width primary action, shown for the holdings that take
        // one. A term_deposit opens the dedicated Contribution form ("Add
        // contribution"); a plain holding opens the shared Transaction form
        // ("Add transaction"). A bond and a synced holding take no manual add
        // action, so they render no footer at all.
        match(footerAction)
          .with('contribution', () => (
            <Button onPress={() => navigation.navigate('ContributionForm', { holdingId })}>
              {t('forms.holding.addContribution')}
            </Button>
          ))
          .with('transaction', () => (
            <Button onPress={() => navigation.navigate('TransactionForm', { holdingId })}>
              {t('holdingDetail.addTransaction')}
            </Button>
          ))
          .with('none', () => undefined)
          .exhaustive()
      }
    >
      {/* The ledger is a virtualized FlatList that OWNS this screen's scrolling
          (Screen renders its non-scroll branch, keeping the safe-area + padding
          around it), so only the visible rows mount — a synced card can carry
          thousands. The summary block + Transactions heading ride along in
          `ListHeaderComponent`; nesting an eager list inside a scrolling Screen
          would break virtualization and warn about a nested VirtualizedList.
          The `spacing(2)` row gap matches the old `<Box gap={2}>` — it lands
          between the header and the first row and between rows alike. */}
      <FlatList
        testID="ledger-list"
        data={ledger}
        keyExtractor={ledgerKey}
        renderItem={({ item }) => <LedgerRowItem row={item} context={rowContext} />}
        ListHeaderComponent={listHeader}
        // The list owns the scrolling under the native large title, so it — not
        // Screen's ScrollView — must carry the automatic content-inset
        // adjustment that seats content below the expanded large title (Screen
        // passes `bleedTop` above to drop the matching double top inset). Same
        // setting the shared `Screen` scroll branch applies to its ScrollView.
        contentInsetAdjustmentBehavior="automatic"
        style={styles.list}
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
};

const styles = StyleSheet.create((theme) => ({
  // The ledger FlatList fills the Screen's (non-scroll branch) padded content
  // box and owns the scrolling itself, so only visible rows mount.
  list: {
    flex: 1,
  },
  // The scroll content: `spacing(2)` between every child — the header block and
  // the first row, and each row and the next — reproducing the old
  // `<Box gap={2}>` that wrapped the Transactions heading and its rows. The
  // `spacing(4)` top padding lives HERE (inside the scroll content) rather than
  // on Screen's content wrapper, because Screen drops that wrapper's top
  // padding under `bleedTop` so the list can reach the large-title inset — this
  // keeps the same top gap the wrapper used to provide, below the collapsed
  // large title, matching account-detail's scroll content padding.
  listContent: {
    paddingTop: theme.spacing(4),
    gap: theme.spacing(2),
  },
  // A projected (post-`now`) lifecycle entry, dimmed so it reads as an estimate
  // rather than a settled statement line.
  futureRow: {
    opacity: 0.5,
  },
  // Extra space above the value breakdown so the headline number sits clearly
  // apart from the principal/gross/interest/tax rows beneath it.
  breakdown: {
    marginTop: theme.spacing(3),
  },
  // A hairline rule separating the Value block from the Transactions list — the
  // same standard hairline treatment the account-detail sections use
  // (account-detail.styles.ts `divider`), drawn in the theme's separator color
  // with vertical margin so each section has room to breathe.
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: theme.spacing(2),
    backgroundColor: theme.colors.border,
  },
  // The primary line of a transaction row: description on the left, amount on
  // the right, split by space-between.
  rowMain: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // The leading cluster of a transaction row: category icon + description, kept
  // together on the left so the row's space-between only splits this cluster
  // from the amount. `flex: 1` bounds it to the space left of the amount; top-
  // aligned so the icon sticks to the first line of a wrapping title.
  rowLead: {
    flex: 1,
    alignItems: 'flex-start',
  },
  // The description cell: `flex: 1` lets a long title wrap onto multiple lines
  // within the bounded row instead of pushing the amount off-screen.
  rowDescription: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
  // The trailing amount cell: never shrinks, so the amount stays fully visible
  // no matter how long the description grows.
  rowAmount: {
    flexShrink: 0,
  },
  // The row's secondary line: the timestamp caption pinned to the right so it
  // sits BELOW the value column instead of left-aligned under the description —
  // mirroring the Home row's `rowFooter` (home.styles.ts), where the time is
  // bottom-right of the row. Here the caption is the only footer content, so a
  // right-aligned self is enough (no space-between split needed).
  rowFooter: {
    alignSelf: 'flex-end',
  },
}));

export default HoldingDetailScreen;
