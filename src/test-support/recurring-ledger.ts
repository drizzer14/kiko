import type {
  Recurrence,
  RecurringPeriod,
  RecurringSeries,
  RecurringLedgerRow,
} from '@kiko/recurring/detection';
import { match, P } from 'ts-pattern';
import { maxOf } from '@kiko/numbers';
import maybe, { foldMap } from 'fnts/maybe';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { merchantNameOf } from '@kiko/transactions/merchant-name';

type Random = () => number;
export type LedgerRow = RecurringLedgerRow;
export type Holding = Pick<HoldingRow, 'id' | 'accountId' | 'name' | 'currency' | 'metadata'>;
export type Account = Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>;
export type Currency = HoldingRow['currency'];
export type Ledger = { rows: LedgerRow[]; holdings: Holding[]; accounts: Account[] };
type LedgerExtras = { holdings?: readonly Holding[]; accounts?: readonly Account[] };

export type RecurrenceView =
  | Exclude<Recurrence, { kind: 'onDate' }>
  | { kind: 'onDate'; month: number; day: number };
export type ExpectedSeries = {
  period: RecurringPeriod;
  count: number;
  from?: string;
  currency?: Currency;
  recurrence?: RecurrenceView;
  isStopped?: boolean;
  quiet?: { since: number; holdingName: string };
  lastCharge?: number;
  name?: string;
};

type ChargeShape = {
  description?: string | undefined;
  holdingId?: string | undefined;
  source?: LedgerRow['source'] | undefined;
  overrides?: Partial<LedgerRow> | undefined;
};
type MonthlyShape = ChargeShape & {
  prefix?: string;
  // The newest month as [year, 1-based month]; Oct 2026 when absent.
  newest?: readonly [year: number, month: number];
  indexes?: readonly number[];
  without?: readonly number[];
  dayOf?: (index: number) => number;
  descriptionOf?: (index: number) => string;
  holdingOf?: (index: number) => string;
  hour?: number;
  minute?: number;
};
type WeeklyShape = ChargeShape & {
  prefix?: string;
  weeksBackOf?: (index: number) => number;
  hour?: number;
  minute?: number;
};
type AmountOf = number | ((index: number) => number);

const DEFAULT_CLOCK: readonly [hour: number, minute: number] = [10, 30];
// A date-only statement stores local noon.
const DATE_ONLY_CLOCK: readonly [hour: number, minute: number] = [12, 0];
const GROCERY_MCC = 5411;
const WEEK_DAYS = 7;
const MINUTE_MS = 60_000;

/** A local time; `month` is 1-based and `day` may overflow its month. */
export const at = (year: number, month: number, day: number, hour = 10, minute = 30): number =>
  new Date(year, month - 1, day, hour, minute).getTime();

export const nowOf = (): number => at(2026, 11, 3, 12, 0);

export const dayKeyOf = (time: number): number => {
  const date = new Date(time);

  return date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate();
};

export const rangeOf = (start: number, end: number): number[] =>
  Array.from({ length: end - start }, (_unused, offset) => start + offset);

const clockOf = (source: LedgerRow['source']): readonly [number, number] =>
  source === 'import' ? DATE_ONLY_CLOCK : DEFAULT_CLOCK;

/** A debit of `amount` major units; a negative amount is a credit. */
export const chargeOf = (
  id: string,
  time: number,
  amount: number,
  shape: ChargeShape = {},
): LedgerRow => ({
  id,
  holdingId: shape.holdingId ?? 'card',
  amountMinorUnits: -Math.round(amount * 100),
  time,
  description: shape.description ?? 'Netflix',
  mcc: GROCERY_MCC,
  counterIban: null,
  categorySetByHand: false,
  setsBalance: false,
  changeGroupId: null,
  exchangePairId: null,
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  loanHoldingId: null,
  source: shape.source ?? 'monobank',
  ...shape.overrides,
});

const daysInMonthOf = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

const amountAt = (amount: AmountOf, index: number): number =>
  typeof amount === 'function' ? amount(index) : amount;

/**
 * `count` charges on `day`, the newest in the newest month and one month back each; a day past a
 * month's end clamps. Ids are `<prefix>-<index>`, the newest index 0.
 */
