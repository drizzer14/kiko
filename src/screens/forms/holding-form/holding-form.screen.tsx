import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import type { ScrollViewInstance, TextInputInstance } from 'react-native';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { accountsRepo } from '@kiko/accounts/accounts.repo';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  creatableHoldingTypesForAccount,
  type HoldingType,
  holdingTypes,
  isLedgerlessHoldingType,
  holdingTypesForAccountKind,
} from '../../../holdings/holding-type';
import {
  asBondMeta,
  asPropertyMeta,
  asTermDepositMeta,
  type BondKind,
  type BondMeta,
  type PropertyCategory,
  type CompoundingFrequency,
  type TermDepositMeta,
} from '../../../holdings/holding-metadata';
import type { Lot } from '../../../holdings/lots';
import { Money } from '../../../currency/money';
import type { HoldingRow } from '../../../db/schema';
import { dayKeyOf } from '../../../prices/price-book';
import { shiftDecimal } from '../../../currency/decimal';
import { parseAmount } from '../../../currency/parse';
import Box from '../../../design-system/components/box';
import { useLiveQuery } from '../../../db/use-live-query';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import Switch from '../../../design-system/components/switch';
import { isSyncedAccount, isSyncedHolding } from '../../../holdings/deletable';
import Divider from '../../../design-system/components/divider';
import TextField from '../../../design-system/components/text-field';
import { holdingTypeSymbol } from '../../../holdings/entity-symbols';
import { defaultHoldingColor } from '../../../holdings/entity-colors';
import FieldError from '../../../design-system/components/field-error';
import { resolveEntityColor } from '../../../design-system/entity-tint';
import type { AccountsStackParamList } from '../../../navigation/types';
import CurrencyField from '../../../design-system/components/currency-field';
import { type Currency, currencyScale, currencySymbol } from '../../../currency/currency';
import { KIKO_ENTITIES_ICONS } from '../../../design-system/components/icon-picker-modal/icon-pools';

import ChipRow from '../chip-row';
import DateField from '../date-field';
import ColorPicker from '../color-picker';
import HoldingIdentityField from '../holding-identity-field';
import PropertySection from './property-section';
import { useSubmitOnce } from '../use-submit-once/use-submit-once';
import { groupAmount, majorAmountText } from '../amount-format/amount-format';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '../scroll-to-field/scroll-to-field';

type HoldingFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingForm'>;

// The literal i18n keys `termDepositReasonKey` may return, so `t()` (typed
// from src/i18n/locales/en.ts) accepts them.
type TermDepositReasonKey =
  | 'forms.holding.contributionsRequiredError'
  | 'forms.holding.contributionIncompleteError'
  | 'forms.holding.annualRateError'
  | 'forms.holding.termMonthsError';

// The literal i18n keys `bondReasonKey` may return, so `t()` (typed from
// src/i18n/locales/en.ts) accepts them.
type BondReasonKey =
  | 'forms.holding.quantityError'
  | 'forms.holding.faceValueError'
  | 'forms.holding.couponPctError'
  | 'forms.holding.maturityDateError';

// The literal i18n key `propertyReasonKey` may return, so `t()` (typed from
// src/i18n/locales/en.ts) accepts it.
type PropertyReasonKey = 'forms.holding.propertyCostError';

// `saved` marks a contribution that is already persisted in the holding's
// stored metadata (an edit-mode hydrated row) versus one the user just added in
// this session. Only unsaved rows may be removed — a persisted contribution is
// part of the deposit's history, so its Remove control renders disabled. The
// flag is explicit rather than inferred from id ordering: an explicit boolean is
// clearer and does not break if the seeding/id scheme ever changes.
type Contribution = { id: number; amount: string; date: number | null; saved: boolean };

// Seed the repeatable contributions list from a stored deposit: each stored
// amount is minor units, shown back in the field as a grouped major string the
// user can edit (the inverse of the create form's parse-on-save). Every seeded
// row is `saved: true` — it already exists in the database, so it cannot be
// removed here.
const seedContributions = (meta: TermDepositMeta, currency: Currency): Contribution[] =>
  meta.contributions.map((contribution, index) => ({
    id: index,
    amount: groupAmount(majorAmountText(currency, contribution.amountMinorUnits)),
    date: contribution.date,
    saved: true,
  }));

// Seed the bond number/date fields from stored metadata. Minor-unit money
// fields (face value, purchase price) convert back to grouped major strings;
// plain-number fields (quantity, coupon %) render verbatim.
const seedBondFields = (meta: BondMeta, currency: Currency) => ({
  quantity: groupAmount(String(meta.quantity)),
  faceValue: groupAmount(majorAmountText(currency, meta.faceValueMinorUnits)),
  couponPct: String(meta.couponPct),
  purchasePrice: groupAmount(majorAmountText(currency, meta.purchasePriceMinorUnits)),
  purchaseDate: meta.purchaseDate,
  maturityDate: meta.maturityDate,
  bondKind: meta.bondKind,
  couponFrequency: meta.couponFrequency,
});

// Seeds property_item's two edit-mode fields (category + the ORIGINAL lots,
// carried through unchanged on save — cost/quantity history is fixed at
// creation, PropertySection hides its Cost field in edit mode) from stored
// metadata. A no-op for invalid/absent metadata. Extracted out of the seed
// effect below (rather than an inline `if (meta) {...}`, the shape
// `seedContributions`/`seedBondFields` themselves don't need since THEY are
// pure builders, not setters) so that effect's own branching stays under the
// cognitive-complexity budget.
const seedPropertyFields = (
  holding: HoldingRow,
  setters: {
    setPropertyCategory: (category: PropertyCategory) => void;
    setPropertyLots: (lots: Lot[]) => void;
  },
): void => {
  const meta = asPropertyMeta(holding.metadata);

  if (meta === null) {
    return;
  }

  setters.setPropertyCategory(meta.category);
  setters.setPropertyLots(meta.lots);
};

