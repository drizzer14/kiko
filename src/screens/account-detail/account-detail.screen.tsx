import either from 'fnts/either';
import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { ratesRepo } from '@kiko/rates/repo';
import Sortable from 'react-native-sortables';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import type { ScrollViewInstance } from 'react-native';
import type { Currency } from '@kiko/currency/currency';
import { useAnimatedRef } from 'react-native-reanimated';
import { useReminderOffer } from '@kiko/reminders/offer';
import { usePriceBook } from '@kiko/prices/use-price-book';
import { isSyncedHolding } from '@kiko/holdings/deletable';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { sumByCurrency } from '@kiko/rates/currency-totals';
import { needsPriceBook } from '@kiko/holdings/priced-value';
import Divider from '@kiko/design-system/components/divider';
import type { ReminderKind } from '@kiko/reminders/schedule';
import { editBarItem } from '@kiko/design-system/edit-bar-item';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { accountIdentity } from '@kiko/holdings/account-identity';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import { onGridDragEnd } from '@kiko/design-system/grid-interaction';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import { type HoldingRow, useDataReady, useLiveQuery } from '@kiko/db';
import { fileNameOf } from '@kiko/statement-import/read-statement-file';
import LoadingState from '@kiko/design-system/components/loading-state';
import { pick, types, keepLocalCopy } from '@react-native-documents/picker';
import { buildRateTable, guardedNetWorth } from '@kiko/rates/net-worth-view';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';
import EntityHeaderIcon from '@kiko/design-system/components/entity-header-icon';
import CurrencyBreakdown from '@kiko/design-system/components/currency-breakdown';
import { type FC, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import ReminderOfferCard from '@kiko/design-system/components/reminder-offer-card';
import EntityAmountHeader from '@kiko/design-system/components/entity-amount-header';
import { isConnectableBank, statementFormatIdForBank } from '@kiko/bank-sync/bank-catalog';

import HoldingCard from './holding-card';
import { styles } from './account-detail.styles';
import BankSyncSection from './bank-sync-section';
import CloseHoldingSheet from './close-holding-sheet';
import CryptoSyncSection from './crypto-sync-section';

const offerMessage = (kind: ReminderKind, t: TFunction): string =>
  match(kind)
    .with('statement_import', () => t('reminders.offer.statementImportMessage'))
    .with('add_transactions', () => t('reminders.offer.addTransactionsMessage'))
    .exhaustive();

type AccountDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountDetail'>;

const AccountDetailScreen: FC<AccountDetailScreenProps> = ({ route, navigation }) => {
  const { accountId, name: initialName, reminderOffer, intent } = route.params;
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
  // At most one offer per visit: once one is decided, clearing the import
  // param would otherwise fall back to the manual-entry offer at once.
  const [offerDecided, setOfferDecided] = useState(false);
  // After the page's own reads, so they queue first on op-sqlite's one worker;
  // above the loading gate, so a cached offer is there on the first ready frame.
  const offer = useReminderOffer({
    accountId,
    account,
    settings: settingsRows.at(0),
    trigger: offerDecided ? undefined : (reminderOffer ?? 'manualActivity'),
  });
  const acceptOffer = (kind: ReminderKind): void => {
    setOfferDecided(true);
    navigation.navigate('ReminderForm', { accountId, kind });
    navigation.setParams({ reminderOffer: undefined });
  };
  // A failed write keeps the offer on screen, so the user can try again.
  const dismissOffer = async (dismiss: () => Promise<void>): Promise<void> => {
    try {
      await dismiss();
    } catch {
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

      return;
    }

    setOfferDecided(true);
    navigation.setParams({ reminderOffer: undefined });
  };

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
  const identity = foldMap(maybe(account), accountIdentity);
  // Adjacent bar items share one glass capsule on iOS 26+, which would read the
  // bell and the Edit pencil as one control with two glyphs, so neither shares
  // its background; header items run left to right, keeping the bell left of
  // Edit.
  useLayoutEffect(() => {
    navigation.setOptions({
      title: accountName,
      unstable_headerRightItems: () => [
        {
          type: 'button',
          label: t('reminders.rowLabel'),
          accessibilityLabel: t('reminders.rowLabel'),
          icon: { type: 'sfSymbol', name: 'bell' },
          tintColor: theme.colors.textPrimary,
          sharesBackground: false,
          onPress: () => navigation.navigate('AccountReminders', { accountId, name: accountName }),
        },
        editBarItem({
          label: t('common.edit'),
          tintColor: theme.colors.textPrimary,
          onPress: () => navigation.navigate('AccountForm', { accountId }),
        }),
      ],
    });
  }, [navigation, accountName, accountId, t, theme.colors.textPrimary]);

  const activeHoldings = holdings.filter((holding) => holding.closedAt == null);

  // A synced holding keeps its sync-driven close: the bank decides when it is
  // gone, so only a manual one offers Close.
  const [closeTarget, setCloseTarget] = useState<HoldingRow>();
  const [isCloseConfirmVisible, setCloseConfirmVisible] = useState(false);
  const closeActionFor = (holding: HoldingRow): (() => void) | undefined => {
    if (isSyncedHolding(holding, account)) {
      return undefined;
    }

    return () => {
      setCloseTarget(holding);
      setCloseConfirmVisible(true);
    };
  };

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
  const bankId = account?.bankId;
  const pickAndOpenStatement = useCallback(async (): Promise<void> => {
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
      expectedFormatId: statementFormatIdForBank(bankId),
    });
  }, [navigation, accountId, bankId]);

  // A tap on an import reminder opens the picker once the page can show the
  // import; the cleared param keeps a later render from opening it again.
  useEffect(() => {
    if (intent !== 'importStatement' || !isReady) {
      return;
    }

    navigation.setParams({ intent: undefined });

    if (isBankAccount) {
      // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) either() captures a failed copy, which then leaves the page as it was, the same as after the Import statement button
      either(pickAndOpenStatement);
    }
  }, [intent, isReady, isBankAccount, navigation, pickAndOpenStatement]);

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
            <Button variant="secondaryTonal" onPress={pickAndOpenStatement} icon="doc.badge.plus">
              {t('accountDetail.importStatement')}
            </Button>
          )}
          <Button
            variant="primary"
            onPress={() => navigation.navigate('HoldingForm', { accountId })}
            icon={genericEntitySymbol.holding}
          >
            {t('accountDetail.addHolding')}
          </Button>
        </Box>
      }
    >
      <Box gap={4} testID="account-detail-content">
        {offer && (
          <ReminderOfferCard
            testID="reminder-offer"
            message={offerMessage(offer.kind, t)}
            acceptLabel={t('reminders.offer.setUp')}
            dismissLabel={t('reminders.offer.dismiss')}
            onAccept={() => acceptOffer(offer.kind)}
            onDismiss={() => dismissOffer(offer.dismiss)}
          />
        )}

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
              Close/Delete action list; a hold-and-move drags to reorder — see `CardContextMenu`
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
                    onClose={closeActionFor(item)}
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

          {closeTarget !== undefined && (
            <CloseHoldingSheet
              holding={closeTarget}
              visible={isCloseConfirmVisible}
              onDismiss={() => setCloseConfirmVisible(false)}
            />
          )}
        </Box>
      </Box>
    </Screen>
  );
};

export default AccountDetailScreen;
