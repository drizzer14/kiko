const mockRemoveHoldingsPlan = jest.fn();
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    removeHoldingsPlan: (...args: unknown[]) => mockRemoveHoldingsPlan(...args),
  },
}));

import { i18n } from '@kiko/i18n/init';

import {
  type ExchangeRemoval,
  type RemoveHoldingsPlan,
  joinNoticeSentences,
  removeHoldingsNotice,
  removeHoldingsNoticeOf,
  removeNotice,
} from './remove-notice';

describe('removeNotice', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('says nothing for a row that is no part of a movement', () => {
    expect(removeNotice({ split: false }, i18n.t)).toBeUndefined();
  });

  it('names the holdings whose exchange legs go with the row', () => {
    expect(
      removeNotice({ split: false, exchange: { kind: 'deleted', names: ['Dollar card'] } }, i18n.t),
    ).toBe('This also deletes the other part of this exchange, in Dollar card.');
    expect(
      removeNotice(
        { split: false, exchange: { kind: 'deleted', names: ['Dollar card', 'Cash'] } },
        i18n.t,
      ),
    ).toBe('This also deletes the other part of this exchange, in Dollar card, Cash.');
  });

  it('calls the other part a transfer, as the row is labelled, when both legs hold one currency', () => {
    expect(
      removeNotice(
        {
          split: false,
          exchange: { kind: 'deleted', names: ['Binance Funding'], sameCurrency: true },
        },
        i18n.t,
      ),
    ).toBe('This also deletes the other part of this transfer, in Binance Funding.');
  });

  it('keeps the exchange wording when the legs hold different currencies', () => {
    expect(
      removeNotice(
        {
          split: false,
          exchange: { kind: 'deleted', names: ['Dollar card'], sameCurrency: false },
        },
        i18n.t,
      ),
    ).toBe('This also deletes the other part of this exchange, in Dollar card.');
  });

  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('uk');
    });

    it('writes the transfer wording with the same name interpolation as the exchange one', () => {
      const notice = (sameCurrency: boolean) =>
        removeNotice(
          { split: false, exchange: { kind: 'deleted', names: ['Cash'], sameCurrency } },
          i18n.t,
        );

      expect(notice(true)).toBe('Також буде видалено другу частину цього переказу, у «Cash».');
      expect(notice(false)).toBe('Також буде видалено другу частину цього обміну, у «Cash».');
    });
  });

  it('says a bank-owned other part stays, and that only this part goes', () => {
    expect(
      removeNotice(
        { split: false, exchange: { kind: 'syncedKept', names: ['Monobank card'] } },
        i18n.t,
      ),
    ).toBe(
      'The other part, in Monobank card, came from your bank and stays. Only this part is deleted.',
    );
  });

  it('asks the user to check the holding when the other part cannot be found', () => {
    expect(
      removeNotice({ split: false, exchange: { kind: 'missing', name: 'Dollar card' } }, i18n.t),
    ).toBe(
      'The other part of this exchange, in Dollar card, could not be found. Only this part is deleted, so check Dollar card.',
    );
  });

  it('says the other part could not be found, with no holding to name', () => {
    expect(removeNotice({ split: false, exchange: { kind: 'missing' } }, i18n.t)).toBe(
      'The other part of this exchange could not be found. Only this part is deleted.',
    );
  });

  it('says a split deletes every other part of it', () => {
    expect(removeNotice({ split: true }, i18n.t)).toBe(
      'This also deletes every other part of this split payment.',
    );
  });

  it('says each bank-owned part of the exchange stays, one sentence per holding', () => {
    expect(
      removeNotice(
        {
          split: false,
          exchange: {
            kind: 'deleted',
            names: ['Dollar card'],
            keptNames: ['Monobank card', 'Cash'],
          },
        },
        i18n.t,
      ),
    ).toBe(
      [
        'This also deletes the other part of this exchange, in Dollar card.',
        "Monobank card stays: it is the bank's record and cannot be deleted.",
        "Cash stays: it is the bank's record and cannot be deleted.",
      ].join(' '),
    );
  });

  it('says a matched deposit contribution is removed, and an unmatched one stays', () => {
    expect(
      removeNotice({ split: false, deposit: { name: 'Deposit', matched: true } }, i18n.t),
    ).toBe('This also removes its contribution to Deposit.');
    expect(
      removeNotice({ split: false, deposit: { name: 'Deposit', matched: false } }, i18n.t),
    ).toBe(
      'Its contribution to Deposit could not be matched and stays. Edit Deposit to remove it.',
    );
  });

  it('puts every part in one text, exchange first', () => {
    expect(
      removeNotice(
        {
          split: false,
          exchange: { kind: 'deleted', names: ['Dollar card'] },
          deposit: { name: 'Deposit', matched: true },
        },
        i18n.t,
      ),
    ).toBe(
      'This also deletes the other part of this exchange, in Dollar card. This also removes its contribution to Deposit.',
    );
  });

  describe('a conversion made from a split payment', () => {
    const EVERY_PART = 'This also deletes every other part of this split payment.';

    it('names each holding whose conversion goes, one sentence per holding, after the split', () => {
      expect(
        removeNotice(
          {
            split: true,
            splitExchanges: [{ kind: 'deleted', names: ['Dollar card', 'Cash'] }],
          },
          i18n.t,
        ),
      ).toBe(
        [
          EVERY_PART,
          'This also deletes the conversion made from this split payment, in Dollar card.',
          'This also deletes the conversion made from this split payment, in Cash.',
        ].join(' '),
      );
    });

    it('says a bank-owned conversion stays, with no claim that only one part goes', () => {
      expect(
        removeNotice(
          { split: true, splitExchanges: [{ kind: 'syncedKept', names: ['Monobank card'] }] },
          i18n.t,
        ),
      ).toBe(
        [EVERY_PART, 'The conversion in Monobank card came from your bank and stays.'].join(' '),
      );
    });

    it('asks the user to check the holding when a conversion cannot be found', () => {
      expect(
        removeNotice(
          { split: true, splitExchanges: [{ kind: 'missing', name: 'Dollar card' }] },
          i18n.t,
        ),
      ).toBe(
        [
          EVERY_PART,
          'A conversion made from this split payment could not be found in Dollar card. Check Dollar card.',
        ].join(' '),
      );
    });

    it('says a conversion could not be found, with no holding to name', () => {
      expect(removeNotice({ split: true, splitExchanges: [{ kind: 'missing' }] }, i18n.t)).toBe(
        [EVERY_PART, 'A conversion made from this split payment could not be found.'].join(' '),
      );
    });

    const cases: [string, ExchangeRemoval, string][] = [
      [
        'a bank-owned other part',
        { kind: 'syncedKept', names: ['Monobank card'] },
        'The conversion in Monobank card came from your bank and stays.',
      ],
      [
        'an other part that cannot be found',
        { kind: 'missing', name: 'Dollar card' },
        'A conversion made from this split payment could not be found in Dollar card. Check Dollar card.',
      ],
      [
        'an other part that cannot be found, with no holding',
        { kind: 'missing' },
        'A conversion made from this split payment could not be found.',
      ],
    ];

    it.each(cases)(
      'speaks of the split, not of one part, for the exchange of the row when %s',
      (_name, exchange, sentence) => {
        expect(removeNotice({ split: true, exchange }, i18n.t)).toBe(`${sentence} ${EVERY_PART}`);
      },
    );

    it('reads in Ukrainian, each name quoted by the sentence itself', async () => {
      await i18n.changeLanguage('uk');

      expect(
        removeNotice(
          {
            split: false,
            splitExchanges: [
              { kind: 'deleted', names: ['Долар'] },
              { kind: 'syncedKept', names: ['Картка'] },
              { kind: 'missing', name: 'Готівка' },
              { kind: 'missing' },
            ],
          },
          i18n.t,
        ),
      ).toBe(
        [
          'Також буде видалено обмін, зроблений із цього розділеного платежу, у «Долар».',
          'Обмін у «Картка» надійшов з банку й залишиться.',
          'Обмін із цього розділеного платежу в «Готівка» не знайдено. Перевірте «Готівка».',
          'Обмін із цього розділеного платежу не знайдено.',
        ].join(' '),
      );
    });
  });

  describe('the balance a delete changes', () => {
    it('states a gain with a plus sign, in the currency of the holding', () => {
      expect(
        removeNotice(
          {
            split: false,
            balanceChanges: [{ name: 'Hryvnia card', currency: 'UAH', minorUnits: 40_000 }],
          },
          i18n.t,
        ),
      ).toBe('This changes the balance of Hryvnia card by +400.00 ₴.');
    });

    it('states a loss with a minus sign', () => {
      expect(
        removeNotice(
          {
            split: false,
            balanceChanges: [{ name: 'Dollar card', currency: 'USD', minorUnits: -1_000 }],
          },
          i18n.t,
        ),
      ).toBe('This changes the balance of Dollar card by -$10.00.');
    });

    it('has one line per holding, after every other sentence', () => {
      expect(
        removeNotice(
          {
            split: true,
            exchange: { kind: 'deleted', names: ['Dollar card'] },
            balanceChanges: [
              { name: 'Dollar card', currency: 'USD', minorUnits: -1_000 },
              { name: 'Hryvnia card', currency: 'UAH', minorUnits: 40_000 },
            ],
          },
          i18n.t,
        ),
      ).toBe(
        [
          'This also deletes the other part of this exchange, in Dollar card.',
          'This also deletes every other part of this split payment.',
          'This changes the balance of Dollar card by -$10.00.',
          'This changes the balance of Hryvnia card by +400.00 ₴.',
        ].join(' '),
      );
    });

    it('says nothing for an empty list', () => {
      expect(removeNotice({ split: false, balanceChanges: [] }, i18n.t)).toBeUndefined();
    });

    it('reads in Ukrainian, the holding name quoted by the sentence and the amount grouped by the locale', async () => {
      await i18n.changeLanguage('uk');

      expect(
        removeNotice(
          {
            split: false,
            balanceChanges: [
              { name: 'Картка', currency: 'UAH', minorUnits: 123_456 },
              { name: 'Долар', currency: 'USD', minorUnits: -1_000 },
            ],
          },
          i18n.t,
        ),
      ).toBe(
        ['Баланс «Картка» зміниться на +1 234,56 ₴.', 'Баланс «Долар» зміниться на -$10,00.'].join(
          ' ',
        ),
      );
    });

    it('is the only text of a holdings delete that changes another holding', () => {
      expect(
        removeHoldingsNotice(
          {
            deletedRows: { count: 0, names: [] },
            reversedContributions: [],
            keptContributions: [],
            keptSynced: [],
            unlinked: [],
            unlinkedPlain: false,
            balanceChanges: [{ name: 'Dollar card', currency: 'USD', minorUnits: -1_000 }],
          },
          i18n.t,
        ),
      ).toBe('This changes the balance of Dollar card by -$10.00.');
    });
  });

  it('reads in the active language', async () => {
    await i18n.changeLanguage('uk');

    expect(
      removeNotice({ split: false, exchange: { kind: 'deleted', names: ['Долар'] } }, i18n.t),
    ).toBe('Також буде видалено другу частину цього обміну, у «Долар».');
    expect(removeNotice({ split: true }, i18n.t)).toBe(
      'Також буде видалено всі інші частини цього розділеного платежу.',
    );
    expect(
      removeNotice({ split: false, deposit: { name: 'Депозит', matched: true } }, i18n.t),
    ).toBe('Також буде видалено її внесок у «Депозит».');
    expect(
      removeNotice({ split: false, deposit: { name: 'Депозит', matched: false } }, i18n.t),
    ).toBe(
      'Її внесок у «Депозит» не вдалося знайти, тож він залишиться. Щоб його прибрати, відредагуйте «Депозит».',
    );
  });

  it('quotes each holding name of a list on its own in Ukrainian', async () => {
    await i18n.changeLanguage('uk');

    expect(
      removeNotice(
        {
          split: false,
          exchange: { kind: 'deleted', names: ['Долар', 'Готівка'] },
        },
        i18n.t,
      ),
    ).toBe('Також буде видалено другу частину цього обміну, у «Долар», «Готівка».');
    expect(
      removeNotice(
        { split: false, exchange: { kind: 'syncedKept', names: ['Картка', 'Готівка'] } },
        i18n.t,
      ),
    ).toBe(
      'Друга частина, у «Картка», «Готівка», надійшла з банку й залишиться. Буде видалено лише цю частину.',
    );
  });

  it('says in Ukrainian that a bank-owned part stays', async () => {
    await i18n.changeLanguage('uk');

    expect(
      removeNotice(
        {
          split: false,
          exchange: { kind: 'deleted', names: ['Долар'], keptNames: ['Картка'] },
        },
        i18n.t,
      ),
    ).toBe(
      [
        'Також буде видалено другу частину цього обміну, у «Долар».',
        '«Картка» залишиться: це запис банку, його не можна видалити.',
      ].join(' '),
    );
  });
});

