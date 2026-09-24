import { guard } from 'fnts';

import { type Currency, currencyOptions } from '../../currency/currency';
import { Money } from '../../currency/money';
import type { BondCouponFrequency } from '../../holdings/holding-metadata';

/**
 * NBU's public, tokenless securities-register endpoint (spec 6.1) — the
 * same `bank.gov.ua` host `nbu-metals.ts`/`nbu-rates.ts`/`nbu-history.ts`
 * already read. Deliberately UNPINNED (`ios/Kiko/Info.plist`'s
 * `NSPinnedDomains`), keyless, public: it carries no credential.
 */
const REGISTER_ENDPOINT = 'https://bank.gov.ua/depo_securities?json';

/**
 * One record of the register payload, trimmed to the fields
 * `toBondTerms` reads (spec 6.2's field-mapping table) plus `payments`,
 * kept for realism though not yet consumed (a later phase reads it for
 * exact coupon dates instead of the frequency approximation).
 */
type NbuRegisterRow = {
  cpcode: string;
  nominal: number;
  auk_proc: number;
  pgs_date: string;
  cpdescr: string;
  val_code: string;
  pay_period: number;
  payments?: { pay_date: string; pay_type: string; pay_val: number }[];
};

/** The register's resolved terms for one bond ISIN — the ISIN-mode form's read shape (spec 6.3). */
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
// values cluster around these four periods (spec 6.2); `couponFrequencyFromPayPeriod`
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
 * pre-filled instead of guessing (spec 6.2).
 */
export const couponFrequencyFromPayPeriod = (days: number): BondCouponFrequency | null => {
  const band = COUPON_BANDS.find(([period]) => Math.abs(days - period) <= COUPON_BAND_SLACK_DAYS);

  return band?.[1] ?? null;
};

const REGISTER_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses the register's `YYYY-MM-DD` date fields (`pgs_date`) as a UTC
 * wall-clock instant — the same "read a wall-clock date as UTC" convention
 * `parseDateTimeSeconds` uses for a statement date, so a bond's maturity
 * date never drifts a calendar day against the device's own timezone.
 * Returns null for anything not shaped like that pattern.
 */
const parseRegisterDate = (value: string): number | null => {
  const match = REGISTER_DATE_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;

  return Date.UTC(Number(year), Number(month) - 1, Number(day));
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
 * Maps one register row to `BondTerms` (spec 6.2's field-mapping table):
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
 * Fetch NBU's full securities register (spec 6.1) and map every record to
 * `BondTerms`. `bondRegisterRepo.replaceAll` (`src/bonds/bond-register-repo/`)
 * writes the result into the `bond_register` cache wholesale.
 */
export const fetchNbuRegister = async (fetchImpl: typeof fetch = fetch): Promise<BondTerms[]> => {
  const response = await fetchImpl(REGISTER_ENDPOINT);
  const rows = await readRegister(response);

  return rows.flatMap(toBondTerms);
};
