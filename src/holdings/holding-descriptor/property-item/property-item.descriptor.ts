import {
  sameShare,
  ownedMoney,
  ownershipAt,
  WHOLE_SHARE,
  ownershipApplies,
  ownershipChangeAt,
  type OwnershipShare,
  type OwnershipChange,
} from '../../ownership';
import { quantityAt } from '../../lots';
import { Money } from '../../../currency/money';
import type { PricedHolding } from '../../priced-value';
import type { ValuableHolding } from '../../holding-value';
import { holdingInstrument } from '../../../prices/instrument';
import { multiplyToMinorUnits } from '../../../currency/decimal';
import { entityColorsDark } from '../../../design-system/palette';
import { priceAt, type PriceBook } from '../../../prices/price-book';
import { pricedDescriptor, pricedWholeParts } from '../priced-parts';
import { asPropertyMeta, type OwnershipInput } from '../../holding-metadata';
import type { HoldingDescriptor, PricedSpec } from '../holding-descriptor.d';

// `quantityAt(lots, instant)` times the price point for the holding's own
// `holding:<id>` instrument at or before that day (`priceAt` — the local-day
// convention), as Money in the holding's OWN currency (a per-holding manual
// revaluation, always entered in that currency). Returns `null` for invalid
// metadata or a missing price point.
const propertyItemValue = (
  holding: PricedHolding,
  book: PriceBook,
  instant: number,
): Money | null => {
  const meta = asPropertyMeta(holding.metadata);

  if (meta === null) {
    return null;
  }
  const point = priceAt(book, holdingInstrument(holding.id), instant);

  if (point === undefined) {
    return null;
  }
  const quantity = quantityAt(meta.lots, instant);
  const minorUnits = multiplyToMinorUnits([quantity, point.price], holding.currency);

  return Money.of(holding.currency, minorUnits);
};

const propertyItemShare = (metadata: unknown, instant: number): OwnershipShare => {
  const meta = asPropertyMeta(metadata);

  if (meta === null || !ownershipApplies(meta.category)) {
    return WHOLE_SHARE;
  }

  return ownershipAt(meta.ownership ?? [], instant);
};

const propertyItemPricedSpec: PricedSpec = {
  lots: (metadata) => asPropertyMeta(metadata)?.lots,
  value: propertyItemValue,
  share: propertyItemShare,
};

/** A shared property's whole and owned value at one instant. */
export type PropertyOwnershipView = {
  share: OwnershipShare;
  input: OwnershipInput;
  /** The `dayKeyOf` day the share took effect. */
  since: number;
  whole: Money;
  owned: Money;
};

/**
 * The whole and the owned value of a property owned in part, for the card
 * and the detail; null for a property owned whole, a loan given, or any other
 * type. `owned` is the same amount the breakdown values the holding at.
 */
export const propertyOwnershipView = (
  holding: ValuableHolding,
  now: number,
  book: PriceBook,
): PropertyOwnershipView | null => {
  if (holding.type !== 'property_item') {
    return null;
  }

  const meta = asPropertyMeta(holding.metadata);

  if (meta === null || !ownershipApplies(meta.category)) {
    return null;
  }

  const change = ownershipChangeAt(meta.ownership ?? [], now);
  const whole = pricedWholeParts(propertyItemPricedSpec, holding, now, book);

  if (change === undefined || whole === null || sameShare(change, WHOLE_SHARE)) {
    return null;
  }

  const share = { numerator: change.numerator, denominator: change.denominator };

  return {
    share,
    input: meta.ownershipInput ?? 'percent',
    since: change.day,
    whole: whole.value,
    owned: ownedMoney(whole.value, share),
  };
};

/** A property's stored share changes, newest first, and the form the share was typed in. */
type PropertyShareChanges = {
  changes: OwnershipChange[];
  input: OwnershipInput;
};

/** Empty for a loan given, invalid metadata, any type but a property, or no holding yet. */
export const propertyShareChanges = (
  holding: Pick<ValuableHolding, 'type' | 'metadata'> | undefined,
): PropertyShareChanges => {
  const meta = holding?.type === 'property_item' ? asPropertyMeta(holding.metadata) : null;

  if (meta === null || !ownershipApplies(meta.category)) {
    return { changes: [], input: 'percent' };
  }

  return {
    changes: [...(meta.ownership ?? [])].reverse(),
    input: meta.ownershipInput ?? 'percent',
  };
};

export const propertyItemDescriptor: HoldingDescriptor = pricedDescriptor(propertyItemPricedSpec, {
  symbol: 'house.fill',
  defaultColor: entityColorsDark.brown,
  side: 'asset',
  ledgerless: true,
  timeExempt: false,
  fixedCurrency: null,
  exchange: {
    receivePath: 'excluded',
    source: false,
    createSource: false,
    createDestination: false,
  },
  entries: () => [],
});