const NOTHING_ELSE: RemoveHoldingsPlan = {
  deletedRows: { count: 0, names: [] },
  reversedContributions: [],
  keptContributions: [],
  keptSynced: [],
  unlinked: [],
  unlinkedPlain: false,
};

describe('removeHoldingsNotice', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('says nothing for a holding that nothing else is linked to', () => {
    expect(removeHoldingsNotice(NOTHING_ELSE, i18n.t)).toBeUndefined();
  });

  it('counts the linked transactions that go and names their holdings', () => {
    expect(
      removeHoldingsNotice(
        { ...NOTHING_ELSE, deletedRows: { count: 1, names: ['Dollar card'] } },
        i18n.t,
      ),
    ).toBe('This also deletes 1 linked transaction in Dollar card.');
    expect(
      removeHoldingsNotice(
        { ...NOTHING_ELSE, deletedRows: { count: 3, names: ['Dollar card', 'Cash'] } },
        i18n.t,
      ),
    ).toBe('This also deletes 3 linked transactions in Dollar card, Cash.');
  });

  it('says the contributions that go, and the ones that stay', () => {
    expect(
      removeHoldingsNotice({ ...NOTHING_ELSE, reversedContributions: ['Deposit', 'Bond'] }, i18n.t),
    ).toBe('This also removes the contributions it made to Deposit, Bond.');
    expect(removeHoldingsNotice({ ...NOTHING_ELSE, keptContributions: ['Deposit'] }, i18n.t)).toBe(
      'Some contributions to Deposit could not be matched and stay. Edit the deposit to remove them.',
    );
  });

  it('says the bank transactions that stay', () => {
    expect(removeHoldingsNotice({ ...NOTHING_ELSE, keptSynced: ['Monobank card'] }, i18n.t)).toBe(
      'Linked transactions from your bank stay in Monobank card.',
    );
  });

  it('names the holdings of exchange parts that could not be found, or only says some could not', () => {
    expect(removeHoldingsNotice({ ...NOTHING_ELSE, unlinked: ['Dollar card'] }, i18n.t)).toBe(
      'Some exchange parts in Dollar card could not be found and stay. Check them after deleting.',
    );
    expect(removeHoldingsNotice({ ...NOTHING_ELSE, unlinkedPlain: true }, i18n.t)).toBe(
      'Some exchange parts could not be found and stay.',
    );
    expect(
      removeHoldingsNotice(
        { ...NOTHING_ELSE, unlinked: ['Dollar card'], unlinkedPlain: true },
        i18n.t,
      ),
    ).toBe(
      'Some exchange parts in Dollar card could not be found and stay. Check them after deleting.',
    );
  });

  it('puts one sentence per part in one text, in a fixed order', () => {
    expect(
      removeHoldingsNotice(
        {
          deletedRows: { count: 2, names: ['Dollar card'] },
          reversedContributions: ['Deposit'],
          keptContributions: ['Bond'],
          keptSynced: ['Monobank card'],
          unlinked: ['Cash'],
          unlinkedPlain: false,
        },
        i18n.t,
      ),
    ).toBe(
      [
        'This also deletes 2 linked transactions in Dollar card.',
        'This also removes the contributions it made to Deposit.',
        'Some contributions to Bond could not be matched and stay. Edit the deposit to remove them.',
        'Linked transactions from your bank stay in Monobank card.',
        'Some exchange parts in Cash could not be found and stay. Check them after deleting.',
      ].join(' '),
    );
  });

  // The count reads through `installPluralRulesFallback` on a device, whose
  // categories `plural-rules.shipped-locales.test.ts` proves equal to CLDR's.
  it.each([
    [1, 'Також буде видалено 1 пов’язану транзакцію в «Долар».'],
    [2, 'Також буде видалено 2 пов’язані транзакції в «Долар».'],
    [5, 'Також буде видалено 5 пов’язаних транзакцій в «Долар».'],
    [21, 'Також буде видалено 21 пов’язану транзакцію в «Долар».'],
  ])('reads the Ukrainian count %s with the right plural form', async (count, expected) => {
    await i18n.changeLanguage('uk');

    expect(
      removeHoldingsNotice({ ...NOTHING_ELSE, deletedRows: { count, names: ['Долар'] } }, i18n.t),
    ).toBe(expected);
  });

  it('quotes each holding name of a list on its own in Ukrainian', async () => {
    await i18n.changeLanguage('uk');

    expect(
      removeHoldingsNotice(
        { ...NOTHING_ELSE, deletedRows: { count: 2, names: ['Долар', 'Готівка'] } },
        i18n.t,
      ),
    ).toBe('Також буде видалено 2 пов’язані транзакції в «Долар», «Готівка».');
  });

  it('reads the other parts in Ukrainian', async () => {
    await i18n.changeLanguage('uk');

    expect(
      removeHoldingsNotice(
        {
          ...NOTHING_ELSE,
          reversedContributions: ['Депозит'],
          keptContributions: ['Облігація'],
          keptSynced: ['Картка'],
          unlinked: ['Готівка'],
        },
        i18n.t,
      ),
    ).toBe(
      [
        'Також буде видалено його внески в «Депозит».',
        'Деякі внески в «Облігація» не вдалося знайти, тож вони залишаться. Щоб їх прибрати, відредагуйте депозит.',
        'Пов’язані транзакції з банку залишаться в «Картка».',
        'Деякі частини обмінів у «Готівка» не знайдено, тож вони залишаться. Перевірте їх після видалення.',
      ].join(' '),
    );
    expect(removeHoldingsNotice({ ...NOTHING_ELSE, unlinkedPlain: true }, i18n.t)).toBe(
      'Деякі частини обмінів не знайдено, тож вони залишаться.',
    );
  });
});

