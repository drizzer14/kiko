import {
  bankCatalog,
  bankIds,
  bankSellsMetals,
  isBankId,
  isConnectableBank,
  statementFormatIdForBank,
} from '.';

describe('bankCatalog', () => {
  it('lists exactly the six banks, Monobank first', () => {
    expect(bankCatalog.map((entry) => entry.id)).toEqual([
      'monobank',
      'privatbank',
      'sensebank',
      'procredit',
      'ukrsib',
      'alfa',
    ]);
    expect(bankIds).toEqual(bankCatalog.map((entry) => entry.id));
  });

  it('marks only Monobank connectable; every other entry is import-only', () => {
    const connectable = bankCatalog.filter((entry) => entry.connectable).map((entry) => entry.id);

    expect(connectable).toEqual(['monobank']);
  });

  it('maps every entry to its already-shipped statement format id', () => {
    const byId = Object.fromEntries(
      bankCatalog.map((entry) => [entry.id, entry.statementFormatId]),
    );

    expect(byId).toEqual({
      monobank: 'monobank-csv',
      privatbank: 'privatbank-xlsx',
      sensebank: 'sensebank-csv',
      procredit: 'procredit-business-csv',
      ukrsib: 'ukrsib-business-csv',
      alfa: 'alfa-business-csv',
    });
  });

  it('isBankId guards a stored institution/bankId value', () => {
    expect(isBankId('monobank')).toBe(true);
    expect(isBankId('privatbank')).toBe(true);
    expect(isBankId('revolut')).toBe(false);
    expect(isBankId(null)).toBe(false);
    expect(isBankId(undefined)).toBe(false);
  });

  it('statementFormatIdForBank resolves a stored bankId to its format id, or undefined', () => {
    expect(statementFormatIdForBank('privatbank')).toBe('privatbank-xlsx');
    expect(statementFormatIdForBank(null)).toBeUndefined();
    expect(statementFormatIdForBank(undefined)).toBeUndefined();
    expect(statementFormatIdForBank('not-a-bank')).toBeUndefined();
  });

  it('isConnectableBank is true for Monobank, false for every import-only bank', () => {
    expect(isConnectableBank('monobank')).toBe(true);
    expect(isConnectableBank('privatbank')).toBe(false);
    expect(isConnectableBank('sensebank')).toBe(false);
    expect(isConnectableBank('procredit')).toBe(false);
    expect(isConnectableBank('ukrsib')).toBe(false);
    expect(isConnectableBank('alfa')).toBe(false);
  });

  it('isConnectableBank defaults to true for an unset or unrecognized bankId', () => {
    expect(isConnectableBank(null)).toBe(true);
    expect(isConnectableBank(undefined)).toBe(true);
    expect(isConnectableBank('not-a-bank')).toBe(true);
  });

  it('marks only PrivatBank as selling metals; every other entry is false', () => {
    const sellsMetals = bankCatalog.filter((entry) => entry.sellsMetals).map((entry) => entry.id);

    expect(sellsMetals).toEqual(['privatbank']);
  });

  it('bankSellsMetals is true for privatbank, false for every other known bank', () => {
    expect(bankSellsMetals('privatbank')).toBe(true);
    expect(bankSellsMetals('monobank')).toBe(false);
    expect(bankSellsMetals('sensebank')).toBe(false);
    expect(bankSellsMetals('procredit')).toBe(false);
    expect(bankSellsMetals('ukrsib')).toBe(false);
    expect(bankSellsMetals('alfa')).toBe(false);
  });

  it('bankSellsMetals defaults to false — UNLIKE isConnectableBank — for an unset or unrecognized bankId', () => {
    expect(bankSellsMetals(null)).toBe(false);
    expect(bankSellsMetals(undefined)).toBe(false);
    expect(bankSellsMetals('not-a-bank')).toBe(false);
  });
});
