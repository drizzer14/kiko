import { useMemo } from 'react';
import { match } from 'ts-pattern';
import {
  type DetectedPeriod,
  type RecurringInput,
  chargeGroupsOf,
  groupKeyOf,
} from '@kiko/recurring/detection';
import maybe, { foldMap } from 'fnts/maybe';
import { startOfLocalDay } from '@kiko/dates';
import { settingsRepo } from '@kiko/settings';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { type TransactionRow, useLiveQuery } from '@kiko/db';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { markedChainOfAmount } from '@kiko/recurring/marked-series';
import { rowDetectionOf, rowRecurrenceFromDetection } from '@kiko/recurring/row-recurrence';

type RowMark = {
  chain: ReturnType<typeof markedChainOfAmount>;
  detectedPeriod: DetectedPeriod | null;
  isReady: boolean;
};

type Read = { isLoading: boolean; error?: Error };

// A read turned off keeps the `error` it last held, so only an enabled read can hold the field.
const isSettled = (read: Read, isEnabled: boolean): boolean =>
  !isEnabled || (!read.isLoading && read.error === undefined);

/**
 * The marked chain a stored debit sits in, and the period of the detected series it sits in, for
 * the transaction form's mark field. The settings read runs only for a row the form offers. The
 * whole-ledger read runs for every offered row once the settings have settled, except under a
 * hidden name with no mark in this currency, which shows "Not marked" whatever the ledger holds.
 * The ledger lands after the settings, so `isReady` is false until both have settled, and a
 * rejected read holds it false until a later good fire: the field must not read "Not marked" on
 * rows it never got.
 *
 * Detection runs on the row's own group, once per ledger fire. A hide or a mark write is a settings
 * fire and only reads that result against the new choices, so it runs no detection.
 */
export const useRowMark = (
  row: Pick<TransactionRow, 'id' | 'amountMinorUnits' | 'description'>,
  currency: Currency,
  isOffered: boolean,
  holdings: RecurringInput['holdings'],
  accounts: RecurringInput['accounts'],
): RowMark => {
  const key = merchantNameOf(row.description).key;
  const settings = useLiveQuery(
    settingsRepo.recurringMerchantChoicesQuery(),
    ['settings'],
    isOffered,
  );
  const choices = useMemo(
    () => settingsRepo.recurringMerchantChoicesOf(settings.data.at(0)?.recurringMerchantChoices),
    [settings.data],
  );
  const marks = useMemo(() => choices.get(key)?.marks ?? [], [choices, key]);
  const isHiddenWithoutMark =
    choices.get(key)?.hidden === true && !marks.some((mark) => mark.currency === currency);
  const isSettingsSettled = isSettled(settings, isOffered);
  const readsLedger = isOffered && isSettingsSettled && !isHiddenWithoutMark;
  const ledger = useLiveQuery(
    transactionsRepo.recurringLedgerQuery(),
    ['transactions'],
    readsLedger,
  );
  const isReady = isSettingsSettled && isSettled(ledger, readsLedger);
  const today = startOfLocalDay(Date.now());
  const detection = useMemo(
    () =>
      readsLedger && isReady
        ? rowDetectionOf({
            chargeGroups: chargeGroupsOf({ rows: ledger.data, holdings, accounts }, today),
            key,
            currency,
            today,
          })
        : undefined,
    [readsLedger, isReady, ledger.data, holdings, accounts, today, key, currency],
  );
  const chain = useMemo(
    () =>
      markedChainOfAmount(
        (detection?.chargeGroups.groups.get(groupKeyOf(key, currency))?.charges ?? []).map(
          ({ amount }) => ({ amountMinorUnits: amount }),
        ),
        marks,
        Math.abs(row.amountMinorUnits),
        currency,
      ),
    [detection, key, currency, marks, row.amountMinorUnits],
  );
  const detectedPeriod = useMemo(
    () =>
      foldMap(maybe(detection), (found) =>
        match(rowRecurrenceFromDetection(found, { key, rowId: row.id, choices, today }))
          .with({ kind: 'detected' }, ({ period }) => period)
          .otherwise(() => null),
      ) ?? null,
    [detection, key, row.id, choices, today],
  );

  return { chain, detectedPeriod, isReady };
};