// The partial row an edit-mode save writes: always the editable identity fields
// (name, color), plus the one value field that belongs to the type — a
// deposit/bond's value derives from its metadata (its balance is not stored), so
// those write metadata; every other type writes its edited balance. A synced
// (Monobank) holding is the exception: its balance is owned by the sync, so the
// patch omits balanceMinorUnits entirely and only touches the identity fields.
const buildHoldingPatch = (params: {
  name: string;
  color: string | null;
  type: HoldingType;
  currency: Currency;
  openingBalance: string;
  metadata: Record<string, unknown> | undefined;
  isSynced: boolean;
}): Partial<HoldingRow> => {
  const { name, color, type, currency, openingBalance, metadata, isSynced } = params;

  // A ledgerless type (term_deposit, bond, property_item — see kiko-domain)
  // never writes a balance here: its value derives from its own metadata, not
  // a raw stored balance. A property's `metadata` on this edit path is always
  // `{ category, lots }` with the ORIGINAL (hydrated) lots preserved verbatim
  // — see `buildMetadata`'s own `property_item` branch — so an edit never
  // rewrites cost/quantity history; only category is user-editable here.
  if (isLedgerlessHoldingType(type)) {
    return { name, color, metadata };
  }

  if (isSynced) {
    return { name, color };
  }

  return {
    name,
    color,
    balanceMinorUnits: Money.fromMajor(currency, parseAmount(openingBalance) || 0).minorUnits,
  };
};

// The property CREATE payload (T16): a `property_item` writes a zero stored
// balance (its value lives entirely in `metadata.lots` / `price_points` —
// kiko-domain), one lot dated today for a quantity of "1" at the entered
// cost, and a first `manual` price point equal to that same cost, so the
// holding never reads as "no price yet" before the user records a real
// revaluation. The lot's day and the price point's day share the SAME
// `dayKeyOf` normalization `PriceBook` itself reads price points by, and the
// point's `price` is derived from the SAME minor-units cost the lot carries
// (never re-parsed from the raw text field), so the two can never disagree.
const buildPropertyCreatePayload = (params: {
  category: PropertyCategory;
  currency: Currency;
  cost: string;
}): {
  balanceMinorUnits: number;
  metadata: Record<string, unknown>;
  firstPricePoint: { day: number; price: string };
} => {
  const { category, currency, cost } = params;
  const costMinorUnits = Money.fromMajor(currency, parseAmount(cost) || 0).minorUnits;
  const day = dayKeyOf(Date.now());
  const lot: Lot = { day, quantityDelta: '1', costMinorUnits };

  return {
    balanceMinorUnits: 0,
    metadata: { category, lots: [lot] },
    firstPricePoint: {
      day,
      price: shiftDecimal(String(costMinorUnits), -currencyScale[currency]),
    },
  };
};

const bondKinds: readonly BondKind[] = ['government', 'corporate'];

const compoundingOptions: readonly CompoundingFrequency[] = [
  'bi-weekly',
  'monthly',
  'quarterly',
  'annually',
];

const couponFrequencies = ['monthly', 'quarterly', 'semiannually', 'annually'] as const;
type CouponFrequency = (typeof couponFrequencies)[number];

// The name-required reason, shown only after a failed Save press: gated on
// `attemptedSave` so it renders nothing before the first press. The
// type-specific per-field reasons (term deposit / bond) no longer flow
// through this helper — each field now calls `termDepositReasonKey()` /
// `bondReasonKey()` directly (see `fieldErrorMessage` below), since each field
// needs its OWN reason, not the type's single first-failing one. Kept as a
// module-level helper (rather than inline in the component) to mirror the
// pattern the rest of this file already uses for save-time branching.
const saveReasonsFor = (params: {
  attemptedSave: boolean;
  name: string;
}): { showNameReason: boolean } => {
  const { attemptedSave, name } = params;

  return { showNameReason: attemptedSave && name.trim().length === 0 };
};

// The active error message for one of `termDepositReasonKey`'s /
// `bondReasonKey`'s own returned keys, or `undefined` while that field's own
// check still passes (or before the first failed Save press) — shared by
// every per-field `TextField`/`HoldingIdentityField` `error` prop and the two
// relocated group `<FieldError>`s below, so each render site is a single call
// rather than repeating the `attemptedSave &&` comparison inline at all seven
// fields. Kept module-level and pure so its branch stays out of
// HoldingFormScreen's own cognitive-complexity budget (the same reason
// transaction-form's `resolveDescriptionPlaceholder` is a module-level
// helper).
const fieldErrorMessage = (
  t: TFunction,
  attemptedSave: boolean,
  reasonKey: TermDepositReasonKey | BondReasonKey | PropertyReasonKey | null,
  expectedKey: TermDepositReasonKey | BondReasonKey | PropertyReasonKey,
): string | undefined => (attemptedSave && reasonKey === expectedKey ? t(expectedKey) : undefined);

// The wrapper refs `firstInvalidFieldRef` (below) picks a scroll target from —
// grouped into its own type so that function's own signature reads as one
// param per concern (the reasons, then the refs) rather than eight positional
// refs.
type ValidatedFieldRefs = {
  nameFieldRef: RefObject<FieldInstance | null>;
  contributionsFieldRef: RefObject<FieldInstance | null>;
  annualRateFieldRef: RefObject<FieldInstance | null>;
  termMonthsFieldRef: RefObject<FieldInstance | null>;
  quantityFieldRef: RefObject<FieldInstance | null>;
  faceValueFieldRef: RefObject<FieldInstance | null>;
  couponPctFieldRef: RefObject<FieldInstance | null>;
  maturityDateFieldRef: RefObject<FieldInstance | null>;
  propertyCostFieldRef: RefObject<FieldInstance | null>;
};

// A blocked Save's FOCUS action for each TEXT-backed validated field — called
// once `scrollToField` has positioned it on screen (see `save`'s own
// `onSettled` callback below). The contributions group and the maturity date
// have no matching entry: both are composite/picker targets with no single
// input to focus (a date picker has no keyboard of its own), so `save`'s
// scroll for those two lands the field on screen with no focus follow-up.
type ValidatedFieldFocus = {
  name: () => void;
  annualRate: () => void;
  termMonths: () => void;
  quantity: () => void;
  faceValue: () => void;
  couponPct: () => void;
  propertyCost: () => void;
};