export const monthly = (
  count: number,
  day: number,
  amount: AmountOf,
  shape: MonthlyShape = {},
): LedgerRow[] => {
  const [year, month] = shape.newest ?? [2026, 10];
  const source = shape.source ?? 'monobank';
  const [defaultHour, defaultMinute] = clockOf(source);

  return (shape.indexes ?? rangeOf(0, count))
    .filter((index) => !(shape.without ?? []).includes(index))
    .map((index) => {
      const monthIndex = month - 1 - index;
      const monthDay = Math.min(shape.dayOf?.(index) ?? day, daysInMonthOf(year, monthIndex));
      const time = new Date(
        year,
        monthIndex,
        monthDay,
        shape.hour ?? defaultHour,
        shape.minute ?? defaultMinute,
      ).getTime();

      return chargeOf(`${shape.prefix ?? 'charge'}-${index}`, time, amountAt(amount, index), {
        description: shape.descriptionOf?.(index) ?? shape.description,
        holdingId: shape.holdingOf?.(index) ?? shape.holdingId,
        source,
        overrides: shape.overrides,
      });
    });
};

/** `count` charges seven local days apart, the newest on `[year, month, day]`. */
export const weekly = (
  count: number,
  [year, month, day]: readonly [year: number, month: number, day: number],
  amount: AmountOf,
  shape: WeeklyShape = {},
): LedgerRow[] =>
  rangeOf(0, count).map((index) => {
    const weeksBack = shape.weeksBackOf?.(index) ?? index;
    const [defaultHour, defaultMinute] = clockOf(shape.source ?? 'monobank');
    const time = at(
      year,
      month,
      day - WEEK_DAYS * weeksBack,
      shape.hour ?? defaultHour,
      shape.minute ?? defaultMinute,
    );

    return chargeOf(`${shape.prefix ?? 'charge'}-${index}`, time, amountAt(amount, index), shape);
  });

export const holdingOf = (
  id: string,
  currency: Currency = 'UAH',
  accountId = 'bank-account',
  metadata: unknown = null,
): Holding => ({ id, accountId, name: id, currency, metadata });

export const bankAccountOf = (id: string): Account => ({ id, kind: 'bank', archivedAt: null });

export const ledgerOf = (rows: readonly LedgerRow[], extras: LedgerExtras = {}): Ledger => ({
  rows: [...rows],
  holdings: [holdingOf('card'), holdingOf('card2'), ...(extras.holdings ?? [])],
  accounts: [bankAccountOf('bank-account'), ...(extras.accounts ?? [])],
});

export const CRYPTO_EXTRAS: Required<LedgerExtras> = {
  holdings: [holdingOf('usdt', 'USDT', 'crypto-account')],
  accounts: [{ id: 'crypto-account', kind: 'crypto', archivedAt: null }],
};

/** The exchange purchases that a P2P matcher pairs with each debit, `delayMs` after it. */
export const fundingPurchasesOf = (debits: readonly LedgerRow[], delayMs: number): LedgerRow[] =>
  debits.map((debit) =>
    chargeOf(`purchase-${debit.id}`, debit.time + delayMs, -99_900_000, {
      description: 'USDT',
      holdingId: 'usdt',
      source: 'binance',
      overrides: {
        untrackedCounterpart: `p2p:UAH:${(-debit.amountMinorUnits / 100).toFixed(2)}`,
      },
    }),
  );

const compareText = (left: string, right: string): number =>
  Number(left > right) - Number(left < right);

const idPrefixOf = (id: string): string => id.replace(/-[^-]*$/, '');

const recurrenceViewOf = (recurrence: Recurrence): RecurrenceView =>
  match(recurrence)
    .with({ kind: 'onDate' }, ({ time }) => ({
      kind: 'onDate' as const,
      month: new Date(time).getMonth() + 1,
      day: new Date(time).getDate(),
    }))
    .with(
      { kind: P.union('onDay', 'aroundDay', 'lastDay', 'onWeekday', 'marked', 'none') },
      (other) => other,
    )
    .exhaustive();

/** Every instant a series carries: its last charge, its quiet date and a yearly date. */
export const timesOf = (series: RecurringSeries): number[] => [
  series.lastChargeTime,
  ...(foldMap(maybe(series.quiet), ({ since }) => [since]) ?? []),
  ...match(series.recurrence)
    .with({ kind: 'onDate' }, ({ time }) => [time])
    .otherwise(() => []),
];

