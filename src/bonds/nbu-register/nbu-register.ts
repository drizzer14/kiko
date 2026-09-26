import { guard } from 'fnts';
import { NBU_API_ENDPOINT } from '@env';

import { Money } from '../../currency/money';
import { type Currency, currencyOptions } from '../../currency/currency';
import type { BondCouponFrequency } from '../../holdings/holding-metadata';

/**
 * NBU's public, tokenless securities-register endpoint — the
 * same `bank.gov.ua` host (`NBU_API_ENDPOINT`)
 * `nbu-metals.ts`/`nbu-rates.ts`/`nbu-history.ts` already read. Deliberately
 * UNPINNED (`ios/Kiko/Info.plist`'s `NSPinnedDomains`), keyless, public: it
 * carries no credential.
 */
const REGISTER_ENDPOINT = `${NBU_API_ENDPOINT}/depo_securities?json`;

/**
 * One record of the register payload, trimmed to the fields
 * `toBondTerms` reads. The fixture keeps a
 * real `payments[]` array for realism, but this type does not declare it: a
 * later phase that reads exact coupon dates instead of the frequency
 * approximation adds its own type for that field then.
 */
type NbuRegisterRow = {
  cpcode: string;
  nominal: number;
  auk_proc: number;
  pgs_date: string;
  cpdescr: string;
  val_code: string;
  pay_period: number;
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
};

const isCurrency = (value: string): value is Currency =>
  (currencyOptions as readonly string[]).includes(value);

// [canonicalPayPeriodDays, frequency] — the register's observed `pay_period`
// values cluster around these four periods; `couponFrequencyFromPayPeriod`
// tolerates a ±5-day slack around each, the same way a banking-day-adjusted
// coupon date never lands on an exact calendar multiple.
const COUPON_BANDS: readonly [number, BondCouponFrequency][] = [
  [30, 'monthly'],
  [91, 'quarterly'],
  [182, 'semiannually'],
  [364, 'annually'],
];
const COUPON_BAND_SLACK_DAYS = 5;

/**
 * Maps a register `pay_period` (days between coupon payments) onto Kiko's
 * coarse `BondCouponFrequency` enum, or `null` when it falls outside every
 * known band — an irregular/one-off schedule the ISIN-mode form cannot
 * approximate, so it falls back to Manual mode with the known fields
 * pre-filled instead of guessing.
 */
export const couponFrequencyFromPayPeriod = (days: number): BondCouponFrequency | null => {
  const band = COUPON_BANDS.find(([period]) => Math.abs(days - period) <= COUPON_BAND_SLACK_DAYS);

  return band?.[1] ?? null;
};

const REGISTER_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses the register's `YYYY-MM-DD` date fields (`pgs_date`) as a
 * DEVICE-LOCAL midnight instant — NOT the `parseDateTimeSeconds`/UTC
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

/**
 * Maps one register row to `BondTerms`:
 * `nominal` -> `faceValueMinorUnits` through `Money.fromMajor` (an amount,
 * not a scaled decimal-string price/quantity, so no `decimalFromJsonNumber`
 * step is needed — the same parity every other P0 amount conversion
 * follows). A row with an unmodeled `val_code` or an unparseable
 * `pgs_date` is dropped rather than throwing, mirroring `nbu-metals.ts`'s
 * `toCurrentRate`.
 */
const toBondTerms = (row: NbuRegisterRow): BondTerms[] => {
  if (!isCurrency(row.val_code)) {
    return [];
  }

  const maturityDate = parseRegisterDate(row.pgs_date);

  if (maturityDate === null) {
    return [];
  }

  return [
    {
      isin: row.cpcode,
      currency: row.val_code,
      faceValueMinorUnits: Money.fromMajor(row.val_code, row.nominal).minorUnits,
      couponPct: row.auk_proc,
      maturityDate,
      couponFrequency: couponFrequencyFromPayPeriod(row.pay_period),
      name: `${row.cpdescr} ${row.cpcode}`,
    },
  ];
};

/**
 * Fetch NBU's full securities register and map every record to
 * `BondTerms`. `bondRegisterRepo.replaceAll` (`src/bonds/bond-register-repo/`)
 * writes the result into the `bond_register` cache wholesale.
 */
export const fetchNbuRegister = async (fetchImpl: typeof fetch = fetch): Promise<BondTerms[]> => {
  const response = await fetchImpl(REGISTER_ENDPOINT);
  const rows = await readRegister(response);

  return rows.flatMap(toBondTerms);
};
