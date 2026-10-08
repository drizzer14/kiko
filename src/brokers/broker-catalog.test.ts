import { brokerIds, isBrokerId, brokerCatalog } from '.';

describe('brokerCatalog', () => {
  it('lists exactly the eight brokers, Trading 212 first and Other broker last', () => {
    expect(brokerCatalog.map((entry) => entry.id)).toEqual([
      'trading212',
      'ibkr',
      'freedom24',
      'revolut',
      'icu',
      'univer',
      'dragon',
      'other',
    ]);
    expect(brokerIds).toEqual(brokerCatalog.map((entry) => entry.id));
  });

  it('names every broker in plain text, and leaves Other broker to its translated label', () => {
    expect(Object.fromEntries(brokerCatalog.map((entry) => [entry.id, entry.displayName]))).toEqual(
      {
        trading212: 'Trading 212',
        ibkr: 'Interactive Brokers',
        freedom24: 'Freedom24',
        revolut: 'Revolut',
        icu: 'ICU',
        univer: 'UNIVER',
        dragon: 'Dragon Capital',
        other: undefined,
      },
    );
  });

  it('never lists EXANTE or Freedom Finance Ukraine', () => {
    for (const entry of brokerCatalog) {
      expect(entry.id).not.toMatch(/exante|ffin/i);
      expect(entry.displayName ?? '').not.toMatch(/exante|freedom finance/i);
    }
  });

  it('carries no connect or import capability on any entry', () => {
    for (const entry of brokerCatalog) {
      expect(Object.keys(entry).sort()).toEqual(
        entry.displayName === undefined ? ['id'] : ['displayName', 'id'],
      );
    }
  });
});

describe('isBrokerId', () => {
  it('accepts a catalog broker id', () => {
    expect(isBrokerId('trading212')).toBe(true);
    expect(isBrokerId('other')).toBe(true);
  });

  it('rejects a bank id, an unknown value, null, and undefined', () => {
    expect(isBrokerId('monobank')).toBe(false);
    expect(isBrokerId('exante')).toBe(false);
    expect(isBrokerId(null)).toBe(false);
    expect(isBrokerId(undefined)).toBe(false);
  });
});
