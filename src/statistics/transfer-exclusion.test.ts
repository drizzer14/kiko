import {
  descriptionExcludedTransferTxIds,
  isDescriptionExcludedTransfer,
  isMccExcludedTransfer,
  mccExcludedTransferTxIds,
} from './transfer-exclusion';

const ownIbans = new Set(['UA-OWN-1', 'UA-OWN-2']);

describe('isMccExcludedTransfer', () => {
  it('excludes a cash-out (mcc 6011) regardless of counterIban', () => {
    expect(isMccExcludedTransfer({ mcc: 6011, counterIban: null }, ownIbans)).toBe(true);
    expect(isMccExcludedTransfer({ mcc: 6011, counterIban: 'UA-STRANGER' }, ownIbans)).toBe(true);
  });

  it('excludes a top-up / wallet-load transfer (mcc 6012, 6540) always', () => {
    expect(isMccExcludedTransfer({ mcc: 6012, counterIban: null }, ownIbans)).toBe(true);
    expect(isMccExcludedTransfer({ mcc: 6540, counterIban: 'UA-STRANGER' }, ownIbans)).toBe(true);
  });

  it('excludes a 4829 transfer ONLY when its counterIban is one of the user own IBANs', () => {
    expect(isMccExcludedTransfer({ mcc: 4829, counterIban: 'UA-OWN-2' }, ownIbans)).toBe(true);
  });

  it('keeps a 4829 transfer to a third-party IBAN as spending (real P2P payment)', () => {
    expect(isMccExcludedTransfer({ mcc: 4829, counterIban: 'UA-STRANGER' }, ownIbans)).toBe(false);
  });

  it('keeps a 4829 transfer with a null counterIban as spending', () => {
    expect(isMccExcludedTransfer({ mcc: 4829, counterIban: null }, ownIbans)).toBe(false);
  });

  it('keeps an ordinary purchase (a spending mcc) as spending', () => {
    expect(isMccExcludedTransfer({ mcc: 5411, counterIban: null }, ownIbans)).toBe(false);
  });

  it('never excludes a manual row with a null mcc (it falls through to the pair matcher)', () => {
    expect(isMccExcludedTransfer({ mcc: null, counterIban: 'UA-OWN-1' }, ownIbans)).toBe(false);
  });
});

describe('isDescriptionExcludedTransfer', () => {
  it('excludes a deposit top-up ("Поповнення депозиту")', () => {
    expect(isDescriptionExcludedTransfer('Поповнення депозиту')).toBe(true);
  });

  it('excludes a deposit opening ("Відкриття депозиту")', () => {
    expect(isDescriptionExcludedTransfer('Відкриття депозиту')).toBe(true);
  });

  it('excludes a move to the own black card ("На чорну картку")', () => {
    expect(isDescriptionExcludedTransfer('На чорну картку')).toBe(true);
  });

  it('excludes a move to the own FOP account ("...рахунок ФОП...")', () => {
    expect(isDescriptionExcludedTransfer('На гривневий рахунок ФОП для переказу на картку')).toBe(
      true,
    );
  });

  it('keeps a normal merchant description as spending', () => {
    expect(isDescriptionExcludedTransfer('Сільпо')).toBe(false);
    expect(isDescriptionExcludedTransfer('ATB')).toBe(false);
  });

  it('keeps a third-party FOP payee (e.g. a landlord) as spending, not an own top-up', () => {
    expect(isDescriptionExcludedTransfer('ФОП Песляк Валентина Петрівна')).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(isDescriptionExcludedTransfer('ПОПОВНЕННЯ ДЕПОЗИТУ')).toBe(true);
    expect(isDescriptionExcludedTransfer('на чорну картку')).toBe(true);
    expect(isDescriptionExcludedTransfer('рахунок фоп')).toBe(true);
  });

  it('never excludes a null/empty description', () => {
    expect(isDescriptionExcludedTransfer(null)).toBe(false);
    expect(isDescriptionExcludedTransfer('')).toBe(false);
  });
});

describe('descriptionExcludedTransferTxIds', () => {
  it('collects the ids of exactly the description-matched internal transfers', () => {
    const ids = descriptionExcludedTransferTxIds([
      { id: 'dep', description: 'Поповнення депозиту' },
      { id: 'black', description: 'На чорну картку' },
      { id: 'fop', description: 'На гривневий рахунок ФОП для переказу на картку' },
      { id: 'shop', description: 'Сільпо' },
      { id: 'empty', description: null },
    ]);

    expect(ids).toEqual(new Set(['dep', 'black', 'fop']));
  });

  it('returns an empty set when no row matches', () => {
    expect(descriptionExcludedTransferTxIds([])).toEqual(new Set());
  });

  it('does NOT drop a third-party FOP payee id (only the own-FOP top-up phrase matches)', () => {
    const ids = descriptionExcludedTransferTxIds([
      { id: 'fop-topup', description: 'На гривневий рахунок ФОП для переказу на картку' },
      { id: 'landlord', description: 'ФОП Песляк Валентина Петрівна' },
    ]);

    expect(ids).toEqual(new Set(['fop-topup']));
    expect(ids.has('landlord')).toBe(false);
  });
});

describe('mccExcludedTransferTxIds', () => {
  it('collects the ids of exactly the mcc-excluded rows, keyed on mcc not the stored category', () => {
    // `category` is carried on purpose: these rows are what proves the exclusion
    // keys off the immutable `mcc` and NOT the drift-prone stored category. It is
    // surplus to the parameter type, so the fixture is named before it is passed —
    // an inline literal would trip excess-property checking.
    const rows: readonly {
      id: string;
      mcc: number | null;
      counterIban: string | null;
      category: string;
    }[] = [
      // A cash-out whose category has DRIFTED to 'groceries' — mcc wins, excluded.
      { id: 'cash', mcc: 6011, counterIban: null, category: 'groceries' },
      // An own-account 4829 transfer — excluded by own IBAN.
      { id: 'own', mcc: 4829, counterIban: 'UA-OWN-1', category: 'transfers' },
      // A real P2P 4829 payment to a stranger — kept.
      { id: 'p2p', mcc: 4829, counterIban: 'UA-STRANGER', category: 'transfers' },
      // A genuine grocery purchase — kept.
      { id: 'buy', mcc: 5411, counterIban: null, category: 'groceries' },
      // A manual row with no mcc — kept (falls through to the pair matcher).
      { id: 'manual', mcc: null, counterIban: null, category: 'transfers' },
    ];
    const ids = mccExcludedTransferTxIds(rows, ownIbans);

    expect(ids).toEqual(new Set(['cash', 'own']));
  });

  it('returns an empty set when no row matches', () => {
    expect(mccExcludedTransferTxIds([], ownIbans)).toEqual(new Set());
  });
});
