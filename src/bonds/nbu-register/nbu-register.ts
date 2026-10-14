import { guard } from 'fnts';
import { match } from 'ts-pattern';
import { NBU_API_ENDPOINT } from '@env';
import {
  type BondPayment,
  bondCouponFrequencies,
  type BondCouponFrequency,
} from '@kiko/holdings/holding-metadata';
import { Money } from '@kiko/currency/money';
import { startOfLocalDay } from '@kiko/dates';
import { monthsPerCouponPeriod } from '@kiko/holdings/interest';
import { type Currency, currencyOptions, currencyScale } from '@kiko/currency/currency';
import { shiftDecimal, multiplyToDecimal, decimalFromJsonNumber } from '@kiko/currency/decimal';

/**
 * NBU's public, tokenless securities-register endpoint — the
 * same `bank.gov.ua` host (`NBU_API_ENDPOINT`)
 * `nbu-metals.ts`/`nbu-rates.ts`/`nbu-history.ts` already read. Deliberately
 * UNPINNED (`ios/Kiko/Info.plist`'s `NSPinnedDomains`), keyless, public: it
 * carries no credential.
 */
const REGISTER_ENDPOINT = `${NBU_API_ENDPOINT}/depo_securities?json`;

/**
 * One scheduled payment of a register record. `pay_type` is `1` for a coupon
 * and `2` for the redemption; the live payload has carried it both as a
 * string and as a number, so both are read.
 */
type NbuRegisterPayment = {
  pay_date: string;
  pay_type: string | number;
  pay_val: number;
};

/** One record of the register payload, trimmed to the fields `toBondTerms` reads. */
type NbuRegisterRow = {
  cpcode: string;
  nominal: number;
  auk_proc: number;
  pgs_date: string;
  cpdescr: string;
  val_code: string;
  pay_period: number;
  payments?: NbuRegisterPayment[];
};

/** The register's resolved terms for one bond ISIN — the ISIN-mode form's read shape. */
export type BondTerms = {
  isin: string;
  currency: Currency;
  faceValueMinorUnits: number;
  couponPct: number;
  maturityDate: number;
  couponFrequency: BondCouponFrequency | null;
  name: string;
  // Absent on a cache row written before payments were parsed, and on a
  // record with a malformed payment; a consumer then generates the schedule
  // from the coupon terms instead.
  payments?: BondPayment[];
};

const isCurrency = (value: string): value is Currency =>
  (currencyOptions as readonly string[]).includes(value);

// The register's observed `pay_period` values cluster around these four
// periods; `couponFrequencyFromPayPeriod` tolerates a ±5-day slack around
// each, the same way a banking-day-adjusted coupon date never lands on an
// exact calendar multiple.
const COUPON_PERIOD_DAYS: Record<BondCouponFrequency, number> = {
  monthly: 30,
  quarterly: 91,
  semiannually: 182,
  annually: 364,
};
const COUPON_BAND_SLACK_DAYS = 5;

/** The register's canonical days between two coupons of `frequency`. */
export const couponPeriodDays = (frequency: BondCouponFrequency): number =>
  COUPON_PERIOD_DAYS[frequency];

/**
 * Maps a register `pay_period` (days between coupon payments) onto Kiko's
 * coarse `BondCouponFrequency` enum, or `null` when it falls outside every
 * known band — an irregular/one-off schedule the ISIN-mode form cannot
 * approximate, so it falls back to Manual mode with the known fields
 * pre-filled instead of guessing.
 */
export const couponFrequencyFromPayPeriod = (days: number): BondCouponFrequency | null =>
  bondCouponFrequencies.find(
    (frequency) => Math.abs(days - COUPON_PERIOD_DAYS[frequency]) <= COUPON_BAND_SLACK_DAYS,
  ) ?? null;

const REGISTER_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses the register's `YYYY-MM-DD` date fields (`pgs_date`) as a
 * DEVICE-LOCAL midnight instant — NOT the `parseDateTimeSeconds`/Kyiv
 * convention a statement-import dedup key uses. `BondTerms.maturityDate`
 * feeds straight into `BondMeta.maturityDate`, and every consumer of that
 * field reads it through local-getter helpers — `startOfLocalDay`
 * (`src/holdings/holding-value/holding-value.ts`), `addMonths`/`midMonth`
 * (`src/holdings/interest/interest.ts`) — the same way the Manual bond
 * form itself writes a local instant (`holding-form.screen.tsx`). Parsing
 * this as UTC would silently shift the maturity date (and every coupon
 * date derived from it) back a day for any user west of UTC. Returns null
 * for anything not shaped like that pattern.
 */
const parseRegisterDate = (value: string): number | null => {
  const match = REGISTER_DATE_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;

  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
};

/**
 * Read an NBU register body, or throw on a non-ok response — a `guard`
 * validator/executor pair, matching `nbu-metals.ts`/`nbu-rates.ts`.
 */
