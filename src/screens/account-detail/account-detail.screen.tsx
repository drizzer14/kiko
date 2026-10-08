import either from 'fnts/either';
import { match } from 'ts-pattern';
import { useTip } from '@kiko/tips';
import {
  accountDisplayName,
  isImplicitAccount,
  isImplicitAccountKind,
} from '@kiko/holdings/implicit-account';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { ratesRepo } from '@kiko/rates/repo';
import Sortable from 'react-native-sortables';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { logFailure } from '@kiko/diagnostics';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import type { ScrollViewInstance } from 'react-native';
import type { Currency } from '@kiko/currency/currency';
import { useAnimatedRef } from 'react-native-reanimated';
import { useReminderOffer } from '@kiko/reminders/offer';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { transactionsRepo } from '@kiko/transactions/repo';
import { sumByCurrency } from '@kiko/rates/currency-totals';
import { needsPriceBook } from '@kiko/holdings/priced-value';
import Divider from '@kiko/design-system/components/divider';
import type { ReminderKind } from '@kiko/reminders/schedule';
import TipCard from '@kiko/design-system/components/tip-card';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { accountIdentity } from '@kiko/holdings/account-identity';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import { onGridDragEnd } from '@kiko/design-system/grid-interaction';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import HoldingCard from '@kiko/design-system/components/holding-card';
import { type AccountRow, useDataReady, useLiveQuery } from '@kiko/db';
import { fileNameOf } from '@kiko/statement-import/read-statement-file';
import LoadingState from '@kiko/design-system/components/loading-state';
import { removeHoldingsNoticeOf } from '@kiko/transactions/remove-notice';
import { useCurrentPriceBook } from '@kiko/prices/use-current-price-book';
import { useGridLiftGuard } from '@kiko/design-system/use-grid-lift-guard';
import { pick, types, keepLocalCopy } from '@react-native-documents/picker';
import { isSyncedAccount, isSyncedHolding } from '@kiko/holdings/deletable';
import { buildRateTable, guardedNetWorth } from '@kiko/rates/net-worth-view';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';
import EntityHeaderIcon from '@kiko/design-system/components/entity-header-icon';
import CurrencyBreakdown from '@kiko/design-system/components/currency-breakdown';
import { type FC, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import ReminderOfferCard from '@kiko/design-system/components/reminder-offer-card';
import EntityAmountHeader from '@kiko/design-system/components/entity-amount-header';
import { editBarItem, REMINDERS_BELL_SYMBOL } from '@kiko/design-system/edit-bar-item';
import { isConnectableBank, statementFormatIdForBank } from '@kiko/bank-sync/bank-catalog';
import { useCloseHoldingAction } from '@kiko/design-system/components/close-holding-sheet';

import { styles } from './account-detail.styles';
import BankSyncSection from './bank-sync-section';
import CryptoSyncSection from './crypto-sync-section';

const offerMessage = (kind: ReminderKind, t: TFunction): string =>
  match(kind)
    .with('statement_import', () => t('reminders.offer.statementImportMessage'))
    .with('add_transactions', () => t('reminders.offer.addTransactionsMessage'))
    .exhaustive();

type AccountDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountDetail'>;

// The header items are set before the account row loads, so the bell cannot
// wait on the row: the loaded account decides, else the route's kind hint, and
// with neither the bell is left out until the row loads.
const showsRemindersBell = (
  account: Pick<AccountRow, 'kind' | 'archivedAt'> | undefined,
  kindHint: AccountRow['kind'] | undefined,
): boolean =>
  foldMap(maybe(account), (found) => !isImplicitAccount(found)) ??
  foldMap(maybe(kindHint), (kind) => !isImplicitAccountKind(kind)) ??
  false;

// A bank account shows the connect/sync section when its bank can connect, or
// when it is ALREADY connected whatever its bank — so a legacy Monobank
// connection stored as Other bank (migration 0049) can still Sync and
// Disconnect.
const showsBankSync = (
  account: Pick<AccountRow, 'kind' | 'bankId' | 'institution'> | undefined,
): boolean =>
  foldMap(
    maybe(account),
    (found) => found.kind === 'bank' && (isConnectableBank(found.bankId) || isSyncedAccount(found)),
  ) ?? false;

// The tip lives in its own component so the screen's branching stays within the complexity
// budget; it is the screen's one `useTip`.
const ImportStatementTip: FC<{ eligible: boolean }> = ({ eligible }) => {
  const { t } = useTranslation();
  const { visible, dismiss } = useTip('accountDetail.importStatement', eligible);

  return (
    visible && (
      <TipCard
        testID="tip-import-statement"
        message={t('tips.importStatement')}
        closeLabel={t('tips.close')}
        onClose={dismiss}
      />
    )
  );
};

const AccountDetailScreen: FC<AccountDetailScreenProps> = ({ route, navigation }) => {
  const { accountId, name: initialName, kind: kindHint, reminderOffer, intent } = route.params;
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
  // The import tip shows only while the account has no transaction yet.
  const { data: anyRows, isLoading: anyLoading } = useLiveQuery(
    transactionsRepo.anyInAccountQuery(accountId),
    ['transactions', 'holdings'],
    true,
    { cached: true },
  );
  // kiko-architecture: skip the price_points read while nothing rendered on
  // this screen ever reads it — a holding whose type carries no priced spec
  // and is not a loan (`needsPriceBook`) never touches `price_points`. It
  // stays enabled while holdings are still on their first load, so the two
  // reads run in parallel instead of price_points waiting on holdings. Only a
  // loan reads the linked-payments half of the book.
  const { book: priceBook, isLoading: priceBookLoading } = useCurrentPriceBook(
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
    anyLoading,
    priceBookLoading,
  );
  const account = accounts.at(0);
  // The implicit property and debt accounts take no NEW reminders: their
  // holdings hold no ledger a reminder could ask the user to fill. Gated
  // here, not in `eligibleReminderKinds`, which also decides whether a
  // reminder an old merge left on such an account is still scheduled and
  // listed as active in Settings > Reminders.
  const isImplicit = account !== undefined && isImplicitAccount(account);
  const showsBell = showsRemindersBell(account, kindHint);
  // At most one offer per visit: once one is decided, clearing the import
  // param would otherwise fall back to the manual-entry offer at once.
  const [offerDecided, setOfferDecided] = useState(false);
  // After the page's own reads, so they queue first on op-sqlite's one worker;
  // above the loading gate, so a cached offer is there on the first ready frame.
  const offer = useReminderOffer({
    accountId,
    account,
    settings: settingsRows.at(0),
    trigger: offerDecided || isImplicit ? undefined : (reminderOffer ?? 'manualActivity'),
  });
  // "Set up" is the user's answer too, so the offer never returns, even when
  // the form is left unsaved. The form opens at once rather than wait on the
  // write, and a failed write only means one more offer later: not worth an
  // alert over the form.
  const acceptOffer = (kind: ReminderKind, recordDecision: () => Promise<void>): void => {
    setOfferDecided(true);
    navigation.navigate('ReminderForm', { accountId, kind });
    navigation.setParams({ reminderOffer: undefined });
    recordDecision().catch((error: unknown) =>
      logFailure('[reminders] offer decision not saved', error),
    );
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
  // An unrenamed implicit account stores an English sentinel, so the title
  // goes through `accountDisplayName` (the route's `name` is already that).
  const accountName =
    foldMap(maybe(account), (found) => accountDisplayName(found, t)) ?? initialName;
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
        // No bell for an implicit account: it takes no new reminders.
        ...(showsBell
          ? [
              {
                type: 'button' as const,
                label: t('reminders.rowLabel'),
                accessibilityLabel: t('reminders.rowLabel'),
                icon: { type: 'sfSymbol' as const, name: REMINDERS_BELL_SYMBOL },
                tintColor: theme.colors.textPrimary,
                sharesBackground: false,
                onPress: () => navigation.navigate('AccountReminders', { accountId }),
              },
            ]
          : []),
        editBarItem({
          label: t('common.edit'),
          tintColor: theme.colors.textPrimary,
          onPress: () => navigation.navigate('AccountForm', { accountId }),
        }),
      ],
    });
  }, [navigation, accountName, accountId, showsBell, t, theme.colors.textPrimary]);

  const activeHoldings = holdings.filter((holding) => holding.closedAt == null);

  const { closeActionFor, closeSheet } = useCloseHoldingAction(account);

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

  const { onDragStart, onActiveItemDropped, openUnlessLifted } = useGridLiftGuard();

  // A connected bank sync already writes every row of the account; a statement
  // of the same rows would land a second time under the import source.
  const canImportStatement = account?.kind === 'bank' && !isSyncedAccount(account);
  const isCryptoAccount = account?.kind === 'crypto';

  // Every bank account shows the connect/sync affordance independently — there
  // is no single-connection gate, so a second connection can connect
  // alongside the first (each binds its own per-account credential and cursor).
  // Gated on the account's picked bank being CONNECTABLE (the SAME
  // `bankCatalog` capability BankTypeField's picker already reads): an
  // import-only bank (e.g. PrivatBank) must show NO
  // sync/connect section, only the Import-statement footer button below. An
  // account with no bank picked yet (or one from before this feature)
  // defaults to connectable rather than guessing it is import-only; Other
  // bank is manual import only and never connectable.
  const showActionButton = showsBankSync(account);

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

    if (canImportStatement) {
      // either() captures a failed copy, which then leaves the page as it was, the same as after
      // the Import statement button.
      // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
      either(pickAndOpenStatement);
    }
  }, [intent, isReady, canImportStatement, navigation, pickAndOpenStatement]);

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
          <ImportStatementTip eligible={canImportStatement && anyRows.length === 0} />
          {canImportStatement && (
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
            onAccept={() => acceptOffer(offer.kind, offer.dismiss)}
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
              edge scroll the parent list. `sortEnabled` is off until the
              holdings query's own fresh read has applied — a drag persists
              the order of the rows on screen, never the cached
              (possibly one-read-old) order (kiko-architecture). A lone
              holding stays enabled: it lifts on a hold and drops back, like
              every other card. */}
          <Box testID="holdings-grid">
            <Sortable.Grid
              data={activeHoldings}
              sortEnabled={holdingsFresh}
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
                    // Read when the delete is requested, so it names what is stored
                    // now: a holding's rows can be one part of a movement with
                    // another holding, which the delete takes with it.
                    deleteMessage={() => removeHoldingsNoticeOf([item.id], t)}
                    onDelete={() => transactionsRepo.removeHolding(item.id)}
                    closeAction={closeActionFor(item)}
                  >
                    <HoldingCard
                      holding={item}
                      now={now}
                      baseCurrency={baseCurrency}
                      rateTable={rateTable}
                      priceBook={priceBook}
                      onOpen={openUnlessLifted(item.id, () =>
                        navigation.navigate('HoldingDetail', {
                          holdingId: item.id,
                          name: item.name,
                        }),
                      )}
                    />
                  </CardContextMenu>
                </Box>
              )}
              onDragStart={onDragStart}
              onActiveItemDropped={onActiveItemDropped}
              onDragEnd={({ fromIndex, toIndex, indexToKey }) =>
                onGridDragEnd({ fromIndex, toIndex, indexToKey }, holdingsRepo.reorder)
              }
            />
          </Box>

          {closeSheet}
        </Box>
      </Box>
    </Screen>
  );
};

export default AccountDetailScreen;