const viewOf = (series: RecurringSeries) => ({
  from: [...new Set(series.chargeIds.map(idPrefixOf))].sort().join('+'),
  period: series.period,
  count: series.chargeIds.length,
  currency: series.currency,
  recurrence: recurrenceViewOf(series.recurrence),
  isStopped: series.isStopped,
  quiet: series.quiet,
  lastChargeTime: series.lastChargeTime,
  name: series.name,
});

type SeriesView = ReturnType<typeof viewOf>;

const byOrder = (left: SeriesView, right: SeriesView): number =>
  compareText(left.from, right.from) ||
  compareText(left.period, right.period) ||
  left.count - right.count;

export const viewsOf = (series: readonly RecurringSeries[]): SeriesView[] =>
  series.map(viewOf).sort(byOrder);

/** What a series reads as on its local days, so builds in two device zones compare. */
export const dayViewsOf = (series: readonly RecurringSeries[]) =>
  viewsOf(series).map(({ lastChargeTime, quiet, ...rest }) => ({
    ...rest,
    lastChargeDay: dayKeyOf(lastChargeTime),
    quiet:
      foldMap(maybe(quiet), ({ since, holdingName }) => ({
        since: dayKeyOf(since),
        holdingName,
      })) ?? null,
  }));

/** The expectation, with every field a world leaves unstated left open. */
export const expectedViewsOf = (expected: readonly ExpectedSeries[]) =>
  [...expected]
    .sort(
      (left, right) =>
        compareText(left.from ?? '', right.from ?? '') ||
        compareText(left.period, right.period) ||
        left.count - right.count,
    )
    .map((entry) => ({
      from: entry.from ?? expect.anything(),
      period: entry.period,
      count: entry.count,
      currency: entry.currency ?? 'UAH',
      recurrence: entry.recurrence ?? expect.anything(),
      isStopped: entry.isStopped ?? false,
      quiet: entry.quiet ?? null,
      lastChargeTime: entry.lastCharge ?? expect.anything(),
      name: entry.name ?? expect.anything(),
    }));

const groupedBy = <Entry>(
  entries: readonly Entry[],
  keyOf: (entry: Entry) => string,
): Map<string, Entry[]> =>
  entries.reduce((groups, entry) => {
    const key = keyOf(entry);

    return groups.set(key, [...(groups.get(key) ?? []), entry]);
  }, new Map<string, Entry[]>());

/** An amount that steps down as the index passes each bound, `rest` after the last. */
export const steppedAmount = (
  index: number,
  steps: readonly (readonly [until: number, amount: number])[],
  rest: number,
): number => steps.find(([until]) => index < until)?.[1] ?? rest;

const shiftedDayKeyOf = (time: number, shiftDays: number): number => {
  const date = new Date(time);

  date.setDate(date.getDate() + shiftDays);

  return dayKeyOf(date.getTime());
};

/**
 * For each day and amount of a series' charges with no same-amount row a day away, the charges
 * the series kept and the largest count of one source among all rows of that merchant.
 */
export const foldBucketsOf = (
  ledger: Ledger,
  series: RecurringSeries,
): { kept: number; largestOfOneSource: number }[] => {
  const currencyOfHolding = new Map(ledger.holdings.map(({ id, currency }) => [id, currency]));
  const bucketOf = (row: LedgerRow, shiftDays = 0): string =>
    [
      merchantNameOf(row.description).key,
      currencyOfHolding.get(row.holdingId),
      shiftedDayKeyOf(row.time, shiftDays),
      row.amountMinorUnits,
    ].join('|');
  const rowsByBucket = groupedBy(ledger.rows, (row) => bucketOf(row));
  const rowById = new Map(ledger.rows.map((row) => [row.id, row]));
  const kept = groupedBy(
    series.chargeIds.flatMap((id) => rowById.get(id) ?? []),
    (row) => bucketOf(row),
  );

  return [...kept]
    .filter(([, [sample]]) => [-1, 1].every((shift) => !rowsByBucket.has(bucketOf(sample, shift))))
    .map(([bucket, keptRows]) => ({
      kept: keptRows.length,
      largestOfOneSource: maxOf(
        [...groupedBy(rowsByBucket.get(bucket) ?? [], ({ source }) => source).values()].map(
          (rows) => rows.length,
        ),
      ),
    }));
};

