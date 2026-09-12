import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { holdingsRepo } from '@kiko/holdings/repo';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { match } from 'ts-pattern';

import { type Currency, currencyOptions, currencySymbol } from '../../currency/currency';
import { currencySignSymbol } from '../../currency/currency-symbols';
import { Money } from '../../currency/money';
import { parseAmount } from '../../currency/parse';
import type { HoldingRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import Divider from '../../design-system/components/divider';
import Screen from '../../design-system/components/screen';
import Switch from '../../design-system/components/switch';
import Text from '../../design-system/components/text';
import TextField from '../../design-system/components/text-field';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { isSyncedHolding } from '../../holdings/deletable';
import { defaultHoldingColor } from '../../holdings/entity-colors';
import { holdingTypeSymbol } from '../../holdings/entity-symbols';
import {
  asBondMeta,
  asTermDepositMeta,
  type BondKind,
  type BondMeta,
  type CompoundingFrequency,
  type TermDepositMeta,
} from '../../holdings/holding-metadata';
import {
  creatableHoldingTypesForAccountKind,
  type HoldingType,
  holdingTypes,
  holdingTypesForAccountKind,
} from '../../holdings/holding-type';
import type { AccountsStackParamList } from '../../navigation/types';

import { groupAmount, majorAmountText } from './amount-format';
import ChipRow from './chip-row';
import ColorPicker from './color-picker';
import DateField from './date-field';
import HoldingIdentityField from './holding-identity-field';
import { useSubmitOnce } from './use-submit-once';

type HoldingFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingForm'>;

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

  if (type === 'term_deposit' || type === 'bond') {
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

const bondKinds: readonly BondKind[] = ['government', 'corporate'];

const compoundingOptions: readonly CompoundingFrequency[] = [
  'bi-weekly',
  'monthly',
  'quarterly',
  'annually',
];

const couponFrequencies = ['monthly', 'quarterly', 'semiannually', 'annually'] as const;
type CouponFrequency = (typeof couponFrequencies)[number];

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
  const accountKind = accounts.at(0)?.kind;
  // The full set of types this account kind may hold — used in EDIT mode so an
  // existing synced (card/jar) row's type still renders read-only.
  const allowedTypes = accountKind ? holdingTypesForAccountKind[accountKind] : holdingTypes;
  // The types a user may MANUALLY create here: the full set minus the sync-only
  // types (card/jar under a bank, which Monobank creates itself). The create form
  // offers only these; edit mode keeps the full set (above).
  const creatableTypes = accountKind
    ? creatableHoldingTypesForAccountKind[accountKind]
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
    return undefined;
  };

  // A term deposit needs at least one contribution with a positive amount and a
  // picked date (parsedContributions already drops blank/partial rows), a
  // non-negative annual rate that was actually entered, and a whole-month term
  // greater than zero. Recapitalization and compounding always carry defaults.
  const isTermDepositValid = (): boolean => {
    const rate = parseAmount(annualRate);
    const months = parseAmount(termMonths);

    return (
      parsedContributions().length > 0 &&
      annualRate.trim() !== '' &&
      rate >= 0 &&
      Number.isInteger(months) &&
      months > 0
    );
  };

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

  const isValid =
    name.trim().length > 0 &&
    match(type)
      .with('term_deposit', isTermDepositValid)
      .with('bond', isBondValid)
      .with('card', 'cash', 'crypto_asset', 'jar', () => true)
      .exhaustive();

  const save = async (): Promise<void> => {
    const metadata = buildMetadata();

    // A term deposit with no valid contribution is invalid input: do not persist it.
    if (type === 'term_deposit' && metadata === undefined) {
      return;
    }

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

    const newHoldingId = await holdingsRepo.create({
      accountId,
      name,
      type,
      currency,
      balanceMinorUnits: Money.fromMajor(currency, parseAmount(openingBalance) || 0).minorUnits,
      metadata,
      // Persist the color only when the user picked one (dirty). Left null, the
      // row follows its type's default at display time — the same fallback the
      // icon uses — so a type-default color is not frozen onto the row.
      color,
    });

    // Persist the chosen icon on the freshly-created row, using the id the
    // create resolved to. Awaited so it commits before navigating away.
    if (icon !== null) {
      await holdingsRepo.setIcon(newHoldingId, icon);
    }

    navigation.goBack();
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  return (
    <Screen
      scroll
      footer={
        <Button onPress={onSave} disabled={!isValid || isSubmitting}>
          {t('common.save')}
        </Button>
      }
    >
      <Box gap={4} testID="holding-form">
        <HoldingIdentityField
          icon={icon}
          fallbackIcon={holdingTypeSymbol[type]}
          iconColor={effectiveColor}
          name={name}
          onChangeName={setName}
          onSelectIcon={setIcon}
          onRemoveIcon={() => setIcon(null)}
          namePlaceholder={t('forms.fields.name')}
          required
        />

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

        <ChipRow
          label={t('forms.fields.currency')}
          options={currencyOptions}
          selected={currency}
          onSelect={setCurrency}
          icons={currencySignSymbol}
          disabled={isEdit}
        />

        {type !== 'term_deposit' && type !== 'bond' && !isSyncedEdit && (
          <TextField
            label={t('forms.holding.balance')}
            value={openingBalance}
            onChangeText={(text) => setOpeningBalance(groupAmount(text))}
            keyboardType="decimal-pad"
            placeholder="0.00"
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
                  <Box key={contribution.id} gap={2}>
                    <TextField
                      label={t('forms.holding.contributionAmount', { index: index + 1 })}
                      value={contribution.amount}
                      onChangeText={(next) => updateContributionAmount(index, groupAmount(next))}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
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
                ))}
              </Box>

              <Button
                variant="primary"
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

            <TextField
              label={t('forms.holding.annualRatePct')}
              value={annualRate}
              onChangeText={setAnnualRate}
              keyboardType="decimal-pad"
              placeholder="0"
              required
            />

            <TextField
              label={t('forms.holding.termMonths')}
              value={termMonths}
              onChangeText={setTermMonths}
              keyboardType="number-pad"
              placeholder="0"
              required
            />

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

            <TextField
              label={t('forms.holding.quantity')}
              value={quantity}
              onChangeText={(text) => setQuantity(groupAmount(text))}
              keyboardType="number-pad"
              placeholder="0"
              required
            />

            <TextField
              label={t('forms.holding.faceValue')}
              value={faceValue}
              onChangeText={(text) => setFaceValue(groupAmount(text))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              suffix={currencySymbol[currency]}
              required
            />

            <TextField
              label={t('forms.holding.couponPct')}
              value={couponPct}
              onChangeText={setCouponPct}
              keyboardType="decimal-pad"
              placeholder="0"
              required
            />

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

            <DateField
              label={t('forms.holding.maturityDate')}
              value={maturityDate}
              onChange={setMaturityDate}
              placeholder={t('forms.holding.selectDatePlaceholder')}
              required
            />

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
      </Box>
    </Screen>
  );
};

export default HoldingFormScreen;
