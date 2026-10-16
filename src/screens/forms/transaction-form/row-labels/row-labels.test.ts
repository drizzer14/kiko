import { i18n } from '@kiko/i18n/init';

import { resolveBlankLabel, resolveDescriptionPlaceholder } from './row-labels';

const card = { id: 'h-card', name: 'Card', currency: 'UAH' } as const;
const wallet = { id: 'h-uah', name: 'Wallet UAH', currency: 'UAH' } as const;
const savings = { id: 'h-usd', name: 'Savings', currency: 'USD' } as const;
const holdings = [card, wallet, savings];

const legTo = (counterpartId: string) => ({
  exchangeCounterpartHoldingId: counterpartId,
  untrackedCounterpart: null,
});

describe('resolveDescriptionPlaceholder', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('previews "Transfer to" for a leg between two holdings of one currency, so the field shows what the list shows', () => {
    expect(
      resolveDescriptionPlaceholder({
        holding: card,
        existing: legTo(wallet.id),
        holdings,
        mode: 'expense',
        t: i18n.t,
      }),
    ).toBe('Transfer to Wallet UAH');
  });

  it('previews "Transfer from" for the receiving leg of one currency', () => {
    expect(
      resolveDescriptionPlaceholder({
        holding: card,
        existing: legTo(wallet.id),
        holdings,
        mode: 'income',
        t: i18n.t,
      }),
    ).toBe('Transfer from Wallet UAH');
  });

  it('previews "Exchange to" for a leg between holdings of two currencies', () => {
    expect(
      resolveDescriptionPlaceholder({
        holding: card,
        existing: legTo(savings.id),
        holdings,
        mode: 'expense',
        t: i18n.t,
      }),
    ).toBe('Exchange to Savings');
  });

  it('falls back to the example with no holding to preview', () => {
    expect(
      resolveDescriptionPlaceholder({
        holding: undefined,
        existing: undefined,
        holdings,
        mode: 'expense',
        t: i18n.t,
      }),
    ).toBe(i18n.t('forms.transaction.descriptionPlaceholder'));
  });
});

describe('resolveBlankLabel', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  const leg = (
    over: Partial<NonNullable<Parameters<typeof resolveBlankLabel>[0]['existing']>>,
  ) => ({
    holdingId: card.id,
    description: '',
    amountMinorUnits: -700,
    ...legTo(wallet.id),
    ...over,
  });

  it('opens a blank same-currency leg with "Transfer to", the label the list shows', () => {
    expect(resolveBlankLabel({ existing: leg({}), holding: card, holdings, t: i18n.t })).toBe(
      'Transfer to Wallet UAH',
    );
  });

  it('opens a blank leg of two currencies with "Exchange to"', () => {
    expect(
      resolveBlankLabel({
        existing: leg(legTo(savings.id)),
        holding: card,
        holdings,
        t: i18n.t,
      }),
    ).toBe('Exchange to Savings');
  });

  it('pre-fills nothing for a row with a description of its own', () => {
    expect(
      resolveBlankLabel({
        existing: leg({ description: 'Rent' }),
        holding: card,
        holdings,
        t: i18n.t,
      }),
    ).toBeNull();
  });
});