export const shuffled = <Entry>(entries: readonly Entry[], random: Random): Entry[] =>
  entries
    .map((entry) => ({ entry, order: random() }))
    .sort((left, right) => left.order - right.order)
    .map(({ entry }) => entry);

const SUBSCRIPTION_NAMES = [
  'Netflix',
  'Apple',
  'Spotify',
  'ATB 0212',
  'ATB 0340',
  'Silpo Market 12',
];
const SHOP_NAMES = ['Silpo', 'Uklon', 'Rozetka', 'Fora', 'Aroma Kava', 'Epicentr', 'Wolt'];
const HOLDING_IDS = ['card', 'card2', 'usd'];
const SOURCES: readonly LedgerRow['source'][] = ['monobank', 'monobank', 'manual', 'import'];
const TWIN_SHARE = 0.3;
const DOUBLE_SHARE = 0.1;
const JITTER_SHARE = 0.2;
const CREDIT_SHARE = 0.15;

const RANDOM_EXTRAS: LedgerExtras = { holdings: [holdingOf('usd', 'USD')] };

const localNoonOf = (time: number): number => {
  const date = new Date(time);

  return at(date.getFullYear(), date.getMonth() + 1, date.getDate(), ...DATE_ONLY_CLOCK);
};

/**
 * A ledger of a few monthly merchants (some moved, some twinned, some doubled, some dated after
 * today) among noise, with rows before, on and after today, and credits.
 */
export const randomLedgerOf = (random: Random): Ledger => {
  const between = (low: number, high: number): number =>
    low + Math.floor(random() * (high - low + 1));
  const pick = <Entry>(entries: readonly Entry[]): Entry =>
    entries[between(0, entries.length - 1)] as Entry;

  const merchants = Array.from({ length: between(2, 4) }, () => {
    const price = between(50, 900);
    const wobbles = random() < 0.5;
    const day = between(1, 31);

    return monthly(between(3, 14), day, () => (wobbles ? price + between(0, price / 10) : price), {
      newest: [2026, 11 + between(-6, 1)],
      description: pick(SUBSCRIPTION_NAMES),
      holdingId: pick(HOLDING_IDS),
      dayOf: () => Math.max(1, random() < JITTER_SHARE ? day + between(-2, 2) : day),
    });
  }).flat();

  const withSources = merchants.flatMap((row) => {
    const source = pick(SOURCES);
    const own = { ...row, source, time: source === 'import' ? localNoonOf(row.time) : row.time };
    const twins =
      source !== 'import' && random() < TWIN_SHARE
        ? [{ ...own, id: `${row.id}-twin`, source: 'import' as const, time: localNoonOf(row.time) }]
        : [];
    const doubles =
      random() < DOUBLE_SHARE
        ? [{ ...own, id: `${row.id}-double`, time: own.time + MINUTE_MS }]
        : [];

    return [own, ...twins, ...doubles];
  });

  const noise = Array.from({ length: between(10, 40) }, (_unused, index) =>
    chargeOf(
      `noise-${index}`,
      at(2026, 11, 3 + between(-700, 40), between(0, 23), between(0, 59)),
      random() < CREDIT_SHARE ? -between(20, 3000) : between(20, 3000),
      { description: pick(SHOP_NAMES), holdingId: pick(HOLDING_IDS), source: pick(SOURCES) },
    ),
  );

  const aroundToday = [
    chargeOf('today-early', at(2026, 11, 3, 0, 10), between(20, 900), {
      description: pick(SHOP_NAMES),
    }),
    chargeOf('today-late', at(2026, 11, 3, 23, 50), between(20, 900), {
      description: pick(SHOP_NAMES),
      source: 'manual',
    }),
    chargeOf('tomorrow', at(2026, 11, 4, 0, 10), between(20, 900), {
      description: pick(SHOP_NAMES),
      source: 'manual',
    }),
    chargeOf('next-month', at(2026, 12, 3), between(20, 900), {
      description: pick(SHOP_NAMES),
      source: 'manual',
    }),
  ];

  return ledgerOf(
    [...withSources, ...noise, ...aroundToday].map((row, index) => ({
      ...row,
      id: `row-${index}`,
    })),
    RANDOM_EXTRAS,
  );
};
