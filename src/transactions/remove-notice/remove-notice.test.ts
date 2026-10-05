import { i18n } from '@kiko/i18n/init';

import { joinNoticeSentences, removeNotice } from './remove-notice';

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

  it('says a split deletes the payment and every return', () => {
    expect(removeNotice({ split: true }, i18n.t)).toBe(
      'This also deletes the payment and every change return linked to it.',
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

  it('reads in the active language', async () => {
    await i18n.changeLanguage('uk');

    expect(
      removeNotice({ split: false, exchange: { kind: 'deleted', names: ['Долар'] } }, i18n.t),
    ).toBe('Також буде видалено другу частину цього обміну, у «Долар».');
    expect(removeNotice({ split: true }, i18n.t)).toBe(
      'Також буде видалено платіж і всі пов’язані з ним повернення решти.',
    );
    expect(
      removeNotice({ split: false, deposit: { name: 'Депозит', matched: true } }, i18n.t),
    ).toBe('Також буде видалено його внесок у «Депозит».');
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