// The first still-invalid field's own wrapper ref (plus its FOCUS action,
// when it has one — see `ValidatedFieldFocus` above), in the SAME priority
// order `termDepositReasonKey`/`bondReasonKey` already check their fields
// in: the name field first (it always applies, independent of type), then
// the active type's fields. `save`'s `!isValid` branch passes this straight
// to `scrollToField`. Module-level and pure (given the already-computed
// reason keys) so this branching stays out of `save`'s own
// cognitive-complexity budget — the same reason `fieldErrorMessage` above is
// a module-level helper.
const firstInvalidFieldRef = (params: {
  name: string;
  type: HoldingType;
  termDepositReasonKey: TermDepositReasonKey | null;
  bondReasonKey: BondReasonKey | null;
  propertyReasonKey: PropertyReasonKey | null;
  refs: ValidatedFieldRefs;
  focus: ValidatedFieldFocus;
}): { ref: RefObject<FieldInstance | null>; focus?: () => void } | null => {
  const { name, type, termDepositReasonKey, bondReasonKey, propertyReasonKey, refs, focus } =
    params;

  const order: { invalid: boolean; ref: RefObject<FieldInstance | null>; focus?: () => void }[] = [
    { invalid: name.trim().length === 0, ref: refs.nameFieldRef, focus: focus.name },
    ...(type === 'term_deposit'
      ? [
          {
            invalid:
              termDepositReasonKey === 'forms.holding.contributionsRequiredError' ||
              termDepositReasonKey === 'forms.holding.contributionIncompleteError',
            ref: refs.contributionsFieldRef,
          },
          {
            invalid: termDepositReasonKey === 'forms.holding.annualRateError',
            ref: refs.annualRateFieldRef,
            focus: focus.annualRate,
          },
          {
            invalid: termDepositReasonKey === 'forms.holding.termMonthsError',
            ref: refs.termMonthsFieldRef,
            focus: focus.termMonths,
          },
        ]
      : []),
    ...(type === 'bond'
      ? [
          {
            invalid: bondReasonKey === 'forms.holding.quantityError',
            ref: refs.quantityFieldRef,
            focus: focus.quantity,
          },
          {
            invalid: bondReasonKey === 'forms.holding.faceValueError',
            ref: refs.faceValueFieldRef,
            focus: focus.faceValue,
          },
          {
            invalid: bondReasonKey === 'forms.holding.couponPctError',
            ref: refs.couponPctFieldRef,
            focus: focus.couponPct,
          },
          {
            invalid: bondReasonKey === 'forms.holding.maturityDateError',
            ref: refs.maturityDateFieldRef,
          },
        ]
      : []),
    ...(type === 'property_item'
      ? [
          {
            invalid: propertyReasonKey === 'forms.holding.propertyCostError',
            ref: refs.propertyCostFieldRef,
            focus: focus.propertyCost,
          },
        ]
      : []),
  ];

  const entry = order.find((candidate) => candidate.invalid);

  return entry === undefined ? null : { ref: entry.ref, focus: entry.focus };
};

