import { isTemplateDraft } from '@kiko/transaction-templates/draft';

import { draftFromForm } from './draft-from-form';

type FormState = Parameters<typeof draftFromForm>[0];

const BLANK: FormState = {
  mode: 'expense',
  primaryHoldingId: 'h1',
  currency: 'UAH',
  amount: '',
  description: '',
  prefilledLabel: null,
  selectedCategory: null,
  destinationHoldingId: null,
  destinationCurrency: null,
  valueIn: '',
  changeReturns: [{ id: 0, holdingId: null, amount: '' }],
};

describe('draftFromForm', () => {
  it('stores an expense with its exact minor units, description and category', () => {
    const draft = draftFromForm({
      ...BLANK,
      amount: '1 050.5',
      description: 'Rent',
      selectedCategory: 'groceries',
    });

    expect(draft).toEqual({
      version: 1,
      mode: 'expense',
      holdingId: 'h1',
      currency: 'UAH',
      amountMinorUnits: 105050,
      description: 'Rent',
      category: 'groceries',
      exchange: null,
      returns: [],
    });
    expect(isTemplateDraft(draft)).toBe(true);
  });

  it('stores an income as an income, in the holding currency scale', () => {
    expect(
      draftFromForm({ ...BLANK, mode: 'income', currency: 'JPY', amount: '1 050' }),
    ).toMatchObject({ mode: 'income', currency: 'JPY', amountMinorUnits: 1050 });
  });

  it('stores an empty amount as null', () => {
    expect(draftFromForm({ ...BLANK, amount: '' }).amountMinorUnits).toBeNull();
    expect(draftFromForm({ ...BLANK, amount: '   ' }).amountMinorUnits).toBeNull();
  });

  it('stores only the name and the holding when the rest is blank', () => {
    expect(draftFromForm(BLANK)).toEqual({
      version: 1,
      mode: 'expense',
      holdingId: 'h1',
      currency: 'UAH',
      amountMinorUnits: null,
      description: '',
      category: null,
      exchange: null,
      returns: [],
    });
  });

  it('stores a null amount, currency and holding when no holding is picked', () => {
    expect(
      draftFromForm({ ...BLANK, primaryHoldingId: null, currency: null, amount: '5' }),
    ).toMatchObject({ holdingId: null, currency: null, amountMinorUnits: null });
  });

  it('stores the category lowercased', () => {
    expect(draftFromForm({ ...BLANK, selectedCategory: 'Groceries' }).category).toBe('groceries');
  });

  it('stores an untouched pre-filled label as an empty description', () => {
    expect(
      draftFromForm({
        ...BLANK,
        description: 'Exchange to Wallet',
        prefilledLabel: 'Exchange to Wallet',
      }).description,
    ).toBe('');
  });

  it('stores a typed description that differs from the pre-filled label', () => {
    expect(
      draftFromForm({ ...BLANK, description: 'Rent', prefilledLabel: 'Wallet' }).description,
    ).toBe('Rent');
  });

  it('stores an exchange with its destination, in the destination scale, and no category or description', () => {
    const draft = draftFromForm({
      ...BLANK,
      mode: 'exchange',
      amount: '100',
      description: 'left over',
      selectedCategory: 'groceries',
      destinationHoldingId: 'usd',
      destinationCurrency: 'USD',
      valueIn: '2.5',
    });

    expect(draft).toEqual({
      version: 1,
      mode: 'exchange',
      holdingId: 'h1',
      currency: 'UAH',
      amountMinorUnits: 10000,
      description: '',
      category: null,
      exchange: { destinationHoldingId: 'usd', destinationCurrency: 'USD', valueInMinorUnits: 250 },
      returns: [],
    });
    expect(isTemplateDraft(draft)).toBe(true);
  });

  it('stores an exchange with nothing filled as an exchange with null fields', () => {
    expect(draftFromForm({ ...BLANK, mode: 'exchange' }).exchange).toEqual({
      destinationHoldingId: null,
      destinationCurrency: null,
      valueInMinorUnits: null,
    });
  });

  it('stores no exchange for any other mode, even when a Value in is left over', () => {
    expect(
      draftFromForm({ ...BLANK, mode: 'split', valueIn: '5', destinationHoldingId: 'usd' })
        .exchange,
    ).toBeNull();
  });

  it('stores a split with its category and its return rows in the payer currency', () => {
    const draft = draftFromForm({
      ...BLANK,
      mode: 'split',
      amount: '100',
      description: 'Dinner',
      selectedCategory: 'Dining',
      changeReturns: [
        { id: 0, holdingId: 'friend', amount: '5' },
        { id: 1, holdingId: 'other', amount: '1 000' },
      ],
    });

    expect(draft).toMatchObject({
      mode: 'split',
      description: 'Dinner',
      category: 'dining',
      returns: [
        { holdingId: 'friend', amountMinorUnits: 500 },
        { holdingId: 'other', amountMinorUnits: 100000 },
      ],
    });
    expect(isTemplateDraft(draft)).toBe(true);
  });

  it('keeps a split return row that has a holding and no amount', () => {
    expect(
      draftFromForm({
        ...BLANK,
        mode: 'split',
        changeReturns: [{ id: 0, holdingId: 'friend', amount: '' }],
      }).returns,
    ).toEqual([{ holdingId: 'friend', amountMinorUnits: null }]);
  });

  it('keeps a split return row that has an amount and no holding', () => {
    expect(
      draftFromForm({
        ...BLANK,
        mode: 'split',
        changeReturns: [{ id: 0, holdingId: null, amount: '5' }],
      }).returns,
    ).toEqual([{ holdingId: null, amountMinorUnits: 500 }]);
  });

  it('drops a split return row with neither a holding nor an amount', () => {
    expect(draftFromForm({ ...BLANK, mode: 'split' }).returns).toEqual([]);
  });

  it('stores no returns outside a split, even when rows are left over', () => {
    expect(
      draftFromForm({
        ...BLANK,
        mode: 'expense',
        changeReturns: [{ id: 0, holdingId: 'friend', amount: '5' }],
      }).returns,
    ).toEqual([]);
  });

  it('carries no loan and no comment field', () => {
    expect(Object.keys(draftFromForm(BLANK)).sort()).toEqual([
      'amountMinorUnits',
      'category',
      'currency',
      'description',
      'exchange',
      'holdingId',
      'mode',
      'returns',
      'version',
    ]);
  });
});
