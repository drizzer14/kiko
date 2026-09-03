import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { match } from 'ts-pattern';
import { type Currency, currencyOptions } from '../../currency/currency';
import { Money, toMajor } from '../../currency/money';
import { parseAmount } from '../../currency/parse';
import type { HoldingRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import Switch from '../../design-system/components/switch';
import TextField from '../../design-system/components/text-field';
import { defaultHoldingColor } from '../../holdings/entity-colors';
import { holdingTypeIcon } from '../../holdings/holding-icon';
import {
  asBondMeta,
  asTermDepositMeta,
  type BondKind,
  type BondMeta,
  type CompoundingFrequency,
  type TermDepositMeta,
} from '../../holdings/holding-metadata';
import {
  type HoldingType,
  holdingTypes,
  holdingTypesForAccountKind,
} from '../../holdings/holding-type';
import type { AccountsStackParamList } from '../../navigation/types';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import ChipRow from './chip-row';
import ColorPicker from './color-picker';
import DateField from './date-field';
import { groupAmount } from './amount-format';
import HoldingIdentityField from './holding-identity-field';

type HoldingFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingForm'>;

type Contribution = { id: number; amount: string; date: number | null };

// Seed the repeatable contributions list from a stored deposit: each stored
// amount is minor units, shown back in the field as a grouped major string the
// user can edit (the inverse of the create form's parse-on-save).
const seedContributions = (meta: TermDepositMeta, currency: Currency): Contribution[] =>
  meta.contributions.map((contribution, index) => ({
    id: index,
    amount: groupAmount(String(toMajor(contribution.amountMinorUnits, currency))),
    date: contribution.date,
  }));

// Seed the bond number/date fields from stored metadata. Minor-unit money
// fields (face value, purchase price) convert back to grouped major strings;
// plain-number fields (quantity, coupon %) render verbatim.
const seedBondFields = (
  meta: BondMeta,
  currency: Currency,
): {
  quantity: string;
  faceValue: string;
  couponPct: string;
  purchasePrice: string;
  purchaseDate: number;
  maturityDate: number;
  bondKind: BondKind;
  couponFrequency: BondMeta['couponFrequency'];
} => ({
  quantity: groupAmount(String(meta.quantity)),
  faceValue: groupAmount(String(toMajor(meta.faceValueMinorUnits, currency))),
  couponPct: String(meta.couponPct),
  purchasePrice: groupAmount(String(toMajor(meta.purchasePriceMinorUnits, currency))),
  purchaseDate: meta.purchaseDate,
  maturityDate: meta.maturityDate,
  bondKind: meta.bondKind,
  couponFrequency: meta.couponFrequency,
});

// The partial row an edit-mode save writes: always the editable identity fields
// (name, color), plus the one value field that belongs to the type — a
// deposit/bond's value derives from its metadata (its balance is not stored), so
// those write metadata; every other type writes its edited balance.
const buildHoldingPatch = (params: {
  name: string;
  color: string | null;
  type: HoldingType;
  currency: Currency;
  openingBalance: string;
  metadata: Record<string, unknown> | undefined;
}): Partial<HoldingRow> => {
  const { name, color, type, currency, openingBalance, metadata } = params;

  if (type === 'term_deposit' || type === 'bond') {
    return { name, color, metadata };
  }

  return {
    name,
    color,
    balanceMinorUnits: Money.fromMajor(currency, parseAmount(openingBalance) || 0).minorUnits,
  };
};

// Human display text for the id-like holding types; the chip still reports the
// underlying value on select.
const TYPE_LABELS: Record<HoldingType, string> = {
  card: 'Card',
  term_deposit: 'Term Deposit',
  bond: 'Bond',
  cash: 'Cash',
  crypto_asset: 'Crypto Asset',
  jar: 'Jar',
};

const bondKinds: readonly BondKind[] = ['government', 'corporate'];

const BOND_KIND_LABELS: Record<BondKind, string> = {
  government: 'Government',
  corporate: 'Corporate',
};

const compoundingOptions: readonly CompoundingFrequency[] = [
  'bi-weekly',
  'monthly',
  'quarterly',
  'annually',
];

const COMPOUNDING_LABELS: Record<CompoundingFrequency, string> = {
  'bi-weekly': 'Bi-weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
};

const couponFrequencies = ['monthly', 'quarterly', 'semiannually', 'annually'] as const;
type CouponFrequency = (typeof couponFrequencies)[number];

const COUPON_FREQUENCY_LABELS: Record<CouponFrequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannually: 'Semiannually',
  annually: 'Annually',
};

