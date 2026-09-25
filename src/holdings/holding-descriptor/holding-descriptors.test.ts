import { holdingTypes, type HoldingType } from '../holding-type';

import {
  holdingDescriptor,
  holdingDescriptors,
  isLedgerlessHoldingType,
  isTimeExemptHoldingType,
} from './holding-descriptors';

describe('holdingDescriptors', () => {
  it.each(holdingTypes)('has a descriptor for %s', (type) => {
    expect(holdingDescriptors[type]).toBeDefined();
    expect(holdingDescriptor(type)).toBe(holdingDescriptors[type]);
  });
});

describe('time-exempt holding types', () => {
  it('marks a term_deposit and a bond as time-exempt (they are not time-specific)', () => {
    expect(isTimeExemptHoldingType('term_deposit')).toBe(true);
    expect(isTimeExemptHoldingType('bond')).toBe(true);
  });

  it('does not mark time-specific holding types as time-exempt', () => {
    expect(isTimeExemptHoldingType('card')).toBe(false);
    expect(isTimeExemptHoldingType('cash')).toBe(false);
    expect(isTimeExemptHoldingType('crypto_asset')).toBe(false);
    expect(isTimeExemptHoldingType('jar')).toBe(false);
    expect(isTimeExemptHoldingType('property_item')).toBe(false);
  });
});

describe('ledgerless holding types', () => {
  it('marks term_deposit, bond, property_item, metal, and loan as ledgerless', () => {
    expect(isLedgerlessHoldingType('term_deposit')).toBe(true);
    expect(isLedgerlessHoldingType('bond')).toBe(true);
    expect(isLedgerlessHoldingType('property_item')).toBe(true);
    expect(isLedgerlessHoldingType('metal')).toBe(true);
    expect(isLedgerlessHoldingType('loan')).toBe(true);
  });

  it('does not mark a ledger-backed holding type as ledgerless', () => {
    expect(isLedgerlessHoldingType('card')).toBe(false);
    expect(isLedgerlessHoldingType('cash')).toBe(false);
    expect(isLedgerlessHoldingType('crypto_asset')).toBe(false);
    expect(isLedgerlessHoldingType('jar')).toBe(false);
  });
});

// The flag table every per-type descriptor was built from
// (`.superpowers/sdd/shares-property-metals-debts/R3-plan.md`, Phase B):
// pinning it here catches a descriptor silently drifting from the table a
// future edit no longer reads.
const flagTable: ReadonlyArray<{
  type: HoldingType;
  ledgerless: boolean;
  timeExempt: boolean;
  side: 'asset' | 'debt';
  priced: boolean;
  fixedCurrency: string | null;
  receivePath: 'plain' | 'contribution' | 'excluded';
  source: boolean;
  createSourceOrDestination: boolean;
}> = [
  {
    type: 'term_deposit',
    ledgerless: true,
    timeExempt: true,
    side: 'asset',
    priced: false,
    fixedCurrency: null,
    receivePath: 'contribution',
    source: false,
    createSourceOrDestination: false,
  },
  {
    type: 'bond',
    ledgerless: true,
    timeExempt: true,
    side: 'asset',
    priced: false,
    fixedCurrency: null,
    receivePath: 'excluded',
    source: false,
    createSourceOrDestination: false,
  },
  {
    type: 'property_item',
    ledgerless: true,
    timeExempt: false,
    side: 'asset',
    priced: true,
    fixedCurrency: null,
    receivePath: 'excluded',
    source: false,
    createSourceOrDestination: false,
  },
  {
    type: 'metal',
    ledgerless: true,
    timeExempt: false,
    side: 'asset',
    priced: true,
    fixedCurrency: 'UAH',
    receivePath: 'excluded',
    source: false,
    createSourceOrDestination: false,
  },
  {
    type: 'loan',
    ledgerless: true,
    timeExempt: false,
    side: 'debt',
    priced: false,
    fixedCurrency: null,
    receivePath: 'excluded',
    source: false,
    createSourceOrDestination: false,
  },
  {
    type: 'card',
    ledgerless: false,
    timeExempt: false,
    side: 'asset',
    priced: false,
    fixedCurrency: null,
    receivePath: 'plain',
    source: true,
    createSourceOrDestination: false,
  },
  {
    type: 'cash',
    ledgerless: false,
    timeExempt: false,
    side: 'asset',
    priced: false,
    fixedCurrency: null,
    receivePath: 'plain',
    source: true,
    createSourceOrDestination: true,
  },
  {
    type: 'crypto_asset',
    ledgerless: false,
    timeExempt: false,
    side: 'asset',
    priced: false,
    fixedCurrency: null,
    receivePath: 'plain',
    source: false,
    createSourceOrDestination: false,
  },
  {
    type: 'jar',
    ledgerless: false,
    timeExempt: false,
    side: 'asset',
    priced: false,
    fixedCurrency: null,
    receivePath: 'excluded',
    source: false,
    createSourceOrDestination: false,
  },
];

describe('the per-type flag table', () => {
  it.each(flagTable)('$type matches the plan flag table', (row) => {
    const descriptor = holdingDescriptor(row.type);

    expect(descriptor.ledgerless).toBe(row.ledgerless);
    expect(descriptor.timeExempt).toBe(row.timeExempt);
    expect(descriptor.side).toBe(row.side);
    expect(descriptor.priced !== null).toBe(row.priced);
    expect(descriptor.fixedCurrency).toBe(row.fixedCurrency);
    expect(descriptor.exchange.receivePath).toBe(row.receivePath);
    expect(descriptor.exchange.source).toBe(row.source);
    expect(descriptor.exchange.createSource).toBe(row.createSourceOrDestination);
    expect(descriptor.exchange.createDestination).toBe(row.createSourceOrDestination);
  });
});

// Guards the import cycle the registry introduces: the facades import the
// registry, and the per-type modules the registry assembles must import only
// leaves, never a facade. `jest.isolateModules` gives each case a fresh module
// registry, so requiring a facade FIRST (before anything else has already
// resolved and cached the per-type modules) surfaces a cycle that a warmed-up
// cache would hide.
const startingPoints = [
  '../entity-symbols',
  '../entity-colors',
  '../holding-value',
  '../derived-entries',
];

const facades = [
  '../holding-value',
  '../derived-entries',
  '../priced-value',
  '../exchange-destination',
  '../entity-symbols',
  '../entity-colors',
  '../../prices/price-as-of-caption',
];

describe.each(startingPoints)('an import order starting at %s', (startingPoint) => {
  it.each(facades)('requiring %s does not throw', (facade) => {
    expect(() => {
      jest.isolateModules(() => {
        require(startingPoint);
        require(facade);
      });
    }).not.toThrow();
  });
});