const readRegister = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`NBU request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<NbuRegisterRow[]> => response.json(),
);

const paymentKind = (payType: string | number): BondPayment['kind'] | null =>
  match(String(payType))
    .with('1', () => 'coupon' as const)
    .with('2', () => 'redemption' as const)
    .otherwise(() => null);

const toBondPayment = (payment: NbuRegisterPayment): BondPayment | null => {
  const date = parseRegisterDate(payment.pay_date);
  const kind = paymentKind(payment.pay_type);
  const amount = decimalFromJsonNumber(payment.pay_val);

  if (date === null || kind === null || amount === null) {
    return null;
  }

  return { date, kind, amount };
};

/**
 * All-or-nothing, like `asLots`: keeping the valid rest of a schedule with
 * one malformed payment would silently drop a cash flow from every yield
 * computed on it, so the whole schedule is discarded instead.
 */
const toBondPayments = (payments: unknown): BondPayment[] | undefined => {
  if (!Array.isArray(payments)) {
    return undefined;
  }

  const parsed = payments.map(toBondPayment);

  return parsed.every((payment): payment is BondPayment => payment !== null) ? parsed : undefined;
};

// Four decimal places of a percent: exact for every register rate seen, and
// the float a `Number` parse of it gives prints back unchanged.
const COUPON_PERCENT_SCALE = 4;

/**
 * The rate of the next coupon not yet paid on `now`'s local day (a coupon
 * paid today counts as paid): its amount x payments per year / nominal,
 * through exact decimal math — `77 * 2 / 1000 * 100` in float is
 * `15.400000000000002`. Null when there is no such coupon, no known
 * frequency, or no positive nominal, so the caller falls back to the auction
 * rate (at refresh) or the cached coupon (at read time). A step-up bond
 * reads its CURRENT step this way, where `auk_proc` stays the first one.
 */
const nextCouponPct = (
  payments: readonly BondPayment[],
  frequency: BondCouponFrequency | null,
  nominal: string | null,
  now: number,
): number | null => {
  const todayStart = startOfLocalDay(now);
  const next = payments
    .filter((payment) => payment.kind === 'coupon' && payment.date > todayStart)
    .sort((first, second) => first.date - second.date)
    .at(0);

  if (frequency === null || nominal === null || next === undefined) {
    return null;
  }

  const paymentsPerYear = String(12 / monthsPerCouponPeriod(frequency));

  return Number(
    multiplyToDecimal([next.amount, paymentsPerYear, '100'], COUPON_PERCENT_SCALE, nominal),
  );
};

/**
 * Maps one register row to `BondTerms`:
 * `nominal` -> `faceValueMinorUnits` through `Money.fromMajor` (an amount,
 * not a scaled decimal-string price/quantity, so no `decimalFromJsonNumber`
 * step is needed — the same parity every other amount conversion
 * follows). A row with an unmodeled `val_code` or an unparseable
 * `pgs_date` is dropped rather than throwing, mirroring `nbu-metals.ts`'s
 * `toCurrentRate`.
 */
const toBondTerms = (row: NbuRegisterRow, now: number): BondTerms[] => {
  if (!isCurrency(row.val_code)) {
    return [];
  }

  const maturityDate = parseRegisterDate(row.pgs_date);

  if (maturityDate === null) {
    return [];
  }

  const payments = toBondPayments(row.payments);
  const frequency = couponFrequencyFromPayPeriod(row.pay_period);
  const nominal = row.nominal > 0 ? decimalFromJsonNumber(row.nominal) : null;

  return [
    {
      isin: row.cpcode,
      currency: row.val_code,
      faceValueMinorUnits: Money.fromMajor(row.val_code, row.nominal).minorUnits,
      couponPct: nextCouponPct(payments ?? [], frequency, nominal, now) ?? row.auk_proc,
      maturityDate,
      couponFrequency: frequency,
      name: `${row.cpdescr} ${row.cpcode}`,
      payments,
    },
  ];
};

/**
 * The coupon of cached `terms` as of `now`, not as of the refresh day that
 * wrote them: an offline phone must still move to a step-up bond's next step
 * on its date. The cached coupon when no coupon is left to pay. A stored
 * bond's kept schedule reads through here too, so the edit form shows the
 * same coupon the register terms would.
 */
export const currentCouponPct = (
  terms: Pick<
    BondTerms,
    'currency' | 'faceValueMinorUnits' | 'couponPct' | 'couponFrequency' | 'payments'
  >,
  now: number,
): number => {
  const nominal =
    terms.faceValueMinorUnits > 0
      ? shiftDecimal(String(terms.faceValueMinorUnits), -currencyScale[terms.currency])
      : null;

  return (
    nextCouponPct(terms.payments ?? [], terms.couponFrequency, nominal, now) ?? terms.couponPct
  );
};

/**
 * Fetch NBU's full securities register and map every record to
 * `BondTerms`, reading each coupon as of `now`.
 * `bondRegisterRepo.replaceAll` (`src/bonds/bond-register-repo/`)
 * writes the result into the `bond_register` cache wholesale.
 */
export const fetchNbuRegister = async (
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<BondTerms[]> => {
  const response = await fetchImpl(REGISTER_ENDPOINT);
  const rows = await readRegister(response);

  return rows.flatMap((row) => toBondTerms(row, now));
};