const HoldingFormScreen: FC<HoldingFormScreenProps> = ({ route, navigation }) => {
  const { accountId, holdingId } = route.params;
  const { t } = useTranslation();
  // Human display text for the id-like holding types, the bond kind, and the
  // two frequency chip rows below; the chips still report the underlying
  // value on select. Built from the catalog inside the component (rather than
  // a module-level constant) so it always reflects the active language.
  const typeLabels: Record<HoldingType, string> = {
    card: t('forms.holding.card'),
    term_deposit: t('forms.holding.deposit'),
    bond: t('forms.holding.bond'),
    cash: t('forms.account.cash'),
    crypto_asset: t('forms.holding.cryptoAsset'),
    jar: t('forms.holding.jar'),
    property_item: t('forms.holding.propertyItem'),
  };
  const bondKindLabels: Record<BondKind, string> = {
    government: t('forms.holding.government'),
    corporate: t('forms.holding.corporate'),
  };
  // Coupon frequency additionally offers 'semiannually', which compounding
  // does not; the shared vocabulary (monthly/quarterly/annually) resolves to
  // the same catalog key either way.
  const compoundingLabels: Record<CompoundingFrequency, string> = {
    'bi-weekly': t('forms.holding.biWeekly'),
    monthly: t('forms.holding.monthly'),
    quarterly: t('forms.holding.quarterly'),
    annually: t('forms.holding.annually'),
  };
  const couponFrequencyLabels: Record<CouponFrequency, string> = {
    monthly: t('forms.holding.monthly'),
    quarterly: t('forms.holding.quarterly'),
    semiannually: t('forms.holding.semiannually'),
    annually: t('forms.holding.annually'),
  };
  // A `holdingId` in the route params switches the form to EDIT mode: the same
  // fields, seeded from the existing holding, saving through the update path
  // rather than create.
  const isEdit = holdingId !== undefined;
  // The account this holding is created under; its `kind` constrains which
  // holding types are offered (a bank can't hold a crypto asset or cash, etc.).
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(accountId), ['accounts']);
  const account = accounts.at(0);
  const accountKind = account?.kind;
  // Whether THIS account is a live sync connection (see `isSyncedAccount` in
  // `../../../holdings/deletable`) — an unresolved account (query still
  // loading) is treated as not-yet-synced.
  const isSynced = account !== undefined && isSyncedAccount(account);
  // The full set of types this account kind may hold — used in EDIT mode so an
  // existing synced (card/jar) row's type still renders read-only.
  const allowedTypes = accountKind ? holdingTypesForAccountKind[accountKind] : holdingTypes;
  // The types a user may MANUALLY create here: the full set minus whichever
  // sync-only types THIS account's sync actually owns. A live-synced (Monobank)
  // bank excludes both card and jar (its sync creates them); a non-synced,
  // statement-import-only bank has no sync to own a card, so card is offered —
  // jar stays excluded regardless (see `creatableHoldingTypesForAccount`'s
  // comment). The create form offers only these; edit mode keeps the full set
  // (above).
  const creatableTypes = accountKind
    ? creatableHoldingTypesForAccount(accountKind, isSynced)
    : holdingTypes;
  // Create mode offers the manually-creatable subset; edit mode shows the full
  // set (its chip is read-only) so a synced card/jar row still displays.
  const typeOptions = isEdit ? allowedTypes : creatableTypes;

  // In edit mode, load the holding being edited so its fields can seed the form.
  // The query always runs (hooks can't be conditional); an empty id in create
  // mode simply matches no row.
  const { data: editHoldings } = useLiveQuery(holdingsRepo.byIdQuery(holdingId ?? ''), [
    'holdings',
  ]);
  const editingHolding = isEdit ? editHoldings.at(0) : undefined;
  // A synced (Monobank) holding's balance is owned by the sync, not the user:
  // its name/icon/color stay editable, but the balance field is hidden and never
  // written back so an edit does not clobber the last synced balance. The
  // account row loaded above gates this: a disconnected account KEEPS its
  // holdings' sync keys (so a reconnect re-adopts them), and the user owns
  // those balances again meanwhile.
  const isSyncedEdit =
    editingHolding !== undefined && isSyncedHolding(editingHolding, accounts.at(0));

  const [name, setName] = useState('');
  // The selected type starts at `card`, then the effect below snaps it to the
  // first CREATABLE type for the account's kind once it loads — so a bank create
  // (where card/jar are sync-only and excluded) defaults to `term_deposit`, and
  // an edit seeds the real type from the row.
  const [type, setType] = useState<HoldingType>('card');
  const [currency, setCurrency] = useState<Currency>('UAH');
  // DEVICE BUG fix (root cause): while the currency sheet's search field can
  // be focused, this screen's background ScrollView must NOT react to the
  // keyboard's frame change — it does not contain that responder, but
  // `automaticallyAdjustKeyboardInsets` reacts to any focus regardless
  // (see `screen.component.tsx`, `CurrencyField`'s `onOpenChange`).
  const [isCurrencySheetOpen, setIsCurrencySheetOpen] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('');
  // The icon is null until the user picks one ("not dirty"): while null, the
  // chip shows the selected type's default glyph (holdingTypeSymbol[type]) and
  // switching type re-derives it, so an untouched icon follows the type. Once
  // the user picks (icon !== null, "dirty"), that choice overrides the default
  // and type changes no longer move it.
  const [icon, setIcon] = useState<string | null>(null);
  // The color mirrors the icon's dirty pattern: null until the user taps a
  // swatch ("not dirty"). While null, the effective color follows the selected
  // type's default (defaultHoldingColor[type]), so the ColorPicker highlights
  // that swatch and switching type moves it. Once picked (color !== null,
  // "dirty"), the choice sticks and type changes no longer move it.
  const [color, setColor] = useState<string | null>(null);
  // `resolveEntityColor` — not a bare nullish-coalesce onto the type default —
  // because `color` here is seeded straight from a stored row
  // (setColor(holding.color) below): a stored empty-string color reaches
  // here as an unusable value the bare pattern would let through as ''.
  const effectiveColor = resolveEntityColor(color, defaultHoldingColor[type]);

  // Keep the selected type valid for what the form currently OFFERS. The account
  // loads asynchronously, so once its option set is known, a default (or
  // previously selected) type outside that set snaps to the first offered type —
  // which also re-derives the non-dirty icon to match. `typeOptions` is the
  // creatable subset in create mode (so a bank create snaps `card` -> the first
  // creatable type, `term_deposit`) and the full set in edit mode (so a seeded
  // synced card/jar stays put).
  useEffect(() => {
    if (!typeOptions.includes(type)) {
      setType(typeOptions[0]);
    }
  }, [typeOptions, type]);

  // The scroll-mode ScrollView's ref, so adding a contribution can bring the
  // newly appended row into view. `useScrollOffset` reads its LIVE content
  // offset, so a blocked Save's `scrollToField` call below knows whether the
  // first-invalid field is already visible without re-measuring the scroll
  // position itself.
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const headerInset = useHeaderInset();
  // The ScrollView's own total content height, captured off `Screen`'s
  // `onContentSizeChange` (forwarded from its ScrollView) so `scrollToField`
  // can bound an over-large target against the real content extent — see
  // scroll-to-field.ts's own overshoot-clamp doc. A plain ref, not state:
  // read only imperatively at Save-press time, never needs to re-render.
  const contentHeightRef = useRef(0);

  // Per-field wrapper refs, one per validated field, passed to `scrollToField`
  // in `save`'s ordered first-invalid scroll below — each field's own inline
  // error (a `TextField`/`HoldingIdentityField` `error` prop, or a relocated
  // `FieldError` for the two group/relational reasons) sits right beside it,
  // so the scroll always lands on the same field the message is anchored to.
  const nameFieldRef = useRef<FieldInstance>(null);
  const contributionsFieldRef = useRef<FieldInstance>(null);
  // The LAST contribution row's own wrapper — a SEPARATE ref from
  // `contributionsFieldRef` above (which always anchors row 0, for the
  // Save-invalid scroll) — so `addContribution` below can scroll to whichever
  // row is newest, via the SAME occlusion-aware `scrollToField` helper
  // (round-6 device feedback item 3), rather than an unconditional
  // `scrollToEnd` that used to fire even when the new row was already
  // fully visible.
  const lastContributionFieldRef = useRef<FieldInstance>(null);
  const annualRateFieldRef = useRef<FieldInstance>(null);
  const termMonthsFieldRef = useRef<FieldInstance>(null);
  const quantityFieldRef = useRef<FieldInstance>(null);
  const faceValueFieldRef = useRef<FieldInstance>(null);
  const couponPctFieldRef = useRef<FieldInstance>(null);
  const maturityDateFieldRef = useRef<FieldInstance>(null);
  const propertyCostFieldRef = useRef<FieldInstance>(null);
  // The TEXT-backed validated fields' own inner TextInput/name-input, so a
  // blocked Save can focus the first-invalid one imperatively once it has
  // scrolled into view — mirrors `TextField`'s own `inputRef` /
  // `HoldingIdentityField`'s own `nameInputRef`. The contributions group and
  // the maturity date are composite/picker targets with no single input to
  // focus (a picker/date has no keyboard of its own), so they have no
  // matching entry here — `save`'s scroll below simply omits the focus
  // callback for those two.
  const nameInputRef = useRef<TextInputInstance>(null);
  const annualRateInputRef = useRef<TextInputInstance>(null);
  const termMonthsInputRef = useRef<TextInputInstance>(null);
  const quantityInputRef = useRef<TextInputInstance>(null);
  const faceValueInputRef = useRef<TextInputInstance>(null);
  const couponPctInputRef = useRef<TextInputInstance>(null);
  const propertyCostInputRef = useRef<TextInputInstance>(null);

  // term deposit state
  const nextContributionId = useRef(1);
  const [contributions, setContributions] = useState<Contribution[]>([
    { id: 0, amount: '', date: null, saved: false },
  ]);
  const [annualRate, setAnnualRate] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [recapitalization, setRecap] = useState(false);
  const [compounding, setCompounding] = useState<CompoundingFrequency>('bi-weekly');

  // bond state
  const [quantity, setQuantity] = useState('');
  const [faceValue, setFaceValue] = useState('');
  const [couponPct, setCouponPct] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState<number | null>(null);
  const [maturityDate, setMaturityDate] = useState<number | null>(null);
  const [bondKind, setBondKind] = useState<BondKind>('government');
  // Semiannual coupons are the common case for the government/corporate bonds
  // this tracks (the Monobank statement default), so the picker starts there.
  const [couponFrequency, setCouponFrequency] = useState<CouponFrequency>('semiannually');

  // property_item state. `propertyCost` is CREATE-only (PropertySection hides
  // its field in edit mode — cost/quantity history is fixed at creation; a
  // later revaluation goes through the dedicated "Update value" form
  // instead). `propertyLots` holds the ORIGINAL (hydrated) lots in edit mode,
  // carried through unchanged on save so an edit never rewrites cost/quantity
  // history — only `propertyCategory` is user-editable there.
  const [propertyCategory, setPropertyCategory] = useState<PropertyCategory>('real_estate');
  const [propertyCost, setPropertyCost] = useState('');
  const [propertyLots, setPropertyLots] = useState<Lot[]>([]);

  // Seed the form once from the loaded holding (edit mode only). `useLiveQuery`
  // resolves asynchronously, so the initial render precedes the data; a one-shot
  // ref guards against re-seeding (and clobbering in-progress edits) on every
  // subsequent live-query emission. The type-specific fields are rebuilt from
  // the stored metadata: minor-unit money reads back as grouped major strings.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!isEdit || hydrated.current || editingHolding === undefined) {
      return;
    }
    hydrated.current = true;
    const holding = editingHolding;
    setName(holding.name);
    setType(holding.type);
    setCurrency(holding.currency);
    setIcon(holding.icon);
    setColor(holding.color);

    if (holding.type === 'term_deposit') {
      const meta = asTermDepositMeta(holding.metadata);
      if (meta) {
        const rows = seedContributions(meta, holding.currency);
        setContributions(rows);
        nextContributionId.current = rows.length;
        setAnnualRate(String(meta.annualRatePct));
        setTermMonths(String(meta.termMonths));
        setRecap(meta.recapitalization);
        setCompounding(meta.compounding);
      }
      return;
    }

    if (holding.type === 'bond') {
      const meta = asBondMeta(holding.metadata);
      if (meta) {
        const fields = seedBondFields(meta, holding.currency);
        setQuantity(fields.quantity);
        setFaceValue(fields.faceValue);
        setCouponPct(fields.couponPct);
        setPurchasePrice(fields.purchasePrice);
        setPurchaseDate(fields.purchaseDate);
        setMaturityDate(fields.maturityDate);
        setBondKind(fields.bondKind);
        setCouponFrequency(fields.couponFrequency);
      }
      return;
    }

    if (holding.type === 'property_item') {
      seedPropertyFields(holding, { setPropertyCategory, setPropertyLots });
      return;
    }

    setOpeningBalance(groupAmount(majorAmountText(holding.currency, holding.balanceMinorUnits)));
  }, [isEdit, editingHolding]);

  // The stack sets the static "Add Holding" title; in edit mode override it with
  // "Edit Holding" so the header reads correctly for the update flow.
  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: t('forms.holding.editTitle') });
    }
  }, [isEdit, navigation, t]);

  const addContribution = (): void => {
    const id = nextContributionId.current++;
    setContributions((rows) => [...rows, { id, amount: '', date: null, saved: false }]);

    // The new row's fields are only measured after this render commits, so
    // defer the scroll to the next frame — otherwise `lastContributionFieldRef`
    // would still measure the PRE-add (one row shorter) layout. Same
    // deferred-RAF pattern as the categories screen's own
    // `scrollToAddCategoryForm`. Routes through the SAME occlusion-aware
    // `scrollToField` helper `save`'s own scroll-to-invalid uses below (round-6
    // device feedback item 3) — an unconditional `scrollToEnd` used to fire
    // even when the new row was already fully on screen.
    requestAnimationFrame(() => {
      scrollToField(scrollableRef, lastContributionFieldRef, {
        currentOffset: scrollOffset.value,
        headerInset,
        contentHeight: contentHeightRef.current,
      });
    });
  };

  const removeContribution = (index: number): void => {
    setContributions((rows) => rows.filter((_, i) => i !== index));
  };

  const updateContributionAmount = (index: number, next: string): void => {
    setContributions((rows) =>
      rows.map((row, i) => {
        return i === index ? { ...row, amount: next } : row;
      }),
    );
  };

  const updateContributionDate = (index: number, next: number): void => {
    setContributions((rows) =>
      rows.map((row, i) => {
        return i === index ? { ...row, date: next } : row;
      }),
    );
  };

  // Drop blank/partial rows: keep only a positive amount paired with a picked date.
  const parsedContributions = (): { amountMinorUnits: number; date: number }[] =>
    contributions.flatMap(({ amount, date }) => {
      const amountValue = parseAmount(amount);
      if (!(amountValue > 0) || date === null) {
        return [];
      }

      return [{ amountMinorUnits: Money.fromMajor(currency, amountValue).minorUnits, date }];
    });

  // A single contribution ROW's own validity: a positive amount paired with a
  // picked date, the same pair `parsedContributions` requires to keep a row.
  // Used to catch a row `parsedContributions` would otherwise silently DROP —
  // a blank or partially-filled row (most often a fresh `addContribution`
  // left unfilled) — while at least one OTHER row is already valid, so the
  // overall `contributionsRequiredError` (below) never fires (round-4 device
  // feedback item 10: saving used to drop that row without any indication it
  // was ignored).
  const isContributionRowValid = (contribution: Contribution): boolean =>
    parseAmount(contribution.amount) > 0 && contribution.date !== null;

  const buildDepositMetadata = (): Record<string, unknown> | undefined => {
    const rows = parsedContributions();
    if (rows.length === 0) {
      return undefined;
    }
    return {
      contributions: rows,
      annualRatePct: parseAmount(annualRate) || 0,
      termMonths: parseAmount(termMonths) || 0,
      recapitalization,
      compounding,
    };
  };

  const buildBondMetadata = (): Record<string, unknown> => {
    const quantityValue = parseAmount(quantity) || 0;
    const faceValueMinorUnits = Money.fromMajor(currency, parseAmount(faceValue) || 0).minorUnits;
    const priceValue = parseAmount(purchasePrice);
    return {
      quantity: quantityValue,
      faceValueMinorUnits,
      couponPct: parseAmount(couponPct) || 0,
      // The total actually paid. If left blank, fall back to nominal (par), so
      // the purchase entry and expected profit read as break-even.
      purchasePriceMinorUnits:
        priceValue > 0
          ? Money.fromMajor(currency, priceValue).minorUnits
          : quantityValue * faceValueMinorUnits,
      purchaseDate: purchaseDate ?? Date.now(),
      maturityDate: maturityDate ?? Date.now(),
      bondKind,
      couponFrequency,
    };
  };

  const buildMetadata = (): Record<string, unknown> | undefined => {
    if (type === 'term_deposit') {
      return buildDepositMetadata();
    }
    if (type === 'bond') {
      return buildBondMetadata();
    }
    // A property's CREATE metadata is built separately (see `save`'s create
    // branch, `buildPropertyCreatePayload`) — this branch covers EDIT mode
    // only: category is user-editable, but the ORIGINAL (hydrated) lots are
    // carried through unchanged, since cost/quantity history is fixed at
    // creation (a later revaluation goes through the "Update value" form
    // instead, never through this metadata patch).
    if (type === 'property_item' && isEdit) {
      return { category: propertyCategory, lots: propertyLots };
    }
    return undefined;
  };

  // A term deposit needs at least one contribution with a positive amount and a
  // picked date (parsedContributions already drops blank/partial rows), EVERY
  // row present to be either fully filled in or removed (never silently
  // dropped — round-4 device feedback item 10), a non-negative annual rate
  // that was actually entered, and a whole-month term greater than zero.
  // Recapitalization and compounding always carry defaults. Not gated on
  // whether the name is filled: the name's own required asterisk covers that
  // separately.
  const termDepositReasonKey = (): TermDepositReasonKey | null => {
    if (parsedContributions().length === 0) {
      return 'forms.holding.contributionsRequiredError';
    }

    if (contributions.some((contribution) => !isContributionRowValid(contribution))) {
      return 'forms.holding.contributionIncompleteError';
    }

    const rate = parseAmount(annualRate);

    if (annualRate.trim() === '' || !(rate >= 0)) {
      return 'forms.holding.annualRateError';
    }

    const months = parseAmount(termMonths);

    if (!(Number.isInteger(months) && months > 0)) {
      return 'forms.holding.termMonthsError';
    }

    return null;
  };

  // Derived from `termDepositReasonKey` so the two can never disagree: valid
  // exactly when there is no reason to reject.
  const isTermDepositValid = (): boolean => termDepositReasonKey() === null;

  // A bond needs a positive quantity and face value, a non-negative coupon that
  // was actually entered, both dates picked, and a maturity strictly after the
  // purchase. Coupon frequency always carries a default, so it is always valid.
  const isBondValid = (): boolean =>
    parseAmount(quantity) > 0 &&
    parseAmount(faceValue) > 0 &&
    couponPct.trim() !== '' &&
    parseAmount(couponPct) >= 0 &&
    purchaseDate !== null &&
    maturityDate !== null &&
    maturityDate > purchaseDate;

  // The reason `isBondValid` above is false, for the SAME checks in the
  // SAME priority order. A missing (not-yet-picked) date is already covered
  // by that field's own required asterisk, so this returns null rather than
  // a redundant "pick a date" line until BOTH dates are set — only then does
  // an invalid ORDER between them get its own reason.
  const bondReasonKey = (): BondReasonKey | null => {
    if (!(parseAmount(quantity) > 0)) {
      return 'forms.holding.quantityError';
    }

    if (!(parseAmount(faceValue) > 0)) {
      return 'forms.holding.faceValueError';
    }

    if (couponPct.trim() === '' || !(parseAmount(couponPct) >= 0)) {
      return 'forms.holding.couponPctError';
    }

    if (purchaseDate !== null && maturityDate !== null && maturityDate <= purchaseDate) {
      return 'forms.holding.maturityDateError';
    }

    return null;
  };

  // The cost field only applies at CREATE time (PropertySection hides it in
  // edit mode: cost/quantity history is fixed at creation, a later
  // revaluation goes through the dedicated "Update value" form instead), so
  // this only rejects on create — an edit always passes.
  const propertyReasonKey = (): PropertyReasonKey | null =>
    !isEdit && !(parseAmount(propertyCost) > 0) ? 'forms.holding.propertyCostError' : null;

  // Derived from `propertyReasonKey` so the two can never disagree: valid
  // exactly when there is no reason to reject.
  const isPropertyValid = (): boolean => propertyReasonKey() === null;

  const isValid =
    name.trim().length > 0 &&
    match(type)
      .with('term_deposit', isTermDepositValid)
      .with('bond', isBondValid)
      .with('property_item', isPropertyValid)
      .with('card', 'cash', 'crypto_asset', 'jar', () => true)
      .exhaustive();

  const [attemptedSave, setAttemptedSave] = useState(false);

  const { showNameReason } = saveReasonsFor({ attemptedSave, name });

  const save = async (): Promise<void> => {
    if (!isValid) {
      setAttemptedSave(true);

      const target = firstInvalidFieldRef({
        name,
        type,
        termDepositReasonKey: termDepositReasonKey(),
        bondReasonKey: bondReasonKey(),
        propertyReasonKey: propertyReasonKey(),
        refs: {
          nameFieldRef,
          contributionsFieldRef,
          annualRateFieldRef,
          termMonthsFieldRef,
          quantityFieldRef,
          faceValueFieldRef,
          couponPctFieldRef,
          maturityDateFieldRef,
          propertyCostFieldRef,
        },
        focus: {
          name: () => nameInputRef.current?.focus(),
          annualRate: () => annualRateInputRef.current?.focus(),
          termMonths: () => termMonthsInputRef.current?.focus(),
          quantity: () => quantityInputRef.current?.focus(),
          faceValue: () => faceValueInputRef.current?.focus(),
          couponPct: () => couponPctInputRef.current?.focus(),
          propertyCost: () => propertyCostInputRef.current?.focus(),
        },
      });

      if (target) {
        scrollToField(
          scrollableRef,
          target.ref,
          {
            currentOffset: scrollOffset.value,
            headerInset,
            contentHeight: contentHeightRef.current,
          },
          target.focus,
        );
      }

      return;
    }

    const metadata = buildMetadata();

    try {
      if (isEdit && holdingId !== undefined) {
        // Update the editable fields in one transaction (see buildHoldingPatch:
        // deposit/bond write metadata, every other type writes its balance). The
        // icon routes through setIcon (so a cleared icon persists an explicit
        // null), the same split the create path uses. Type/currency are read-only.
        //
        // `updateWithBalanceDelta`, not `update`: an edited balance also has to
        // land on the ledger as a `manual` transaction for the difference, or the
        // holding's history stops being derivable from its transactions and the
        // whole past net-worth series shifts under the edit (kiko-domain). A patch
        // with no balance in it (a deposit/bond, or a synced holding) writes no
        // ledger row, so this is the right call for every edit.
        await holdingsRepo.updateWithBalanceDelta(
          holdingId,
          buildHoldingPatch({
            name,
            color,
            type,
            currency,
            openingBalance,
            metadata,
            isSynced: isSyncedEdit,
          }),
          Date.now(),
        );

        // Write the icon unconditionally in edit mode so clearing a custom icon
        // (icon === null) persists the removal rather than leaving the old glyph.
        await holdingsRepo.setIcon(holdingId, icon);

        navigation.goBack();

        return;
      }

      // A property's create payload is built separately (`buildPropertyCreatePayload`):
      // a zero stored balance, one lot, and a first manual price point equal
      // to the entered cost, all written in the SAME transaction
      // (`holdingsRepo.create`'s `firstPricePoint` param) — every other type
      // writes its entered opening balance and the metadata `buildMetadata`
      // built above.
      const newHoldingId = await holdingsRepo.create({
        accountId,
        name,
        type,
        currency,
        // Persist the color only when the user picked one (dirty). Left null, the
        // row follows its type's default at display time — the same fallback the
        // icon uses — so a type-default color is not frozen onto the row.
        color,
        ...(type === 'property_item'
          ? buildPropertyCreatePayload({ category: propertyCategory, currency, cost: propertyCost })
          : {
              balanceMinorUnits: Money.fromMajor(currency, parseAmount(openingBalance) || 0)
                .minorUnits,
              metadata,
            }),
      });

      // Persist the chosen icon on the freshly-created row, using the id the
      // create resolved to. Awaited so it commits before navigating away.
      if (icon !== null) {
        await holdingsRepo.setIcon(newHoldingId, icon);
      }

      navigation.goBack();
    } catch {
      // Mirrors contribution-form's and account-form's Alert pattern: a write
      // failure keeps the screen open with the entered values intact, rather
      // than navigating away as if nothing was wrong.
      Alert.alert(t('forms.fields.saveErrorTitle'), t('forms.fields.saveErrorMessage'));
    }
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  // Computed once here (rather than inline at each render site below) so the
  // group `<FieldError>`'s own `message` prop reuses this exact string
  // instead of calling `t()` a second time for the same key.
  const contributionsRequiredMessage = fieldErrorMessage(
    t,
    attemptedSave,
    termDepositReasonKey(),
    'forms.holding.contributionsRequiredError',
  );
  const contributionIncompleteMessage = fieldErrorMessage(
    t,
    attemptedSave,
    termDepositReasonKey(),
    'forms.holding.contributionIncompleteError',
  );
  const maturityDateErrorMessage = fieldErrorMessage(
    t,
    attemptedSave,
    bondReasonKey(),
    'forms.holding.maturityDateError',
  );

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      automaticallyAdjustKeyboardInsets={!isCurrencySheetOpen}
      onContentSizeChange={(_width, height) => {
        contentHeightRef.current = height;
      }}
      footer={
        <Button onPress={onSave} disabled={isSubmitting}>
          {t('common.save')}
        </Button>
      }
    >
      <Box gap={4} testID="holding-form">
        <View ref={nameFieldRef}>
          <HoldingIdentityField
            icons={KIKO_ENTITIES_ICONS}
            icon={icon}
            fallbackIcon={holdingTypeSymbol[type]}
            iconColor={effectiveColor}
            name={name}
            onChangeName={setName}
            onSelectIcon={setIcon}
            onRemoveIcon={() => setIcon(null)}
            namePlaceholder={t('forms.holding.namePlaceholder')}
            required
            error={showNameReason ? t('forms.fields.nameRequiredError') : undefined}
            nameInputRef={nameInputRef}
            testID="holding-name"
          />
        </View>

        <ColorPicker label={t('forms.fields.color')} value={effectiveColor} onSelect={setColor} />

        <Divider testID="form-divider" />

        {/* A holding's type shapes its metadata and value math, and its currency
            fixes the unit of every stored balance/transaction; no repo path
            re-shapes either, so both are read-only in edit mode — shown, but not
            switchable. `typeOptions` is the manually-creatable subset in create
            mode: a bank drops the sync-only card/jar (Monobank owns those), so a
            bank create offers only term_deposit / bond. Edit mode uses the full
            set so an existing synced card/jar row still displays its (read-only)
            type. */}
        <ChipRow
          label={t('forms.holding.type')}
          options={typeOptions}
          selected={type}
          onSelect={setType}
          labels={typeLabels}
          icons={holdingTypeSymbol}
          disabled={isEdit}
        />

        <CurrencyField
          label={t('forms.fields.currency')}
          selected={currency}
          onSelect={setCurrency}
          disabled={isEdit}
          onOpenChange={setIsCurrencySheetOpen}
          testID="holding-currency-field"
        />

        {!isLedgerlessHoldingType(type) && !isSyncedEdit && (
          <TextField
            label={t('forms.holding.balance')}
            value={openingBalance}
            onChangeText={(text) => setOpeningBalance(groupAmount(text))}
            keyboardType="decimal-pad"
            placeholder={t('forms.holding.balancePlaceholder')}
            suffix={currencySymbol[currency]}
          />
        )}

        {type === 'term_deposit' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('forms.holding.contributions')}</Text>

            {/* The mapped contributions and the inline Add button form ONE
                group under a tighter inner gap (spacing(2) = 8pt), so the small
                Add button hugs the list — ~8pt below the last contribution —
                rather than sitting the section's full spacing(4) = 16pt below
                it. That 16pt is the uniform outer-section gap between
                full-height rows (headings, dividers, the balance group); above
                a short `size="small"` button, and right after each
                contribution's own tight 8pt internal rhythm, it read as a
                disproportionate top gap (the Add button is NOT the shared
                Screen footer, so last round's footer-padding fix never touched
                it). The contributions keep their own spacing(4) = 16pt
                separation from each other via the inner list Box, so distinct
                contributions stay visually distinct. */}
            <Box gap={2} testID="contributions-group">
              <Box gap={4}>
                {contributions.map((contribution, index) => (
                  <View
                    key={contribution.id}
                    // Row 0 anchors `contributionsFieldRef` (the Save-invalid
                    // scroll target, unchanged); the LAST row additionally
                    // anchors `lastContributionFieldRef` (round-6 item 3's
                    // add-row scroll target) — a callback ref, since a single
                    // native element can only take one `ref` prop, and a
                    // one-row list satisfies both conditions on the SAME node.
                    ref={(node) => {
                      if (index === 0) {
                        contributionsFieldRef.current = node;
                      }
                      if (index === contributions.length - 1) {
                        lastContributionFieldRef.current = node;
                      }
                    }}
                  >
                    <Box gap={2}>
                      <TextField
                        label={t('forms.holding.contributionAmount', { index: index + 1 })}
                        value={contribution.amount}
                        onChangeText={(next) => updateContributionAmount(index, groupAmount(next))}
                        keyboardType="decimal-pad"
                        placeholder={t('forms.holding.contributionPlaceholder')}
                        suffix={currencySymbol[currency]}
                        required
                      />

                      <DateField
                        label={t('forms.holding.contributionDate', { index: index + 1 })}
                        value={contribution.date}
                        onChange={(next) => updateContributionDate(index, next)}
                        placeholder={t('forms.holding.selectDatePlaceholder')}
                        required
                      />

                      {index === 0 && contributionsRequiredMessage !== undefined && (
                        <FieldError message={contributionsRequiredMessage} />
                      )}

                      {/* A row left blank or half-filled once at least one
                        OTHER row is already valid — `contributionsRequiredMessage`
                        above only fires when EVERY row is empty, so this
                        catches the row `parsedContributions` would otherwise
                        silently drop (round-4 device feedback item 10). */}
                      {contributionIncompleteMessage !== undefined &&
                        !isContributionRowValid(contribution) && (
                          <FieldError message={contributionIncompleteMessage} />
                        )}

                      {contributions.length > 1 && (
                        <Button
                          variant="destructiveTonal"
                          size="small"
                          fullWidth={false}
                          icon="trash"
                          disabled={contribution.saved}
                          accessibilityLabel={t('forms.holding.removeContribution', {
                            index: index + 1,
                          })}
                          onPress={() => removeContribution(index)}
                        >
                          {t('forms.holding.remove')}
                        </Button>
                      )}
                    </Box>
                  </View>
                ))}
              </Box>

              <Button
                variant="secondaryTonal"
                size="small"
                fullWidth={false}
                icon="plus"
                onPress={addContribution}
              >
                {t('forms.holding.addContribution')}
              </Button>
            </Box>

            <Divider testID="form-divider" />

            <Text variant="heading">{t('forms.holding.terms')}</Text>

            <View ref={annualRateFieldRef}>
              <TextField
                label={t('forms.holding.annualRatePct')}
                value={annualRate}
                onChangeText={setAnnualRate}
                keyboardType="decimal-pad"
                placeholder={t('forms.holding.annualRatePlaceholder')}
                required
                error={fieldErrorMessage(
                  t,
                  attemptedSave,
                  termDepositReasonKey(),
                  'forms.holding.annualRateError',
                )}
                inputRef={annualRateInputRef}
              />
            </View>

            <View ref={termMonthsFieldRef}>
              <TextField
                label={t('forms.holding.termMonths')}
                value={termMonths}
                onChangeText={setTermMonths}
                keyboardType="number-pad"
                placeholder={t('forms.holding.termMonthsPlaceholder')}
                required
                error={fieldErrorMessage(
                  t,
                  attemptedSave,
                  termDepositReasonKey(),
                  'forms.holding.termMonthsError',
                )}
                inputRef={termMonthsInputRef}
              />
            </View>

            <Switch
              label={t('forms.holding.recapitalization')}
              value={recapitalization}
              onValueChange={setRecap}
            />

            <ChipRow
              label={t('forms.holding.compounding')}
              options={compoundingOptions}
              selected={compounding}
              onSelect={setCompounding}
              labels={compoundingLabels}
            />
          </Box>
        )}

        {type === 'bond' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('forms.holding.details')}</Text>

            <View ref={quantityFieldRef}>
              <TextField
                label={t('forms.holding.quantity')}
                value={quantity}
                onChangeText={(text) => setQuantity(groupAmount(text))}
                keyboardType="number-pad"
                placeholder={t('forms.holding.quantityPlaceholder')}
                required
                error={fieldErrorMessage(
                  t,
                  attemptedSave,
                  bondReasonKey(),
                  'forms.holding.quantityError',
                )}
                inputRef={quantityInputRef}
              />
            </View>

            <View ref={faceValueFieldRef}>
              <TextField
                label={t('forms.holding.faceValue')}
                value={faceValue}
                onChangeText={(text) => setFaceValue(groupAmount(text))}
                keyboardType="decimal-pad"
                placeholder={t('forms.holding.faceValuePlaceholder')}
                suffix={currencySymbol[currency]}
                required
                error={fieldErrorMessage(
                  t,
                  attemptedSave,
                  bondReasonKey(),
                  'forms.holding.faceValueError',
                )}
                inputRef={faceValueInputRef}
              />
            </View>

            <View ref={couponPctFieldRef}>
              <TextField
                label={t('forms.holding.couponPct')}
                value={couponPct}
                onChangeText={setCouponPct}
                keyboardType="decimal-pad"
                placeholder={t('forms.holding.couponPlaceholder')}
                required
                error={fieldErrorMessage(
                  t,
                  attemptedSave,
                  bondReasonKey(),
                  'forms.holding.couponPctError',
                )}
                inputRef={couponPctInputRef}
              />
            </View>

            <TextField
              label={t('forms.holding.purchasePrice')}
              value={purchasePrice}
              onChangeText={(text) => setPurchasePrice(groupAmount(text))}
              keyboardType="decimal-pad"
              placeholder={t('forms.holding.purchasePricePlaceholder')}
              suffix={currencySymbol[currency]}
            />

            <DateField
              label={t('forms.holding.purchaseDate')}
              value={purchaseDate}
              onChange={setPurchaseDate}
              placeholder={t('forms.holding.selectDatePlaceholder')}
              required
            />

            <View ref={maturityDateFieldRef} testID="maturity-date-field">
              <DateField
                label={t('forms.holding.maturityDate')}
                value={maturityDate}
                onChange={setMaturityDate}
                placeholder={t('forms.holding.selectDatePlaceholder')}
                required
                error={maturityDateErrorMessage}
              />
            </View>

            <ChipRow
              label={t('forms.holding.bondKind')}
              options={bondKinds}
              selected={bondKind}
              onSelect={setBondKind}
              labels={bondKindLabels}
            />

            <ChipRow
              label={t('forms.holding.couponFrequency')}
              options={couponFrequencies}
              selected={couponFrequency}
              onSelect={setCouponFrequency}
              labels={couponFrequencyLabels}
            />
          </Box>
        )}

        {type === 'property_item' && (
          <Box gap={4}>
            <Divider testID="form-divider" />

            <Text variant="heading">{t('forms.holding.details')}</Text>

            <PropertySection
              category={propertyCategory}
              onSelectCategory={setPropertyCategory}
              showCost={!isEdit}
              cost={propertyCost}
              onChangeCost={(text) => setPropertyCost(groupAmount(text))}
              currencySuffix={currencySymbol[currency]}
              costError={fieldErrorMessage(
                t,
                attemptedSave,
                propertyReasonKey(),
                'forms.holding.propertyCostError',
              )}
              costFieldRef={propertyCostFieldRef}
              costInputRef={propertyCostInputRef}
            />
          </Box>
        )}
      </Box>
    </Screen>
  );
};

export default HoldingFormScreen;
