import type { FC } from 'react';
import { useLayoutEffect } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { ratesRepo } from '@kiko/rates/repo';
import Sortable from 'react-native-sortables';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { useUnistyles } from 'react-native-unistyles';
import type { ScrollViewInstance } from 'react-native';
import { useAnimatedRef } from 'react-native-reanimated';
import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { pick, types, keepLocalCopy } from '@react-native-documents/picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { AccountRow } from '../../db/schema';
import Box from '../../design-system/components/box';
import { useDataReady } from '../../db/use-data-ready';
import { useLiveQuery } from '../../db/use-live-query';
import Text from '../../design-system/components/text';
import type { Currency } from '../../currency/currency';
import { usePriceBook } from '../../prices/use-price-book';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import { isSyncedHolding } from '../../holdings/deletable';
import { sumByCurrency } from '../../rates/currency-totals';
import Divider from '../../design-system/components/divider';
import { needsPriceBook } from '../../holdings/priced-value';
import { accountKindSymbol } from '../../holdings/entity-symbols';
import { defaultAccountColor } from '../../holdings/entity-colors';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { onGridDragEnd } from '../../design-system/grid-interaction';
import type { AccountsStackParamList } from '../../navigation/types';
import LoadingState from '../../design-system/components/loading-state';
import { fileNameOf } from '../../statement-import/read-statement-file';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import CardContextMenu from '../../design-system/components/card-context-menu';
import EntityHeaderIcon from '../../design-system/components/entity-header-icon';
import EditHeaderButton from '../../design-system/components/edit-header-button';
import CurrencyBreakdown from '../../design-system/components/currency-breakdown';
import EntityAmountHeader from '../../design-system/components/entity-amount-header';
import { isConnectableBank, statementFormatIdForBank } from '../../bank-sync/bank-catalog';

import HoldingCard from './holding-card';
import { styles } from './account-detail.styles';
import BankSyncSection from './bank-sync-section';
import CryptoSyncSection from './crypto-sync-section';

// The account's display identity for the view-only header: its stored icon (or
// the kind default), and its effective color resolved through the SAME
// `resolveEntityColor` the accounts-list card uses — so the identity color on
// the card and on this header can never diverge. A bare `color ?? default` here
// let an empty-string stored color (neither null nor undefined) through, tinting
// the header with an invalid empty color while the card showed the kind default.
// Extracted so the fallbacks — and the not-yet-loaded (undefined) case — don't
// count against the screen component's cognitive-complexity budget.
const accountIdentity = (
  account: AccountRow | undefined,
): { icon: string; color: string } | undefined =>
  foldMap(maybe(account), (found) => ({
    icon: found.icon ?? accountKindSymbol[found.kind],
    color: resolveEntityColor(found.color, defaultAccountColor[found.kind]),
  }));

type AccountDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountDetail'>;

