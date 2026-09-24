import { asLots, type Lot } from '../lots';

export type CompoundingFrequency = 'bi-weekly' | 'monthly' | 'quarterly' | 'annually';

export type DepositContribution = { amountMinorUnits: number; date: number };

export type TermDepositMeta = {
  contributions: DepositContribution[];
  annualRatePct: number;
  termMonths: number;
  recapitalization: boolean;
  compounding: CompoundingFrequency;
};

export type BondKind = 'government' | 'corporate';

export type BondCouponFrequency = 'monthly' | 'quarterly' | 'semiannually' | 'annually';

export type BondMeta = {
  quantity: number;
  faceValueMinorUnits: number;
  couponPct: number;
  purchaseDate: number;
  purchasePriceMinorUnits: number;
  maturityDate: number;
  bondKind: BondKind;
  couponFrequency: BondCouponFrequency;
  // The ISIN the bond was added under (T25's ISIN-mode form), or `undefined`
  // for a Manual-mode bond that never carried one (including every bond
  // saved before T25). Once saved it never depends on the register again
  // (spec 6.4 #5) — this is purely a record of how the holding was added,
  // re-shown editable in edit mode's Manual view (spec 6.4 #6).
  isin?: string;
};

const frequencies = new Set<string>(['bi-weekly', 'monthly', 'quarterly', 'annually']);

// Legacy deposits stored a now-removed 'daily' compounding option. Map any such
// record onto 'monthly' — the safe, conservative choice: it is an existing,
// well-tested calendar-anniversary mode that yields slightly LESS than the new
// default 'bi-weekly', so a migrated deposit never over-reports its value, and
// it avoids retro-fitting an opening-day anchor the record never carried.
const normalizeCompounding = (value: string): CompoundingFrequency =>
  value === 'daily' ? 'monthly' : (value as CompoundingFrequency);

const bondCouponFrequencies = new Set<string>(['monthly', 'quarterly', 'semiannually', 'annually']);

const asBondCouponFrequency = (value: unknown): BondCouponFrequency =>
  typeof value === 'string' && bondCouponFrequencies.has(value)
    ? (value as BondCouponFrequency)
    : 'annually';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * The metadata fields that mark a holding as owned by a sync, one per
 * source: `monobankId` (a Monobank card/jar), `walletAddress` (a BTC
 * public-address wallet), `binanceAsset` (a Binance spot balance). The
 * single source of truth for `isSyncedHolding` and for the metadata-key
 * upserts in the holdings repo.
 *
 * Guideline 5.6 remediation: `privatbankId`, `bunqId`, and `starlingId` were
 * removed — those bank-CONNECT providers were deleted entirely, and no user
 * release ever shipped a holding with one of those keys.
 */
export const syncedMetadataFields = ['monobankId', 'walletAddress', 'binanceAsset'] as const;

export type SyncedMetadataField = (typeof syncedMetadataFields)[number];

/** The balance-provider subset — everything but Monobank. */
export type ExchangeMetadataField = Exclude<SyncedMetadataField, 'monobankId'>;

/**
 * Written by a balance sync next to the provider key. It lives on the holding
 * (not `settings.lastSyncAt`) because Monobank's `lastSyncAt` doubles as the
 * statement-window cursor of the next Monobank import — a balance sync
 * touching it would silently skip Monobank transactions.
 */
export const SYNCED_AT_FIELD = 'syncedAt';

// The two stored shapes a balance sync writes (see the spec's "Data model"):
//   wallet:  { walletAddress: string; syncedAt: number }
//   Binance: { binanceAsset: 'BTC'; syncedAt: number }
// Read back through the two readers below; no separate type alias is exported
// (Knip flags an export nothing imports).

export const walletAddressOf = (metadata: unknown): string | undefined => {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const { walletAddress } = metadata;

  return typeof walletAddress === 'string' ? walletAddress : undefined;
};

/**
 * The IBAN a Monobank card sync writes next to its `monobankId` (see
 * `mapAccountToHolding` in monobank/sync.ts). Read back so the category chart
 * can build the set of the user's OWN card IBANs and tell an own-account
 * transfer from a genuine P2P payment. `undefined` when absent (jars, manual
 * holdings, crypto).
 */
export const ibanOf = (metadata: unknown): string | undefined => {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const { iban } = metadata;

  return typeof iban === 'string' ? iban : undefined;
};

export const syncedAtOf = (metadata: unknown): number | null => {
  if (!isRecord(metadata)) {
    return null;
  }

  const syncedAt = metadata[SYNCED_AT_FIELD];

  return isNumber(syncedAt) ? syncedAt : null;
};

const asContribution = (value: unknown): DepositContribution | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { amountMinorUnits, date } = value;
  if (!isNumber(amountMinorUnits) || !isNumber(date)) {
    return null;
  }

  return { amountMinorUnits, date };
};

const readContributions = (value: Record<string, unknown>): DepositContribution[] | null => {
  const { contributions, principalMinorUnits, startDate } = value;
  if (Array.isArray(contributions)) {
    const parsed = contributions.map(asContribution);
    if (parsed.length > 0 && parsed.every((c): c is DepositContribution => c !== null)) {
      return [...parsed].sort((a, b) => a.date - b.date);
    }

    return null;
  }
  if (isNumber(principalMinorUnits) && isNumber(startDate)) {
    return [{ amountMinorUnits: principalMinorUnits, date: startDate }];
  }

  return null;
};

