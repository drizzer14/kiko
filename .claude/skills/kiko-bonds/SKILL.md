---
name: kiko-bonds
description: Invoke whenever you touch src/bonds/**, src/screens/forms/holding-form/bond/**, src/holdings/holding-descriptor/bond/**, or work on a bond holding, an ISIN, the NBU securities register and its `bond_register` cache, bond coupons (the step-up schedule, `BondMeta.payments`), the bond purchase price, or the yield to maturity. Read before writing a bond form field, an ISIN check, a register fetch or backfill, or a coupon or yield read. For the Money value object, the holding schema and every shared amount rule see kiko-domain; for the price series and `dayKeyOf` see kiko-pricing; for the form and screen patterns see kiko-architecture.
---

# Kiko bonds

## Bonds — ISIN validation and the NBU register cache

`BondMeta` (`src/holdings/holding-metadata/holding-metadata.ts`)
already carries the full bond shape a Manual-mode form writes:
`quantity`, `faceValueMinorUnits`, `couponPct` (a plain `number`, not
a scaled decimal string — it is a percentage, never fed through the
BigInt decimal helper), `purchaseDate`, `purchasePriceMinorUnits`,
`maturityDate`, `bondKind` (`'government' | 'corporate'`), and
`couponFrequency` (`BondCouponFrequency` — `'monthly' | 'quarterly' |
'semiannually' | 'annually'`). `purchaseDate`/`maturityDate` are raw
epoch-ms instants (often mid-day, e.g. `Date.now()`), read through
`startOfLocalDay` wherever a day boundary matters
(`holding-descriptor/bond/bond.descriptor.ts`), NOT through
`dayKeyOf`'s "a local calendar date encoded as UTC midnight"
convention — do not conflate the two.

**`asBondMeta`'s parser contract: reject bad input, default missing
input.** `bondKind`, `couponFrequency`, `purchasePriceMinorUnits`, and
`isin` are each optional in a STORED record (a bond saved before that
field existed never wrote it). A genuinely ABSENT field (`undefined`)
keeps today's documented default (`bondKind` → `'government'`,
`couponFrequency` → `'annually'`, `purchasePriceMinorUnits` → the
nominal `quantity * faceValueMinorUnits`, `isin` → `undefined`) — a
stored pre-field row must still parse. A PRESENT field that fails its
own check (an unrecognized `bondKind`/`couponFrequency` string, a
non-number `purchasePriceMinorUnits` including `NaN`, a non-string
`isin`) instead rejects the WHOLE record (`asBondMeta` returns `null`),
the same as any other wrong-type field — silently defaulting corrupt
data would hide a real bug in whatever wrote it. The one exception is
`entryMode`, which only picks the mode the edit form opens in: an
unknown value is dropped and the record still parses (the
`PropertyMeta.ownershipInput` pattern). Every sibling parser in
`holding-metadata.ts` (`asTermDepositMeta`, `asPropertyMeta`, `asMetalMeta`,
`asLoanMeta`) already rejects a present-but-invalid field the same way;
`asBondMeta` used to be the one exception that defaulted instead.

`src/bonds/isin/` validates an ISIN with no side effects:
`normalizeIsin` trims/uppercases; `validateIsin` checks the ISO 6166
shape (`^[A-Z]{2}[A-Z0-9]{9}[0-9]$`) and Luhn check digit, returning
`{ ok: true, isin }` or `{ ok: false, reason: 'format' | 'checkDigit'
}` — never throws on an expected validation failure, the standing
domain convention.

`src/bonds/nbu-register/` is the NBU securities-register client,
mirroring `nbu-metals.ts`'s pattern (fetch + `guard`-
based validation + a recorded JSON fixture, no network in tests) on
the SAME `bank.gov.ua` host — no new pinning (kiko-compliance: this
host stays keyless and unpinned; see `docs/security/README.md`'s host
table). `fetchNbuRegister(fetchImpl)` reads `GET
https://bank.gov.ua/depo_securities?json` and maps each record to
`BondTerms` (`{ isin, currency, faceValueMinorUnits, couponPct,
maturityDate, couponFrequency: BondCouponFrequency | null, name }`),
dropping a record with an unmodeled `val_code` currency or an
unparseable `pgs_date` rather than throwing. `nominal` ->
`faceValueMinorUnits` goes straight through `Money.fromMajor` — it is
an amount, not a scaled decimal-string price/quantity, so no
`decimalFromJsonNumber` boundary conversion is needed (the same
parity every other Money amount conversion follows). `pgs_date`
(`YYYY-MM-DD`) is parsed as a DEVICE-LOCAL midnight instant (`new
Date(year, month - 1, day)`), NOT through `parseDateTimeSeconds`'s
"read a bank wall clock as Kyiv time" convention — `BondTerms.maturityDate`
feeds straight into `BondMeta.maturityDate` above, and every consumer
of that field reads it through local getters, so a UTC parse would
silently shift the maturity date (and every coupon date derived from
it) back a day for a user west of UTC.
`couponFrequencyFromPayPeriod(days)` maps the register's `pay_period`
onto `BondCouponFrequency`, tolerating a ±5-day slack around each of
the four canonical periods (30/91/182/364); a period outside every
band resolves to `null` — the eventual ISIN-mode form falls back to
Manual mode with the known fields pre-filled rather than guessing.
`couponPeriodDays(frequency)` reads the same canonical periods back.

**Register payments and the coupon source (USER DECISION D4, 2026-09-26).**
`BondTerms.payments?: BondPayment[]` keeps the record's `payments[]`
(`pay_type` `1` → `'coupon'`, `2` → `'redemption'`, read as a string
OR a number; `pay_date` a device-local midnight like `maturityDate`;
`pay_val` the exact decimal string for ONE bond of the register's
`nominal` — a Eurobond pays fractions of a cent, so never minor
units). All-or-nothing, like `asLots`: one malformed payment drops the
whole list (`payments` absent), the same as a cache row written before
payments were parsed — no schema change, `terms` is JSON. `couponPct`
is the NEXT UNPAID coupon (a `pay_type` 1 dated after `now`'s local
day; one paid today counts as paid): `pay_val` x payments per year
(from `pay_period`: 182/183 → 2, 364/365 → 1, 91/92 → 4) / `nominal`
x 100, exact through `multiplyToDecimal` (`src/currency/decimal/`;
`77 * 2 / 1000 * 100` in float is `15.400000000000002`). `auk_proc`
is only the fallback when no future coupon (or no known frequency)
exists. A step-up bond (XS2895055981) therefore reads its CURRENT
step. `fetchNbuRegister(fetchImpl, now)` takes `now` from
`refreshBondRegisterIfStale`, so the cached coupon is as of the
refresh day.

**Step-up coupons: the coupon in force per payment date (USER DECISION
2026-09-27).** No schema change: the holding KEEPS the issuer's schedule
in its own metadata (`BondMeta.payments`, JSON), so its coupons never
depend on the ISIN still being in the `bond_register` cache or on when
the register last refreshed. A SAVED bond's `BondMeta.couponPct` still
stays as saved (nothing rewrites it); it is only the fallback.
- **The kept schedule.** `BondMeta.payments?: BondPayment[]` — the
  register's own `{ date, kind, amount }` list, coupons AND the
  redemption (the yield reads both): `amount` is the exact decimal per
  ONE bond of its face value (never per 1 unit of nominal, never minor
  units), `date` the register's device-local midnight. `BondPayment` is
  holdings-owned (`holding-metadata.ts`); `nbu-register.ts` imports it.
  `asBondMeta` parses it through `asBondPayments` — all-or-nothing, and a
  present-but-invalid list (a stored `null` included) rejects the whole
  record like every other present field. The key is TRI-STATE: absent =
  never captured (read the
  cache); a non-empty list = the schedule; `[]` = the user's own coupon
  replaced the schedule (read neither, so a matching cache cannot
  override an edited coupon).
- **Read order.** `holdingRegisterPayments(meta, currency, terms)`
  (`src/bonds/nbu-register/holding-register-payments.ts`): the kept
  schedule → the cache → null (the saved coupon). The cache step is
  `cachedRegisterPayments(bond, currency, terms)`, the one gate: the
  cached payments describe a bond only when `terms.isin === bond.isin`
  AND the currency and face value match the register's, and only if they
  parse back through `asBondPayments`; null for a Manual bond (no ISIN),
  another ISIN, a cache without payments, or no cache.
  `holdingRegisterCoupons(metadata, currency, terms)` keeps the
  `'coupon'` payments (`[]` otherwise). The yield, the ledger, and the
  expected profit all read this order.
- **Written at save** (`bondPaymentsOnSave`,
  `src/screens/forms/holding-form/bond/use-bond-fields/`): ISIN mode
  copies the matched register schedule (create or edit). A Manual create
  with an ISIN copies the matched register's schedule while its coupon %
  (and frequency, when the register maps one) is still the matched
  one; a coupon typed over it, or no matched register row, writes `[]`
  (this includes an ISIN typed while the register cache is still empty,
  e.g. a first launch offline: a step-up bond then books its typed flat
  coupon; switching the bond to ISIN mode in Edit copies the register
  schedule once the cache has it),
  so the typed coupon is booked (OVERNIGHT ruling 2026-09-27, needs user
  confirmation). A Manual create without an ISIN keeps none. An edit
  keeps the saved schedule, or captures the matched register's for a
  bond saved without one (a refresh can land while the form is open).
  An edited ISIN, face value or currency drops it (key absent: another
  bond, so the cache is read). An edited coupon % or frequency on an
  ISIN bond in Manual mode writes `[]`, so the edited coupon is what the
  ledger books; the form reaches this only for a bond seeded without a
  non-empty schedule, since a kept one makes both fields read-only
  (below). `useBondFields` compares the fields against the row it
  seeded (`savedBondRef`), but takes the schedule it keeps from the row
  as stored at the time of the write: the edit saves through
  `holdingsRepo.updateMetadataFromStored`, which re-reads the metadata
  inside its own write, because the form's own register refresh can
  backfill a schedule after the seed and then drop the ISIN from the
  cache (the seed-once write-back class, kiko-architecture).
- **Backfill of bonds saved before this** (`backfillBondPayments`,
  `src/bonds/bond-payments-backfill/`): runs inside the daily register
  refresh (`refreshBondRegisterIfStale`), after a non-empty fetch and
  BEFORE `replaceAll`, reading the fresh rows first and then the rows
  still cached, so an ISIN the fresh fetch dropped is still kept. ONE
  write for all bonds that re-reads every bond inside it (the
  kiko-architecture display-screen write rule: never a cached row) and
  writes only a bond whose `payments` key is still absent and whose
  ISIN/currency/face still match; every other metadata key is kept as
  stored (a bond without a price does not gain the nominal one). It
  reads the cache only for the ISINs still pending. Not a render-time
  effect: the refresh is the only place the fresh rows exist.
- **Ledger and expected profit.** `derivedEntries(holding, now, t,
  scheduledCoupons)` → `HoldingDescriptor.entries(…, scheduledCoupons)`
  and `bondExpectedProfitMinor(meta, currency, scheduledCoupons)`
  (`holding-descriptor/bond/`) build every coupon through one
  `bondCoupons`: the ledger DATES stay `bondCouponDates` (the
  statement's 15th, unchanged); each date's gross is the scheduled
  coupon closest to it (`couponPaymentOn(payments, date, frequency)`,
  `src/holdings/interest/` — the register lists it a few days off the
  15th; an equal-distance tie keeps the earlier; a closest coupon more
  than half a period away (months x 365 / 24 days) belongs to another
  date and gives undefined) x `quantity` through `multiplyToMinorUnits`,
  else the saved constant coupon. Corporate
  tax is withheld per coupon. `BondCouponPayment` is
  `Pick<BondPayment, 'date' | 'amount'>`: the ledger reads only a
  coupon's date and amount, so a caller can pass the kept `BondPayment`
  list as is. The holding detail screen passes
  `holdingRegisterCoupons(…, registerTerms)` from
  `useBondRegisterTerms`; the spec's `expectedProfit(holding,
  registerTerms)` does the same.
- **Shown coupon at read time.** `currentCouponPct(terms, now)`
  (`nbu-register.ts`) re-applies the next-unpaid rule to the cached
  payments against TODAY (nominal from `faceValueMinorUnits` via
  `shiftDecimal`), falling back to the cached `couponPct`. The
  ISIN-mode form's `useBondIsinMode` returns its matched terms with
  this coupon (`Date.now()`), so both the shown and the filled coupon
  move to a step on its date with no refresh (an offline phone).
  `currentCouponPct` takes a `Pick` of `BondTerms` (currency, face,
  coupon, frequency, payments), so a stored bond's kept schedule reads
  through the SAME function: `{ ...meta, currency }`.
- **Edit form coupon with a kept schedule (USER RULING (4) option (a),
  2026-09-27).** While an edit keeps a non-empty stored schedule
  (`keepsSavedSchedule(saved, next)` in `bond-payments-on-save.ts`: the
  seeded bond has `payments.length > 0`, and the form still holds its
  ISIN, face value, currency, coupon % and frequency — exactly when a
  Manual save returns `saved.meta.payments`), `useBondFields` returns
  `scheduledCouponPct` = `String(currentCouponPct({ ...meta, currency },
  Date.now()))` — the coupon in force today — and the Manual coupon %
  field shows it READ-ONLY (`TextField editable={false}`), with the
  coupon frequency `SelectField disabled` too (the frequency sets the
  payments per year the coupon is read with, and a changed frequency
  drops the schedule by the same rule). The typed `couponPct` state
  keeps the SAVED coupon, so an untouched Save writes the stored
  `couponPct` unchanged (4.5 for XS2895055981 after its step) with the
  schedule kept — the shown value is never written back. Without a
  schedule (`payments` absent, or `[]` = the user's own coupon) or once
  the ISIN, face value or currency changed (the schedule is then dropped
  by the identity rule), both fields stay editable and show the typed
  coupon. ISIN mode never shows an editable coupon: its summary shows the
  matched register terms' `currentCouponPct`. Pins
  (`use-bond-fields.test.ts`): XS2895055981 saved at 4.5 with its
  schedule, today 2027-01-20 → shown 4.5, 2027-08-15 → shown 6, in
  Manual AND ISIN mode; the untouched Save `toEqual`s the stored
  metadata.
- **Pins.** XS2895055981 cached on 2026-09-26: shown 4.5 on 2027-01-20,
  6 on 2027-08-15 (and on 2027-02-01, that coupon counted paid); 1,000
  bonds bought 2026-09-26 for 980.00 book coupons 22.50, then 4 x 30.00,
  expected profit 162.50 (the saved 4.5% alone gives 132.50).
  UA4000239115 unchanged: 15.18, ledger 75.90 per 1,000 bond with or
  without the register coupons. A Manual bond and an ISIN bond whose
  cache has no payments keep the saved coupon. The same XS bond with its
  schedule kept and its cache row gone (matured/delisted) still books
  22.50 + 4 x 30.00, expected profit 162.50; a `.kiko` restore keeps the
  schedule (metadata is restored verbatim). The App Store demo bond
  (invented ISIN UA4000999015, `e2e/screenshot/seed/`) keeps its
  schedule for the same reason: the first online refresh drops it. Its
  ISIN passes `validateIsin` (a seed test pins every dataset ISIN), so
  a reviewer can save an edit of it in Manual or ISIN mode, and sits
  far above the live NBU issue range (highest listed UA4000239123 on
  2026-09-27), so it never matches a real bond.
- **Limits.** A bond whose ISIN left the cache BEFORE any refresh ran
  the backfill (never captured) stays on its saved coupon — for a
  step-up bond, the step saved at create. A `.kiko` restore brings the
  `bond_register` cache back with the holdings, so a restored bond not
  yet backfilled reads the restored cache until the next refresh
  backfills it. The edit form's typed coupon state still seeds the SAVED
  coupon, and the register's coupon for the stored ISIN never replaces
  it (`seedStoredIsin`, below); a kept schedule shows its current coupon
  read-only instead (above). An ISIN-mode edit of a stored ISIN the
  register no longer lists shows no coupon at all (no summary without a
  match).

**Yield to maturity (USER DECISION D4).** `src/bonds/yield-to-maturity/`:
`yieldToMaturity(cashFlows, paidMinorUnits, lotDate)` is the effective
annual IRR (a decimal fraction, 0.154 = 15.4%), act/365 via
`daysBetween`, over the flows strictly after the lot's LOCAL day (a
flow on the lot day went to the seller); null for a lot without a price
(null/≤0), with nothing left, or whose rate is not finite (`expm1`
overflows past a log-rate of ~709 — a half-typed price against a coupon
days away; `Number.isFinite` once, so the form row and the detail both
read "no answer"). Solved by bisection in ln(1 + rate) —
monotone over all reals for positive flows, so always bracketed
(doubling, ≤64 expansions) and deterministic (tolerance 1e-12, ≤200
iterations); amounts stay integer minor units.
`portfolioYieldToMaturity(lots)` weights each priced lot's yield by the
amount paid; an unpriced lot has no weight. `bondYieldToMaturity(metadata,
currency, registerTerms)` reads the register's payments (scaled by
`quantity` through `multiplyToMinorUnits`) when the cache has them for
the bond's ISIN AND the holding's face value and currency match the
register's; otherwise it GENERATES the schedule: the ledger's own gross
coupon (face x coupon% / payments per year) on each date stepped back
from maturity by `couponPeriodDays` in DAYS (not calendar months — an
NBU bond pays exactly 182 days apart, so a bond entered by hand lands on
the register's dates), plus the nominal at maturity. A stored bond with
no `purchasePriceMinorUnits` (legacy, or Manual saved with a blank
price; `hasStoredBondPurchasePrice` in `holding-metadata.ts` tells it
from `asBondMeta`'s nominal default) has no yield. Pin: 98 x
UA4000239115 at 1,076.72 on
2026-09-10 → 15.40% from the register AND from the generated schedule
(month-stepped `bondCouponDates` would give 15.41%). The holding
detail's bond breakdown shows it as its last row, "Yield to maturity"
(`holdingDetail.yieldToMaturity`, a `text` row, testID
`bond-yield-to-maturity`, 2 decimals through the shared
`yieldToMaturityText` in the same `src/bonds/yield-to-maturity/`
feature), reading the cached terms through `useBondRegisterTerms`
(`src/screens/holding-detail/use-bond-register-terms/`, disabled for a
holding without an ISIN).

The bond FORM shows the same row live (USER FINDING D7 — "coupon
maturity" meant the yield to maturity, the seller's 15.4%, not the
coupon): create and edit, ISIN and Manual. `useBondFields` returns
`yieldToMaturity` = `bondYieldToMaturity(buildBondMetadata(<the form
now>), currency, registerTerms)` — the SAME function the detail calls,
never a second implementation — so it follows every change of price,
quantity, dates and schedule (register payments in ISIN mode, the kept
or generated schedule in Manual). `buildBondMetadata` stands today in
for a missing date, so `hasYieldInputs` hides the row BEFORE the call
while the price, the purchase date or the maturity date is missing; a
solver with no answer hides it too (no placeholder). In ISIN mode with
no register match, `hasYieldTerms` hides it: the face, coupon and
maturity are still a previous match's, not the typed ISIN's — except an
edit's own stored ISIN (`isStoredIsin`), whose stored terms and schedule
are the bond's own, so the row shows the holding detail's value. The
yield is a `useMemo` over its inputs (`buildBondMetadata` is a
`useCallback` over the bond fields, and `useBondIsinMode` memoizes
`registerTerms` on the cached row), so a keystroke in Name or Notes
does not re-solve it. `BondFormBlock`
renders it right after the purchase date as a one-row `SummaryTable`
with a caption `textSecondary` value (the ISIN summary's own row
style), testID `bond-form-yield-to-maturity`. Pin: UA4000239115, 98 x
"1 076,72", bought 2026-09-10 → 15.40% in the form, from the register
and from the generated schedule.

`src/bonds/bond-register-repo/` caches the register in the
`bond_register` table (migration `0037`; `isin` primary key, `terms`
a JSON `BondTerms` column, `fetchedAt`). `bondRegisterRepo` exposes
`findByIsinQuery(isin)` and `fetchedAtQuery()` (both hand straight to
`useLiveQuery`; `fetchedAtQuery` is also awaited directly as a
one-shot read, the same dual-purpose pattern `ratesRepo` and
`pricePointsRepo` establish) and `replaceAll(rows)` — a REPLACE, not
an upsert: every existing row is deleted and the fresh set inserted in
ONE transaction, so a matured/delisted ISIN disappears from the cache
the same run it disappears from the live register.
`refreshBondRegisterIfStale({ now, fetchImpl })` gates the fetch at
most once per LOCAL calendar day, comparing the cache's single
write-time `fetchedAt` stamp against `now` through `dayKeyOf`
(`kiko-pricing`) — the same device-local-day convention `price_points`
uses, not a UTC day. `src/bonds/bond-register-repo/index.ts` is a
barrel (`export * from './bond-register.repo'`), added once the
ISIN-mode form became a real consumer — an unused barrel would have
been flagged by Knip.

### The ISIN-mode form

`BondMeta.isin?: string` (`holding-metadata.ts`) records the ISIN a
bond was saved with — from ISIN mode or typed into Manual mode's own
optional ISIN field, `undefined` for a bond without one. It does NOT
tell the two modes apart; `BondMeta.entryMode` does (below). Once
saved, the holding's stored terms never depend
on the register again — nothing re-validates a stored ISIN or
rewrites its coupon against a later register state (the detail
screen's coupons, expected profit and yield to maturity READ the kept
schedule, else the cached payments, above; the only register-driven
write is the one-time schedule backfill, which never touches the
coupon).

`BondFormBlock`'s bond section has an "ISIN / Manual"
`BondEntryMode` mode, the design-system `SegmentedControl` (not
`ChipRow` — one control type per kind of mode choice),
rendered by `BondIsinSection`
(`src/screens/forms/holding-form/bond/bond-isin-section/`) — purely
presentational, the same `MetalSection`/`PropertySection` split.

**`useBondIsinMode`** (`src/screens/forms/holding-form/bond/use-bond-isin-mode/`)
owns ALL of the ISIN-mode state, the `useLiveQuery` lookup
(`bondRegisterRepo.findByIsinQuery`, keyed on the normalized ISIN when
`validateIsin` passes, else an empty string that matches no row), and
THREE SEPARATE effects — extracted out of `HoldingFormScreen`
specifically because a single MERGED effect
sharing one dependency array causes the cross-talk described below; the hook has its
own cognitive-complexity budget instead of borrowing the screen's, so
its effects stay genuinely separate with no lint-driven pressure to
recombine them:
- refreshes the register cache at most once per local day, fired
  once per bond-section open (create or edit); the
  fire-and-forget call is `either(() => refreshBondRegisterIfStale())`
  as a bare statement (the project's standing fire-and-forget idiom —
  `either` never rejects, so a network failure can never surface as a
  form error or an unhandled rejection);
- defaults `purchaseDate` to LOCAL MIDNIGHT (`startOfLocalDay`, not a
  raw `Date.now()`) the first time ISIN mode is entered — a raw
  `Date.now()` default would leave a LATER explicit pick composed with
  that moment's clock time instead of a clean day, because
  `DateField.handleDayPress` carries an existing value's own
  time-of-day onto a newly picked day (so a paired TimeField pick is
  never clobbered);
- applies a found ISIN's terms once PER MATCH while in ISIN mode,
  tracked by a REF (`lastAppliedIsinRef`, which survives a fold through
  `IsinModeDraft`; not the effect's own
  dependency array) rather than "since `bondMode` is still isin" — the
  register lookup itself is NOT gated on `bondMode` (a valid ISIN
  typed in Manual mode resolves just as readily), so a match resolved
  while the user is in Manual mode still applies the first time they
  later switch to ISIN — keying purely on
  `registerTerms?.isin` misses exactly this case, because the effect
  never runs again once `bondMode` stops changing. A merged effect
  applied on every unrelated change would silently overwrite a typed
  name or a changed currency, and would re-fire on every re-tap of
  "ISIN", putting the control into a loop back to Manual for an
  unmapped-frequency match — this is why the three effects must stay
  separate.

ISIN mode shows quantity (required) and purchasePrice always. The price
is REQUIRED in ISIN mode (USER DECISION D4 — the yield to maturity needs
the price actually paid): `bondFieldErrors`' `purchasePriceError`
(`forms.holding.purchasePriceRequiredError`, gated by
`purchasePriceRequired: bondMode === 'isin'`), its own scroll target
after quantity, and the placeholder `purchasePriceIsinPlaceholder`;
Manual mode keeps it optional. A blank price is NOT stored (the key is
left out, never written as the nominal): `asBondMeta` alone supplies the
nominal default for the purchase entry and expected profit, and the
yield shows none. Edit seeds a blank price field when the key is absent,
so an unchanged re-save stays unpriced.

The price is ENTERED PER BOND and STORED AS THE BATCH TOTAL (USER
FINDING D6, no migration): the field (`forms.holding.purchasePrice`,
"Purchase price per bond") takes the price of ONE bond, while
`purchasePriceMinorUnits` keeps its meaning — the total paid — for every
consumer (net worth, the purchase ledger entry, expected profit, yield
to maturity, funding reconcile, export/restore). `bond-purchase-price.ts`
(`src/screens/forms/holding-form/bond/use-bond-fields/`) owns both
conversions: `bondPurchaseTotal` stores quantity x price per bond
through `multiplyToMinorUnits` (exact BigInt product; the total is taken
from the quantity at Save, so a quantity typed after the price still
counts). It reads both fields through `parseAmount`, the SAME parser the
validation uses (`bond-reasons.ts`), then `decimalFromJsonNumber` (a
typed amount has far fewer than 15 significant digits, so the double
converts back exactly): a dangling separator ("1 076,") is the whole
amount, as in every other amount field, never a price the validation
passes and Save silently drops (98 x "1 076," → 10_544_800; an edit to
"1 100," keeps a price). `normalizeDecimal` rejected it and deleted the
stored price on an edit (review I1). `pricePerBondText` seeds the edit
field with `scaleMinorUnits(total, 1, quantity)` in one exact BigInt
step, rounded half away from zero to the minor unit; a quantity that is
not a whole, positive number of bonds seeds a blank price (the BigInt
division cannot take it). A bond is a whole unit, so the quantity field
rejects a fraction (`bond-reasons.ts`: `quantityWholeError`, "Enter a
whole number of bonds."; blank/zero keep `quantityError`) — the
number-pad has no separator, but a paste or a restored `.kiko` can bring
one. An edit of a restored non-whole quantity shows that error and
blocks Save; the stored metadata is not touched until the user types a
whole quantity. Pins: '2.5' blocks Save; a stored 3-bond total, changed
to 2.5 and back to 3, re-saves unchanged. While both the price and the
quantity text still equal what the edit seeded, Save writes the stored
total unchanged — 10 000.00 over 3 bonds seeds 3 333.33, which would
otherwise re-save as 9 999.99. Pins: 98 x "1 076,72" → 10_551_856;
that total seeds "1 076.72" (every seeded amount uses a dot). A bond the
user saved by typing one bond's price into the old "total paid" field
is stored wrong and code cannot tell; its edit shows an implausibly
small price per bond, fixed by hand. Metal lots and property keep a
total cost field.

ISIN mode hides face
value, coupon, maturity, kind, and frequency — a found ISIN fills all
of them: `bondKind` is always `'government'` (the register is
Minfin-only), `couponFrequency` only when the register's `pay_period`
maps onto a known band; an unmapped period instead switches the form to
Manual ONCE, the first time
that match is applied, leaving every OTHER known field pre-filled,
rather than guessing a frequency. Re-tapping "ISIN" afterward for that
SAME match does stay in ISIN mode — but showing the register's
summary there with no visible frequency would silently let the form
carry the shared `couponFrequency` state's own untouched default into
Save, which is exactly the guess this rule forbids. So ISIN mode instead
shows its OWN coupon-frequency `SelectField` (`selected: null`) with NO
default whenever the
matched terms have `couponFrequency === null`
(`needsCouponFrequencyPick`), and Save is blocked until the user picks
one — never a frequency the user did not
pick or the register did not give. In
EDIT mode, a found ISIN whose currency differs from the (locked)
holding currency is never applied at all — `isinReasonKey` returns
`'forms.holding.isinCurrencyMismatchError'` instead, blocking Save
(the currency field is locked
`disabled={isEdit}`, so a silent apply used to store one currency's
terms under a holding balance denominated in another). Outside edit
mode a found ISIN's `currency` DOES overwrite the form's own state on
every new match — editable afterward, but re-applied whenever the ISIN
changes to a new found bond.

The register name fills the Name field only while the user has not
typed one (USER FINDING D5): `useBondIsinMode` takes the current
`name`; a match sets it only when it is blank or still equals the name
the hook itself filled last (`filledNameRef`, also kept in `IsinModeDraft`
across a fold), so ISIN B replaces ISIN
A's automatic name but never a typed one, in either mode, in create or
edit (an edit seeds the saved name, which the hook never filled).

An EDIT seeds its stored ISIN through the hook's `seedStoredIsin`: the
stored ISIN counts as already applied (`lastAppliedIsinRef`), so a
register resolve or a tap on ISIN never overwrites the saved name,
coupon, face value or frequency — without it, a step-up bond's register
coupon replaced the saved one, and a later Manual save read that as a
typed coupon and stored `payments: []`. The stored `couponFrequency`
also counts as the pick (`pickedCouponFrequency`), so an ISIN-mode edit
of an unmapped-frequency bond stays saveable. The pick clears only when
a NEW match applies (inside the apply effect), not on every change of
the matched ISIN. So stored values win over the register for the stored
ISIN: a Manual bond with a typed ISIN and typed terms (say maturity
2027-09-01 where the register says 2027-09-15), switched to ISIN mode
on edit, keeps its typed terms on Save and saves `entryMode: 'isin'` —
while the ISIN summary shows the register's maturity and coupon, so the
summary can disagree with what is booked (review M2, documented limit).

A CREATE defaults to `'isin'`. EDIT opens in the mode the bond was
saved from (USER FINDING D8): `BondMeta.entryMode?: 'isin' | 'manual'`
(`BondEntryMode`, `holding-metadata.ts` — the `PropertyMeta.ownershipInput`
pattern: optional, an unknown value is dropped by `asBondMeta`, the
record still parses; a `.kiko` restore copies it with the metadata).
`buildBondMetadata` writes the mode the bond is saved from on every
create and edit save — the unmapped-frequency auto-switch saves
`'manual'`. `useBondFields`'s own `seed`
(`src/screens/forms/holding-form/bond/use-bond-fields/`) calls the
hook's `setBondMode` with it; the stored ISIN is shown, still editable,
in either mode. A bond without `entryMode` (saved before it existed)
opens Manual — USER RULING: "Ignore old bonds, I'll just remake them";
there is no legacy detection code (no mode guess, no per-bond-price
check for a price typed into the old total field).

An ISIN-mode EDIT of its own stored ISIN that the register no longer
lists (matured/delisted, or offline with an empty cache) SAVES — USER
RULING: `useBondIsinMode` keeps the seeded `storedIsin`, and
`bondIsinReasonKey` returns no reason while nothing matched and
`isStoredIsin` holds: the ISIN field still holds the stored ISIN AND
the form still holds the stored face value, coupon %, coupon frequency,
maturity date and bond kind (`holdsStoredTerms` in `useBondFields`,
compared as values against the seeded `savedBondRef`). USER RULING:
nothing stored is overwritten — a change to any of those five (for
example typed in Manual, then back to ISIN; the kind is a Manual-only
chip, so an ISIN-mode save would store a kind the reopened bond no
longer shows) blocks the unlisted ISIN in ISIN mode again
with `isinNotInRegister`, and Switch to manual saves it honestly as
Manual; the yield row hides with it. `BondIsinSection` still shows the
"not in the
register" / "not loaded" note with its Switch-to-manual button (the
note reads `foundTerms`, not the reason). Save writes the stored terms
unchanged (name, coupon, face, frequency, maturity, currency) with
`entryMode: 'isin'`, and `bondPaymentsOnSave` keeps the stored schedule
(no register payments to take, identity unchanged → `saved.meta.payments`).
The form's yield row reads that stored schedule too, the same value as
the holding detail. Once another ISIN's match fills the form, the
exemption ends (`storedIsin` clears in the apply effect): retyping the
stored ISIN is blocked again, since the form no longer holds its stored
terms. A CREATE with an unlisted ISIN, or an edit's DIFFERENT unlisted
ISIN, is still blocked until "Switch to manual".

Validation (`isinReasonKey`, returned by the hook, backed by a
module-level pure `bondIsinReasonKey`): required and blocking in ISIN
mode; optional but still check-digit-validated when non-empty in
Manual mode; `isinNotInRegister` once shape/check-digit both pass but
the cache has no match (a genuine not-found and an
offline-with-no-cache open the same way, since both leave the lookup's
result `null`; an edit's own stored ISIN is exempt, above);
`isinCurrencyMismatchError` in edit mode per the currency-lock rule above.
A maturity-before-purchase reason (`bondReasonKey`, unrelated to the
ISIN reason above) still applies unchanged in ISIN mode — a
matured-still-registered bond (the live register still counts it)
can pass every ISIN check yet still fail this — but ISIN mode never
mounts the maturity `DateField`, so `BondFormBlock` shows that reason
on the purchase date `DateField` instead, and `useBondFields.scrollTargets`
scrolls there, the one date the user actually controls there.

The five Manual-only fields (face value, coupon %, maturity date, bond
kind, coupon frequency) are their own component,
`ManualBondFields` (`src/screens/forms/holding-form/bond/manual-bond-fields/`):
it takes `bondMode` as a prop and returns `null` outside Manual mode,
rather than the caller gating `{bondMode === 'manual' && (...)}`
around its JSX — see `kiko-code-style`'s `noExcessiveCognitiveComplexity`
entry for why a conditional NESTED inside the bond block's own
`{type === 'bond' && (...)}` gate needed a real extraction, not a
`match()` trick.
