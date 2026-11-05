import type { Currency } from '@kiko/currency/currency';
import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';

export type RecurringPeriod = 'weekly' | 'monthly' | 'yearly';

export type Recurrence =
  | { kind: 'onDay'; day: number }
  | { kind: 'aroundDay'; day: number }
  | { kind: 'lastDay' }
  | { kind: 'onWeekday'; weekday: number }
  | { kind: 'onDate'; time: number }
  | { kind: 'none' };

export type RecurringSeries = {
  id: string;
  merchantKey: string;
  name: string;
  currency: Currency;
  period: RecurringPeriod;
  recurrence: Recurrence;
  // Newest first; a folded twin is not in it.
  chargeIds: string[];
  lastChargeTime: number;
  lastChargeAmountMinorUnits: number;
  lastChargeHoldingId: string;
  isStopped: boolean;
  // Set only on a stopped series: the newest row of its last charge's holding.
  quiet: { since: number; holdingName: string } | null;
};

export type RecurringLedgerRow = Pick<
  TransactionRow,
  | 'id'
  | 'holdingId'
  | 'amountMinorUnits'
  | 'time'
  | 'description'
  | 'mcc'
  | 'counterIban'
  | 'categorySetByHand'
  | 'setsBalance'
  | 'changeGroupId'
  | 'exchangePairId'
  | 'exchangeCounterpartHoldingId'
  | 'untrackedCounterpart'
  | 'loanHoldingId'
  | 'source'
>;

export type RecurringInput = {
  rows: readonly RecurringLedgerRow[];
  holdings: readonly Pick<HoldingRow, 'id' | 'accountId' | 'name' | 'currency' | 'metadata'>[];
  accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[];
};