describe('removeHoldingsNoticeOf', () => {
  it('reads the plan of the holdings and gives its text', async () => {
    mockRemoveHoldingsPlan.mockResolvedValue({
      ...NOTHING_ELSE,
      deletedRows: { count: 1, names: ['Dollar card'] },
    });

    expect(await removeHoldingsNoticeOf(['uah', 'cash'], i18n.t)).toBe(
      removeHoldingsNotice(
        { ...NOTHING_ELSE, deletedRows: { count: 1, names: ['Dollar card'] } },
        i18n.t,
      ),
    );
    expect(mockRemoveHoldingsPlan).toHaveBeenCalledWith(['uah', 'cash']);
  });

  it('gives undefined when the plan takes nothing from other holdings', async () => {
    mockRemoveHoldingsPlan.mockResolvedValue(NOTHING_ELSE);

    expect(await removeHoldingsNoticeOf(['uah'], i18n.t)).toBeUndefined();
  });
});

describe('joinNoticeSentences', () => {
  it('joins the sentences that exist with one space', () => {
    expect(joinNoticeSentences('First.', undefined, 'Second.')).toBe('First. Second.');
  });

  it('gives undefined when there is no sentence at all', () => {
    expect(joinNoticeSentences(undefined, undefined)).toBeUndefined();
    expect(joinNoticeSentences()).toBeUndefined();
  });
});