const AccountDetailScreen: FC<AccountDetailScreenProps> = ({ route, navigation }) => {
  const { accountId, name: initialName } = route.params;
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { data: accounts, isLoading: accountsLoading } = useLiveQuery(
    accountsRepo.byIdQuery(accountId),
    ['accounts'],
    true,
    { cached: true },
  );
  const {
    data: holdings,
    isLoading: holdingsLoading,
    isFresh: holdingsFresh,
  } = useLiveQuery(holdingsRepo.listByAccountQuery(accountId), ['holdings'], true, {
    cached: true,
  });
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
  // Empty holding list / zero balance must never render while any of this
  // screen's own queries is still on its first load (kiko-architecture's
  // useLiveQuery consumer rule) — gated below, right at the return.
  const isReady = useDataReady(
    accountsLoading,
    holdingsLoading,
    ratesLoading,
    settingsLoading,
    priceBookLoading,
  );
  const account = accounts.at(0);

  // The nav title shows the account NAME only — the native large title, the
  // standard iOS pattern (the identity icon now sits beside the Balance amount
  // below, not in the title). The name is available from the route params at the
  // FIRST render, so the large title (and the back button on any screen pushed
  // from here) reads immediately; the live-queried name takes over once loaded so
  // a rename flows back through. This drops the old async `headerLargeTitle: false`
  // + custom `headerTitle` toggle, which briefly blanked the pushed screen's back
  // button and flashed the large title collapsing on load.
  const accountName = account?.name ?? initialName;
  // The account's effective icon + color, rendered as the identity glyph beside
  // the Balance amount (via `EntityHeaderIcon` in the `EntityAmountHeader` icon
  // slot below) rather than in the nav title.
  const identity = accountIdentity(account);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: accountName,
      headerRight: () => (
        <EditHeaderButton onPress={() => navigation.navigate('AccountForm', { accountId })} />
      ),
    });
  }, [navigation, accountName, accountId]);

  const activeHoldings = holdings.filter((holding) => holding.closedAt == null);

  // Reuse the accounts-list conversion path: sum this account's open holdings
  // into the base currency, then list each currency's own total beneath.
  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);
  // Deposit/bond holdings grow with time, so net worth is evaluated as of now —
  // otherwise their accrued value never reflects in the account balance.
  const now = Date.now();
  const overallBalance = guardedNetWorth(activeHoldings, baseCurrency, rateTable, now, priceBook);
  const breakdown = sumByCurrency(activeHoldings, now, priceBook);
  // The grid renders in the query's order — `listByAccountQuery` already sorts by
  // the user-controlled `sortOrder` (the drag-and-drop order), so manual drag
  // order is the sole ordering key and no screen-level re-sort is needed.

  // The parent ScrollView's animated ref, shared with the sortable grid so a
  // drag near the top/bottom edge auto-scrolls the list (the grid is nested
  // inside this Screen's ScrollView, so it cannot scroll it without the ref).
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();

  const isBankAccount = account?.kind === 'bank';
  const isCryptoAccount = account?.kind === 'crypto';

  // Every bank account shows the connect/sync affordance independently — there
  // is no single-connection gate, so a second connection can connect
  // alongside the first (each binds its own per-account credential and cursor).
  // Gated on the account's picked bank being CONNECTABLE (the SAME
  // `bankCatalog` capability BankTypeField's picker already reads): an
  // import-only bank (e.g. PrivatBank) must show NO
  // sync/connect section, only the Import-statement footer button below. An
  // account with no bank picked yet (or one from before this feature)
  // defaults to connectable rather than guessing it is import-only.
  const showActionButton = isBankAccount && isConnectableBank(account?.bankId);

  // The document-picker statement-import entry point,
  // same style as the create-form's `connectMonobank`
  // closure: open the picker, then — on a real pick, not a cancel — copy it
  // to a LOCAL cache path (see the `keepLocalCopy` comment below) and hand
  // THAT stable path to `StatementImportScreen`, which owns
  // the actual read/decode/detect/parse/preview. This handler does NOT
  // pre-read the file itself: an earlier revision read it here too (as a
  // validity check before navigating), but that made every pick pay for two
  // reads of the same file and, worse, left the READ's own failure mode (an
  // iCloud placeholder not yet downloaded, a revoked security-scoped URL)
  // unhandled right here — the single read now lives entirely in
  // `StatementImportScreen`, which already guards it and renders a graceful
  // error state on failure. The accepted-type list includes xlsx from the
  // start even though only the Monobank CSV format ships today (PrivatBank
  // XLSX lands later and must not need this list revisited). A
  // cancelled picker rejects with `OPERATION_CANCELED` — caught and
  // swallowed here, not surfaced as an error.
  const pickAndOpenStatement = async (): Promise<void> => {
    let results: Awaited<ReturnType<typeof pick>>;

    try {
      results = await pick({ type: [types.csv, types.xlsx, types.plainText, types.allFiles] });
    } catch {
      // A cancelled picker rejects with `OPERATION_CANCELED` — the expected
      // case, handled the same as every other connect-field's `catch {}`
      // above: fail silently and leave the screen exactly as it was, no
      // error surfaced for the (very common) "user backed out" path.
      return;
    }

    const picked = results.at(0);

    if (!picked) {
      return;
    }

    // The picker hands back a security-scoped external URI
    // (iCloud / Files / an AirDropped file) that `RNFS.readFile` cannot
    // reliably read more than once — both `StatementImportScreen` and
    // `ColumnMappingScreen` independently re-read THIS SAME `filePath` on
    // every mount, so a provider that tolerates one or two reads but not the
    // third (preview, first Map Columns, second Map Columns after Back)
    // degrades to the generic "unrecognized format" state with no action.
    // Copy the picked file into the app's OWN cache ONCE here, at pick time
    // — the same `keepLocalCopy` pattern `import-data.screen.tsx` already
    // uses — and hand both downstream screens that local copy's stable
    // path instead, falling back to the raw picked uri only if the copy
    // itself fails.
    const [copied] = await keepLocalCopy({
      files: [{ uri: picked.uri, fileName: picked.name ?? fileNameOf(picked.uri) }],
      destination: 'cachesDirectory',
    });

    navigation.navigate('StatementImport', {
      filePath: copied.status === 'success' ? copied.localUri : picked.uri,
      accountId,
      expectedFormatId: statementFormatIdForBank(account?.bankId),
    });
  };

  if (!isReady) {
    // The SAME Screen mode/props as the ready branch below (`scroll` +
    // `scrollableRef`) — not a bare `<Screen>` — so the first scroll view iOS
    // walks to drive the native large-title collapse exists from the very
    // first render, not only once data has loaded.
    return (
      <Screen scroll scrollableRef={scrollableRef}>
        <LoadingState testID="account-detail-loading" />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      footer={
        <Box gap={2}>
          {isBankAccount && (
            <Button
              variant="secondaryTonal"
              fullWidth
              onPress={pickAndOpenStatement}
              icon="doc.badge.plus"
            >
              {t('accountDetail.importStatement')}
            </Button>
          )}
          <Button
            variant="primary"
            fullWidth
            onPress={() => navigation.navigate('HoldingForm', { accountId })}
          >
            {t('accountDetail.addHolding')}
          </Button>
        </Box>
      }
    >
      <Box gap={4} testID="account-detail-content">
        <Box gap={1} style={styles.balanceBlock}>
          <EntityAmountHeader
            label={t('accountDetail.balanceLabel')}
            money={overallBalance}
            context="balance"
            icon={<EntityHeaderIcon identity={identity} />}
          />
          <Box style={styles.breakdown}>
            <CurrencyBreakdown items={breakdown} />
          </Box>
        </Box>

        {isCryptoAccount && account && (
          <>
            <Divider spacing={2} />
            <CryptoSyncSection account={account} holdings={activeHoldings} />
          </>
        )}

        {showActionButton && account && (
          <>
            <Divider spacing={2} />
            <BankSyncSection account={account} />
          </>
        )}

        <Divider spacing={2} />

        <Box gap={3}>
          <Text variant="heading">{t('accountDetail.holdingsHeading')}</Text>

          {/* A single-column drag-and-drop list of wide holding row cards
              (mirroring the accounts list). A plain tap opens the holding; a
              touch-and-hold-still on a manual card opens the deep-press (haptic)
              delete menu; a hold-and-move drags to reorder — see `CardContextMenu`
              and `onGridDragEnd`. `overDrag="vertical"` keeps a dragged card on
              its vertical axis (a single column has no horizontal move to make).
              `scrollableRef` + `autoScrollActivationOffset` let a drag near an
              edge scroll the parent list. `sortEnabled` is off with a single
              holding, where there is nothing to reorder, and until the
              holdings query's own fresh read has applied — a drag persists
              the order of the rows on screen, never the cached
              (possibly one-read-old) order (kiko-architecture). */}
          <Box testID="holdings-grid">
            <Sortable.Grid
              data={activeHoldings}
              sortEnabled={holdingsFresh && activeHoldings.length > 1}
              // A subtle lift on touch-and-hold: the library default (1.1) pops
              // the card up too much, so scale it just barely (matches the
              // accounts grid).
              activeItemScale={1.03}
              columns={1}
              overDrag="vertical"
              rowGap={theme.spacing(3)}
              scrollableRef={scrollableRef}
              autoScrollActivationOffset={75}
              keyExtractor={(holding) => holding.id}
              renderItem={({ item }) => (
                <Box testID="holding-grid-item">
                  <CardContextMenu
                    name={item.name}
                    deletable={!isSyncedHolding(item, account)}
                    onDelete={() => holdingsRepo.remove(item.id)}
                  >
                    <HoldingCard
                      holding={item}
                      now={now}
                      baseCurrency={baseCurrency}
                      rateTable={rateTable}
                      priceBook={priceBook}
                      onOpen={() =>
                        navigation.navigate('HoldingDetail', {
                          holdingId: item.id,
                          name: item.name,
                        })
                      }
                    />
                  </CardContextMenu>
                </Box>
              )}
              onDragEnd={({ fromIndex, toIndex, indexToKey }) =>
                onGridDragEnd({ fromIndex, toIndex, indexToKey }, holdingsRepo.reorder)
              }
            />
          </Box>
        </Box>
      </Box>
    </Screen>
  );
};

export default AccountDetailScreen;
