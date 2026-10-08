import type { AccountRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';
import type { HoldingType } from '@kiko/holdings/holding-type';
import { isExchangeSourceType } from '@kiko/holdings/exchange-destination';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import { isCurrencyExpectedForHoldingType } from '@kiko/holdings/holding-currency';

import { resolveCreateHoldingTarget } from '.';

type TargetAccount = Pick<AccountRow, 'id' | 'kind' | 'archivedAt' | 'institution' | 'bankId'>;

const accountOf = (
  id: string,
  kind: AccountRow['kind'],
  overrides: Partial<Pick<TargetAccount, 'archivedAt' | 'institution' | 'bankId'>> = {},
): TargetAccount => ({
  id,
  kind,
  archivedAt: null,
  institution: null,
  bankId: null,
  ...overrides,
});

const syncedMonobank = (id: string): TargetAccount =>
  accountOf(id, 'bank', { institution: 'monobank' });

// The primary, return and loan "Paid from" pickers list any holding that takes a
// manual ledger.
const takesLedger = (type: HoldingType): boolean => !isLedgerlessHoldingType(type);

const withoutAnchor = (accepts: (type: HoldingType) => boolean, currency?: Currency) => ({
  anchorAccountId: undefined,
  accepts,
  currency,
});

describe('resolveCreateHoldingTarget', () => {
  it('opens the holding form on the anchor account when it can create an accepted type', () => {
    const accounts = [accountOf('first', 'cash'), accountOf('anchor', 'cash')];

    expect(
      resolveCreateHoldingTarget({ anchorAccountId: 'anchor', accepts: takesLedger }, accounts),
    ).toEqual(['HoldingForm', { accountId: 'anchor', initialType: 'cash' }]);
  });

  it('opens the holding form on the first account in the given order when there is no anchor', () => {
    const accounts = [accountOf('first', 'cash'), accountOf('second', 'cash')];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'first', initialType: 'cash' },
    ]);
  });

  it('skips a synced Monobank account, whose only creatable types are ledgerless', () => {
    const accounts = [syncedMonobank('monobank'), accountOf('wallet', 'cash')];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'wallet', initialType: 'cash' },
    ]);
  });

  it('opens the account form when the only account is a synced Monobank one', () => {
    expect(
      resolveCreateHoldingTarget(withoutAnchor(takesLedger), [syncedMonobank('monobank')]),
    ).toEqual(['AccountForm', {}]);
  });

  it('keeps an unsynced bank account, whose card the user creates by hand', () => {
    const accounts = [accountOf('import-only', 'bank'), accountOf('wallet', 'cash')];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'import-only', initialType: 'card' },
    ]);
  });

  it('skips a metals account, whose only type takes no manual ledger', () => {
    const accounts = [accountOf('gold', 'metals'), accountOf('wallet', 'cash')];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'wallet', initialType: 'cash' },
    ]);
  });

  it('skips an anchor account that cannot create an accepted type, taking the next one', () => {
    const accounts = [syncedMonobank('card-account'), accountOf('wallet', 'cash')];

    expect(
      resolveCreateHoldingTarget(
        { anchorAccountId: 'card-account', accepts: isExchangeSourceType },
        accounts,
      ),
    ).toEqual(['HoldingForm', { accountId: 'wallet', initialType: 'cash' }]);
  });

  it('skips an account none of whose creatable types the picker accepts', () => {
    const accounts = [accountOf('wallet', 'cash'), accountOf('coins', 'crypto')];

    expect(
      resolveCreateHoldingTarget(
        withoutAnchor((type) => type === 'crypto_asset'),
        accounts,
      ),
    ).toEqual(['HoldingForm', { accountId: 'coins', initialType: 'crypto_asset' }]);
  });

  it('falls back to the other accounts when the anchor is not among them', () => {
    expect(
      resolveCreateHoldingTarget({ anchorAccountId: 'gone', accepts: takesLedger }, [
        accountOf('wallet', 'cash'),
      ]),
    ).toEqual(['HoldingForm', { accountId: 'wallet', initialType: 'cash' }]);
  });

  it('skips the implicit property and debt accounts, which create only ledgerless types', () => {
    const accounts = [
      accountOf('flats', 'property'),
      accountOf('loans', 'debt'),
      accountOf('wallet', 'cash'),
    ];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'wallet', initialType: 'cash' },
    ]);
  });

  it('skips an archived account', () => {
    const accounts = [accountOf('old', 'cash', { archivedAt: 1 }), accountOf('wallet', 'cash')];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'wallet', initialType: 'cash' },
    ]);
  });

  it('opens the account form with empty params when there is no account at all', () => {
    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), [])).toEqual(['AccountForm', {}]);
  });

  it('opens the account form when only implicit accounts exist', () => {
    const accounts = [accountOf('flats', 'property'), accountOf('loans', 'debt')];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'AccountForm',
      {},
    ]);
  });

  describe('the type the form opens on', () => {
    it('is the first creatable type the picker accepts, not the account default', () => {
      // A broker account creates a bond first, which a ledger picker does not list.
      expect(
        resolveCreateHoldingTarget(withoutAnchor(takesLedger), [accountOf('broker', 'broker')]),
      ).toEqual(['HoldingForm', { accountId: 'broker', initialType: 'cash' }]);
    });

    it('is the first type in the account order when the picker accepts several', () => {
      expect(
        resolveCreateHoldingTarget(
          withoutAnchor(() => true),
          [accountOf('broker', 'broker')],
        ),
      ).toEqual(['HoldingForm', { accountId: 'broker', initialType: 'bond' }]);
    });
  });

  describe('the currency the form opens in', () => {
    it('is the picker currency when it requires one', () => {
      expect(
        resolveCreateHoldingTarget(withoutAnchor(takesLedger, 'USD'), [
          accountOf('wallet', 'cash'),
        ]),
      ).toEqual([
        'HoldingForm',
        { accountId: 'wallet', initialType: 'cash', initialCurrency: 'USD' },
      ]);
    });

    it('is left to the form when the picker requires none', () => {
      const [, params] = resolveCreateHoldingTarget(withoutAnchor(takesLedger), [
        accountOf('wallet', 'cash'),
      ]);

      expect(params).not.toHaveProperty('initialCurrency');
    });

    it('goes with a type the picker accepts in that currency', () => {
      const accepts = (type: HoldingType): boolean =>
        takesLedger(type) && isCurrencyExpectedForHoldingType(type, 'USD');

      expect(
        resolveCreateHoldingTarget(withoutAnchor(accepts, 'USD'), [
          accountOf('coins', 'crypto'),
          accountOf('wallet', 'cash'),
        ]),
      ).toEqual([
        'HoldingForm',
        { accountId: 'wallet', initialType: 'cash', initialCurrency: 'USD' },
      ]);
    });
  });
});