const HoldingFormScreen: FC<HoldingFormScreenProps> = ({ route, navigation }) => {
  const { accountId, holdingId } = route.params;
  // A `holdingId` in the route params switches the form to EDIT mode: the same
  // fields, seeded from the existing holding, saving through the update path
  // rather than create.
  const isEdit = holdingId !== undefined;
  // The account this holding is created under; its `kind` constrains which
  // holding types are offered (a bank can't hold a crypto asset or cash, etc.).
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(accountId), ['accounts']);
  const accountKind = accounts.at(0)?.kind;
  const allowedTypes = accountKind ? holdingTypesForAccountKind[accountKind] : holdingTypes;

  // In edit mode, load the holding being edited so its fields can seed the form.
  // The query always runs (hooks can't be conditional); an empty id in create
  // mode simply matches no row.
  const { data: editHoldings } = useLiveQuery(holdingsRepo.byIdQuery(holdingId ?? ''), [
    'holdings',
  ]);
  const editingHolding = isEdit ? editHoldings.at(0) : undefined;

  const [name, setName] = useState('');
  const [type, setType] = useState<HoldingType>('card');
  const [currency, setCurrency] = useState<Currency>('UAH');
  const [openingBalance, setOpeningBalance] = useState('');
  // The icon is null until the user picks one ("not dirty"): while null, the
  // chip shows the selected type's default glyph (holdingTypeIcon[type]) and
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
  const effectiveColor = color ?? defaultHoldingColor[type];

  // Keep the selected type valid for the account's kind. The account loads
  // asynchronously, so once its allowed set is known, a default (or previously
  // selected) type outside that set snaps to the first allowed type — which
  // also re-derives the non-dirty icon to match.
  useEffect(() => {
    if (!allowedTypes.includes(type)) {
      setType(allowedTypes[0]);
    }
  }, [allowedTypes, type]);

  // term deposit state
  const nextContributionId = useRef(1);
  const [contributions, setContributions] = useState<Contribution[]>([
    { id: 0, amount: '', date: null },
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

    setOpeningBalance(groupAmount(String(toMajor(holding.balanceMinorUnits, holding.currency))));
  }, [isEdit, editingHolding]);

  // The stack sets the static "Add Holding" title; in edit mode override it with
  // "Edit Holding" so the header reads correctly for the update flow.
  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: 'Edit Holding' });
    }
  }, [isEdit, navigation]);

  const addContribution = (): void => {
    const id = nextContributionId.current++;
    setContributions((rows) => [...rows, { id, amount: '', date: null }]);
  };

  const removeContribution = (index: number): void => {
    setContributions((rows) => rows.filter((_, i) => i !== index));
  };

  const updateContributionAmount = (index: number, next: string): void => {
    setContributions((rows) =>
      rows.map((row, i) => (i === index ? { ...row, amount: next } : row)),
    );
  };

  const updateContributionDate = (index: number, next: number): void => {
    setContributions((rows) => rows.map((row, i) => (i === index ? { ...row, date: next } : row)));
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
      await holdingsRepo.update(
        holdingId,
        buildHoldingPatch({ name, color, type, currency, openingBalance, metadata }),
      );

      if (icon !== null) {
        await holdingsRepo.setIcon(holdingId, icon);
      }

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

  return (
    <Screen
      scroll
      footer={
        <Button onPress={save} disabled={!isValid}>
          Save
        </Button>
      }
    >
      <Box gap={4}>
        <HoldingIdentityField
          icon={icon}
          fallbackIcon={holdingTypeIcon[type]}
          iconColor={effectiveColor}
          name={name}
          onChangeName={setName}
          onSelectIcon={setIcon}
          onRemoveIcon={() => setIcon(null)}
          namePlaceholder="Name"
        />

        <ColorPicker label="Color" value={effectiveColor} onSelect={setColor} />

        {/* A holding's type shapes its metadata and value math, and its currency
            fixes the unit of every stored balance/transaction; no repo path
            re-shapes either, so both are read-only in edit mode — shown, but not
            switchable. */}
        <ChipRow
          label="Type"
          options={allowedTypes}
          selected={type}
          onSelect={setType}
          labels={TYPE_LABELS}
          disabled={isEdit}
        />

        <ChipRow
          label="Currency"
          options={currencyOptions}
          selected={currency}
          onSelect={setCurrency}
          disabled={isEdit}
        />

        {type !== 'term_deposit' && type !== 'bond' && (
          <TextField
            label="Balance"
            value={openingBalance}
            onChangeText={(text) => setOpeningBalance(groupAmount(text))}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
        )}

        {type === 'term_deposit' && (
          <Box gap={4}>
            {contributions.map((contribution, index) => (
              <Box key={contribution.id} gap={2}>
                <TextField
                  label={`Contribution ${index + 1} Amount`}
                  value={contribution.amount}
                  onChangeText={(next) => updateContributionAmount(index, groupAmount(next))}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                />

                <DateField
                  label={`Contribution ${index + 1} Date`}
                  value={contribution.date}
                  onChange={(next) => updateContributionDate(index, next)}
                  placeholder="Select a date"
                />

                {contributions.length > 1 && (
                  <Button
                    variant="secondary"
                    size="compact"
                    fullWidth={false}
                    accessibilityLabel={`Remove contribution ${index + 1}`}
                    onPress={() => removeContribution(index)}
                  >
                    Remove
                  </Button>
                )}
              </Box>
            ))}

            <Button variant="secondary" size="compact" fullWidth={false} onPress={addContribution}>
              Add contribution
            </Button>

            <TextField
              label="Annual Rate %"
              value={annualRate}
              onChangeText={setAnnualRate}
              keyboardType="decimal-pad"
              placeholder="0"
            />

            <TextField
              label="Term (Months)"
              value={termMonths}
              onChangeText={setTermMonths}
              keyboardType="number-pad"
              placeholder="0"
            />

            <Switch label="Recapitalization" value={recapitalization} onValueChange={setRecap} />

            <ChipRow
              label="Compounding"
              options={compoundingOptions}
              selected={compounding}
              onSelect={setCompounding}
              labels={COMPOUNDING_LABELS}
            />
          </Box>
        )}

        {type === 'bond' && (
          <Box gap={4}>
            <TextField
              label="Quantity"
              value={quantity}
              onChangeText={(text) => setQuantity(groupAmount(text))}
              keyboardType="number-pad"
              placeholder="0"
            />

            <TextField
              label="Face Value"
              value={faceValue}
              onChangeText={(text) => setFaceValue(groupAmount(text))}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />

            <TextField
              label="Coupon %"
              value={couponPct}
              onChangeText={setCouponPct}
              keyboardType="decimal-pad"
              placeholder="0"
            />

            <TextField
              label="Purchase Price (total paid)"
              value={purchasePrice}
              onChangeText={(text) => setPurchasePrice(groupAmount(text))}
              keyboardType="decimal-pad"
              placeholder="Defaults to nominal"
            />

            <DateField
              label="Purchase Date"
              value={purchaseDate}
              onChange={setPurchaseDate}
              placeholder="Select a date"
            />

            <DateField
              label="Maturity Date"
              value={maturityDate}
              onChange={setMaturityDate}
              placeholder="Select a date"
            />

            <ChipRow
              label="Bond Kind"
              options={bondKinds}
              selected={bondKind}
              onSelect={setBondKind}
              labels={BOND_KIND_LABELS}
            />

            <ChipRow
              label="Coupon frequency"
              options={couponFrequencies}
              selected={couponFrequency}
              onSelect={setCouponFrequency}
              labels={COUPON_FREQUENCY_LABELS}
            />
          </Box>
        )}
      </Box>
    </Screen>
  );
};

export default HoldingFormScreen;