export const asTermDepositMeta = (value: unknown): TermDepositMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { annualRatePct, termMonths, recapitalization, compounding } = value;
  const contributions = readContributions(value);
  // Accept the legacy 'daily' literal so existing deposits still parse; it is
  // normalized to 'monthly' below rather than rejected.
  if (
    contributions === null ||
    !isNumber(annualRatePct) ||
    !isNumber(termMonths) ||
    typeof recapitalization !== 'boolean' ||
    typeof compounding !== 'string' ||
    !(frequencies.has(compounding) || compounding === 'daily')
  ) {
    return null;
  }

  return {
    contributions,
    annualRatePct,
    termMonths,
    recapitalization,
    compounding: normalizeCompounding(compounding),
  };
};

export const asBondMeta = (value: unknown): BondMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { quantity, faceValueMinorUnits, couponPct, purchaseDate, maturityDate, bondKind, isin } =
    value;
  if (
    !isNumber(quantity) ||
    !isNumber(faceValueMinorUnits) ||
    !isNumber(couponPct) ||
    !isNumber(purchaseDate) ||
    !isNumber(maturityDate)
  ) {
    return null;
  }
  // `purchasePriceMinorUnits` is the total actually paid (separate from nominal
  // = quantity * faceValue). Legacy bonds predate this field; default it to the
  // nominal so the purchase ledger entry and expected-profit both read as
  // break-even until the user edits the real price in.
  const nominalMinorUnits = quantity * faceValueMinorUnits;
  const { purchasePriceMinorUnits } = value;

  return {
    quantity,
    faceValueMinorUnits,
    couponPct,
    purchaseDate,
    purchasePriceMinorUnits: isNumber(purchasePriceMinorUnits)
      ? purchasePriceMinorUnits
      : nominalMinorUnits,
    maturityDate,
    bondKind: bondKind === 'corporate' ? 'corporate' : 'government',
    couponFrequency: asBondCouponFrequency(value.couponFrequency),
    isin: typeof isin === 'string' ? isin : undefined,
  };
};

// The closed set of `property_item` categories (T13). A `const` tuple, per
// kiko-code-style: the derived union type sits directly after it, and
// membership is tested on the tuple itself rather than a parallel `Set` —
// this set is small, so a second runtime structure would be redundant.
// Exported (T16): the property-section form reads it directly to build its
// category ChipRow's `options`.
export const propertyCategories = [
  'real_estate',
  'vehicle',
  'valuable',
  'loan_given',
  'business_share',
  'other',
] as const;

export type PropertyCategory = (typeof propertyCategories)[number];

const isPropertyCategory = (value: unknown): value is PropertyCategory =>
  typeof value === 'string' && (propertyCategories as readonly string[]).includes(value);

export type PropertyMeta = {
  category: PropertyCategory;
  lots: Lot[];
};

export const asPropertyMeta = (value: unknown): PropertyMeta | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { category, lots } = value;
  const parsedLots = asLots(lots);

  if (!isPropertyCategory(category) || parsedLots === null) {
    return null;
  }

  return { category, lots: parsedLots };
};

// The closed set of precious metals Kiko prices via NBU (T17), keyed by the
// same slug `metalInstrument` namespaces its `price_points.instrument` under
// (`metal:<XAU|XAG|XPT|XPD>` — `src/prices/instrument/`). Exported so a
// future metal-section form (T20) can build its metal ChipRow's `options`
// directly, mirroring `propertyCategories`.
export const preciousMetals = ['XAU', 'XAG', 'XPT', 'XPD'] as const;

export type Metal = (typeof preciousMetals)[number];

const isMetal = (value: unknown): value is Metal =>
  typeof value === 'string' && (preciousMetals as readonly string[]).includes(value);

// How the metal is physically held. Exported for the same T20 ChipRow reason
// as `preciousMetals` above.
export const metalForms = ['bar', 'coin', 'bank_account'] as const;

export type MetalForm = (typeof metalForms)[number];

const isMetalForm = (value: unknown): value is MetalForm =>
  typeof value === 'string' && (metalForms as readonly string[]).includes(value);

// The unit a lot's `quantityDelta` is denominated in. 'g' values convert to
// troy ounces (the unit NBU quotes against) via the fixed constant
// `priced-value.ts` multiplies by; 'oz' needs no conversion.
export const metalUnits = ['g', 'oz'] as const;

export type MetalUnit = (typeof metalUnits)[number];

const isMetalUnit = (value: unknown): value is MetalUnit =>
  typeof value === 'string' && (metalUnits as readonly string[]).includes(value);

// A plain (unsigned) decimal string, matching the `quantityDelta`/`purity`
// money-precision rule (kiko-domain): a scaled decimal STRING, never a
// `number`, so an arbitrary-precision purity fraction never drifts through
// float math. Unlike `lots.ts`'s `SIGNED_DECIMAL_PATTERN`, a purity can never
// be negative, so no leading '-' is accepted.
const PLAIN_DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

const isPlainDecimalString = (value: unknown): value is string =>
  typeof value === 'string' && PLAIN_DECIMAL_PATTERN.test(value);

export type MetalMeta = {
  metal: Metal;
  form: MetalForm;
  unit: MetalUnit;
  purity: string;
  lots: Lot[];
};

export const asMetalMeta = (value: unknown): MetalMeta | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { metal, form, unit, purity, lots } = value;
  const parsedLots = asLots(lots);

  if (
    !isMetal(metal) ||
    !isMetalForm(form) ||
    !isMetalUnit(unit) ||
    !isPlainDecimalString(purity) ||
    parsedLots === null
  ) {
    return null;
  }

  return { metal, form, unit, purity, lots: parsedLots };
};
