import {
  bankCatalog,
  bankIds,
  bankSellsMetals,
  isBankId,
  isConnectableBank,
  isSpecificBankId,
  statementFormatIdForBank,
} from '.';

describe('bankCatalog', () => {
  it('lists the ten banks, Monobank first, then "other" last — the broker catalog order', () => {
    expect(bankCatalog.map((entry) => entry.id)).toEqual([
      'monobank',
      'privatbank',
      'sensebank',
      'procredit',
      'ukrsib',
      'alfa',
      'pumb',
      'oschadbank',
      'raiffeisen',
      'ukrgasbank',
      'other',
    ]);
    expect(bankIds).toEqual(bankCatalog.map((entry) => entry.id));
  });

  it('names no display name for "other" (it renders its translated label) and one for every real bank', () => {
    const unnamed = bankCatalog
      .filter((entry) => entry.displayName === undefined)
      .map((entry) => entry.id);

    expect(unnamed).toEqual(['other']);
  });

  it('states no capability for "other" (isConnectableBank and bankSellsMetals decide it), and both for every real bank', () => {
    const other = bankCatalog.find((entry) => entry.id === 'other');
    const unstated = bankCatalog
      .filter((entry) => entry.connectable === undefined || entry.sellsMetals === undefined)
      .map((entry) => entry.id);

    expect(other).not.toHaveProperty('connectable');
    expect(other).not.toHaveProperty('sellsMetals');
    expect(unstated).toEqual(['other']);
  });

  it('marks only Monobank connectable; every other entry is import-only', () => {
    const connectable = bankCatalog.filter((entry) => entry.connectable).map((entry) => entry.id);

    expect(connectable).toEqual(['monobank']);
  });

  it('maps every entry that has a dedicated format to its already-shipped statement format id', () => {
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
      pumb: undefined,
      oschadbank: undefined,
      raiffeisen: undefined,
      ukrgasbank: undefined,
      other: undefined,
    });
  });

  it('isBankId guards a stored institution/bankId value, "other" included', () => {
    expect(isBankId('monobank')).toBe(true);
    expect(isBankId('privatbank')).toBe(true);
    expect(isBankId('oschadbank')).toBe(true);
    expect(isBankId('other')).toBe(true);
    expect(isBankId('revolut')).toBe(false);
    expect(isBankId('trading212')).toBe(false);
    expect(isBankId(null)).toBe(false);
    expect(isBankId(undefined)).toBe(false);
  });

  it('isSpecificBankId is isBankId without "other": the ids that name one real bank', () => {
    expect(isSpecificBankId('monobank')).toBe(true);
    expect(isSpecificBankId('ukrgasbank')).toBe(true);
    expect(isSpecificBankId('other')).toBe(false);
    expect(isSpecificBankId('trading212')).toBe(false);
    expect(isSpecificBankId(null)).toBe(false);
    expect(isSpecificBankId(undefined)).toBe(false);
  });

  it('statementFormatIdForBank resolves a stored bankId to its format id, or undefined', () => {
    expect(statementFormatIdForBank('privatbank')).toBe('privatbank-xlsx');
    expect(statementFormatIdForBank('oschadbank')).toBeUndefined();
    expect(statementFormatIdForBank('other')).toBeUndefined();
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
    expect(isConnectableBank('pumb')).toBe(false);
    expect(isConnectableBank('oschadbank')).toBe(false);
    expect(isConnectableBank('raiffeisen')).toBe(false);
    expect(isConnectableBank('ukrgasbank')).toBe(false);
  });

  it('isConnectableBank defaults to true for an unset, unrecognized, or "other" bankId', () => {
    expect(isConnectableBank('other')).toBe(true);
    expect(isConnectableBank(null)).toBe(true);
    expect(isConnectableBank(undefined)).toBe(true);
    expect(isConnectableBank('not-a-bank')).toBe(true);
  });

  it('marks PrivatBank, PUMB, Oschadbank, and Ukrgasbank as selling metals; every other entry is false', () => {
    const sellsMetals = bankCatalog.filter((entry) => entry.sellsMetals).map((entry) => entry.id);

    expect(sellsMetals).toEqual(['privatbank', 'pumb', 'oschadbank', 'ukrgasbank']);
  });

  it('bankSellsMetals is true for privatbank, pumb, oschadbank, and ukrgasbank; false for raiffeisen and every other known bank', () => {
    expect(bankSellsMetals('privatbank')).toBe(true);
    expect(bankSellsMetals('pumb')).toBe(true);
    expect(bankSellsMetals('oschadbank')).toBe(true);
    expect(bankSellsMetals('ukrgasbank')).toBe(true);
    expect(bankSellsMetals('raiffeisen')).toBe(false);
    expect(bankSellsMetals('monobank')).toBe(false);
    expect(bankSellsMetals('sensebank')).toBe(false);
    expect(bankSellsMetals('procredit')).toBe(false);
    expect(bankSellsMetals('ukrsib')).toBe(false);
    expect(bankSellsMetals('alfa')).toBe(false);
  });

  it('bankSellsMetals defaults to false — UNLIKE isConnectableBank — for an unset, unrecognized, or "other" bankId', () => {
    expect(bankSellsMetals('other')).toBe(false);
    expect(bankSellsMetals(null)).toBe(false);
    expect(bankSellsMetals(undefined)).toBe(false);
    expect(bankSellsMetals('not-a-bank')).toBe(false);
  });
});
