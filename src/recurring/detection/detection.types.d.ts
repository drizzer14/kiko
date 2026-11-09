import type { Currency } from '@kiko/currency/currency';
import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';

// The picker's order. Detection finds only the three of `DetectedPeriod`; a mark adds the rest.
export type RecurringPeriod =
  | 'weekly'
  | 'monthly'
  | 'everyThreeMonths'
  | 'everySixMonths'
  | 'yearly';

export type DetectedPeriod = Extract<RecurringPeriod, 'weekly' | 'monthly' | 'yearly'>;

// The amount selects a chain of charges in this currency; the period is the user's word.
export type RecurringMark = {
  currency: Currency;
  amountMinorUnits: number;
  period: RecurringPeriod;
  // The row the mark was tapped on, kept in its chain; absent on every mark written before. Never
  // part of the mark's identity: `isSameChain`, the dedupe, `compareMarks` and the removal skip it.
  transactionId?: string;
};

export type Recurrence =
  | { kind: 'onDay'; day: number }
  | { kind: 'aroundDay'; day: number }
  | { kind: 'lastDay' }
  | { kind: 'onWeekday'; weekday: number }
  | { kind: 'onDate'; time: number }
  | { kind: 'marked' }
  | { kind: 'none' };

export type SeriesPart = { id: string; currency: Currency; chargeIds: readonly string[] };

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
  // Set only on a marked series: the stored marks of its chain.
  marks?: readonly RecurringMark[];
  // Set only on a marked series: the lowest and highest amount of its charges and stored amounts,
  // a lookup key that no line shows.
  markedSpan?: { lowest: number; highest: number };
  // Set only on a joined row (a card switch between currencies): its series, newest part first.
  parts?: readonly SeriesPart[];
};

export type Charge = {
  id: string;
  time: number;
  // The debit's absolute minor units.
  amount: number;
  source: RecurringLedgerRow['source'];
  holdingId: string;
  holdingName: string;
  description: string;
};

export type ChargeGroup = { key: string; currency: Currency; charges: Charge[] };

// The charges of the whole ledger by merchant key and currency, and the newest row of each holding
// (either sign) that a stopped series reads to tell a quiet card.
export type ChargeGroups = {
  groups: ReadonlyMap<string, ChargeGroup>;
  newestTimeByHoldingId: ReadonlyMap<string, number>;
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
