import type { AccountRow } from '@kiko/db';

import { openCreateHolding, resolveCreateHoldingTarget } from '.';

const accountOf = (
  id: string,
  kind: AccountRow['kind'],
  overrides: Partial<Pick<AccountRow, 'archivedAt'>> = {},
): Pick<AccountRow, 'id' | 'kind' | 'archivedAt'> => ({
  id,
  kind,
  archivedAt: null,
  ...overrides,
});

describe('resolveCreateHoldingTarget', () => {
  it('opens the holding form on the anchor account when the picker has one', () => {
    expect(resolveCreateHoldingTarget('anchor', [accountOf('first', 'bank')])).toEqual({
      screen: 'HoldingForm',
      params: { accountId: 'anchor' },
    });
  });

  it('opens the holding form on the first account in the given order when there is no anchor', () => {
    const accounts = [accountOf('first', 'bank'), accountOf('second', 'cash')];

    expect(resolveCreateHoldingTarget(undefined, accounts)).toEqual({
      screen: 'HoldingForm',
      params: { accountId: 'first' },
    });
  });

  it('skips the implicit property and debt accounts, which hold no payer holding', () => {
    const accounts = [
      accountOf('flats', 'property'),
      accountOf('loans', 'debt'),
      accountOf('wallet', 'cash'),
    ];

    expect(resolveCreateHoldingTarget(undefined, accounts)).toEqual({
      screen: 'HoldingForm',
      params: { accountId: 'wallet' },
    });
  });

  it('skips an archived account', () => {
    const accounts = [accountOf('old', 'bank', { archivedAt: 1 }), accountOf('wallet', 'cash')];

    expect(resolveCreateHoldingTarget(undefined, accounts)).toEqual({
      screen: 'HoldingForm',
      params: { accountId: 'wallet' },
    });
  });

  it('opens the account form when there is no account at all', () => {
    expect(resolveCreateHoldingTarget(undefined, [])).toEqual({ screen: 'AccountForm' });
  });

  it('opens the account form when only implicit accounts exist', () => {
    const accounts = [accountOf('flats', 'property'), accountOf('loans', 'debt')];

    expect(resolveCreateHoldingTarget(undefined, accounts)).toEqual({ screen: 'AccountForm' });
  });
});

describe('openCreateHolding', () => {
  it('hands the holding form and its account to the navigation verb', () => {
    const go = jest.fn();

    openCreateHolding({ screen: 'HoldingForm', params: { accountId: 'a1' } }, go);

    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith('HoldingForm', { accountId: 'a1' });
  });

  it('hands the account form with empty params to the navigation verb', () => {
    const go = jest.fn();

    openCreateHolding({ screen: 'AccountForm' }, go);

    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith('AccountForm', {});
  });
});
