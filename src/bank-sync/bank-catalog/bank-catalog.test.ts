import { bankCatalog, bankIds, isBankId, statementFormatIdForBank } from '.';

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
});
