import { i18n } from '@kiko/i18n/init';

import {
  readOnlyNoticeKey,
  resolveBlankLabel,
  resolveDescriptionPlaceholder,
  resolveRuleDescription,
} from './row-labels';

const card = { id: 'h-card', name: 'Card', currency: 'UAH' } as const;
const wallet = { id: 'h-uah', name: 'Wallet UAH', currency: 'UAH' } as const;
const savings = { id: 'h-usd', name: 'Savings', currency: 'USD' } as const;
const holdings = [card, wallet, savings];

const legTo = (counterpartId: string) => ({
  exchangeCounterpartHoldingId: counterpartId,
  untrackedCounterpart: null,
  operation: null,
});

describe('resolveDescriptionPlaceholder', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('previews Trading fee for an edited fee row', () => {
    expect(
      resolveDescriptionPlaceholder({
        holding: card,
        existing: {
          exchangeCounterpartHoldingId: null,
          untrackedCounterpart: 'asset:PEPE',
          operation: 'trade-fee',
        },
        holdings,
        mode: 'expense',
        t: i18n.t,
      }),
    ).toBe('Trading fee');
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

describe('resolveRuleDescription', () => {
  const ruleDescription = (
    over: Partial<Parameters<typeof resolveRuleDescription>[0]> = {},
  ): string =>
    resolveRuleDescription({
      description: '',
      holding: card,
      existing: undefined,
      holdings,
      mode: 'expense',
      t: i18n.t,
      ...over,
    });

  it('reads a blank field as the label the field previews, in English', () => {
    expect(ruleDescription()).toBe('Card expense');
    expect(ruleDescription({ mode: 'income' })).toBe('Card income');
    expect(ruleDescription({ mode: 'split' })).toBe('Card expense');
  });

  it('reads a typed description as it is', () => {
    expect(ruleDescription({ description: 'Silpo' })).toBe('Silpo');
  });

  it('reads a blank field of an edited exchange leg as its leg label', () => {
    expect(ruleDescription({ existing: legTo(savings.id) })).toBe('Exchange to Savings');
  });

  it('leaves a blank field blank while no holding is picked, so a name matcher refuses it', () => {
    expect(ruleDescription({ holding: undefined })).toBe('');
  });

  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('uk');
    });

    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('reads a blank field as the Ukrainian label', () => {
      expect(ruleDescription()).toBe('Витрата: Card');
      expect(ruleDescription({ mode: 'income' })).toBe('Надходження: Card');
    });
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

  it('opens a blank trading-fee row with Trading fee', () => {
    expect(
      resolveBlankLabel({
        existing: leg({
          exchangeCounterpartHoldingId: null,
          untrackedCounterpart: 'asset:PEPE',
          operation: 'trade-fee',
        }),
        holding: card,
        holdings,
        t: i18n.t,
      }),
    ).toBe('Trading fee');
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

// The recurring mark is offered on a debit of a bank or cash account only (`isRecurringCandidate`),
// so a statement import and a Monobank sync can show it, and a crypto sync never can.
const BANK_SOURCES = ['import', 'monobank'] as const;
const CRYPTO_SOURCES = ['btc_wallet', 'binance', 'bybit'] as const;

describe('readOnlyNoticeKey', () => {
  it('names the statement for an import, and the sync for the rest', () => {
    expect(readOnlyNoticeKey('import')).toBe('forms.transaction.importedNotice');
    expect(readOnlyNoticeKey('monobank')).toBe('forms.transaction.syncedNotice');
  });

  it.each(CRYPTO_SOURCES)(
    'gives a %s sync the notice of a row with no recurring mark',
    (source) => {
      expect(readOnlyNoticeKey(source)).toBe('forms.transaction.syncedCryptoNotice');
    },
  );

  describe.each([
    ['en', 'recurring mark', 'category and loan link'],
    ['uk', 'регулярного платежу', 'категорію та звʼязок із кредитом'],
  ])('in %s', (language, markWords, fixedWords) => {
    beforeEach(async () => {
      await i18n.changeLanguage(language);
    });

    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it.each(BANK_SOURCES)('names the recurring mark in the notice of a %s row', (source) => {
      expect(i18n.t(readOnlyNoticeKey(source))).toContain(markWords);
    });

    it.each(CRYPTO_SOURCES)('names no recurring mark in the notice of a %s row', (source) => {
      const text = i18n.t(readOnlyNoticeKey(source));

      expect(text).not.toContain(markWords);
      expect(text).toContain(fixedWords);
    });
  });
});
