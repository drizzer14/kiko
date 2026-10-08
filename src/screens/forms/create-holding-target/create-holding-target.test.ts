import type { AccountRow } from '@kiko/db';
import type { HoldingType } from '@kiko/holdings/holding-type';
import { isExchangeSourceType } from '@kiko/holdings/exchange-destination';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';

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

const withoutAnchor = (accepts: (type: HoldingType) => boolean) => ({
  anchorAccountId: undefined,
  accepts,
});

describe('resolveCreateHoldingTarget', () => {
  it('opens the holding form on the anchor account when it can create an accepted type', () => {
    const accounts = [accountOf('first', 'cash'), accountOf('anchor', 'cash')];

    expect(
      resolveCreateHoldingTarget({ anchorAccountId: 'anchor', accepts: takesLedger }, accounts),
    ).toEqual(['HoldingForm', { accountId: 'anchor' }]);
  });

  it('opens the holding form on the first account in the given order when there is no anchor', () => {
    const accounts = [accountOf('first', 'cash'), accountOf('second', 'cash')];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'first' },
    ]);
  });

  it('skips a synced Monobank account, whose only creatable types are ledgerless', () => {
    const accounts = [syncedMonobank('monobank'), accountOf('wallet', 'cash')];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'wallet' },
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
      { accountId: 'import-only' },
    ]);
  });

  it('skips a metals account, whose only type takes no manual ledger', () => {
    const accounts = [accountOf('gold', 'metals'), accountOf('wallet', 'cash')];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'wallet' },
    ]);
  });

  it('skips an anchor account that cannot create an accepted type, taking the next one', () => {
    const accounts = [syncedMonobank('card-account'), accountOf('wallet', 'cash')];

    expect(
      resolveCreateHoldingTarget(
        { anchorAccountId: 'card-account', accepts: isExchangeSourceType },
        accounts,
      ),
    ).toEqual(['HoldingForm', { accountId: 'wallet' }]);
  });

  it('skips an account none of whose creatable types the picker accepts', () => {
    const accounts = [accountOf('wallet', 'cash'), accountOf('coins', 'crypto')];

    expect(
      resolveCreateHoldingTarget(
        withoutAnchor((type) => type === 'crypto_asset'),
        accounts,
      ),
    ).toEqual(['HoldingForm', { accountId: 'coins' }]);
  });

  it('falls back to the other accounts when the anchor is not among them', () => {
    expect(
      resolveCreateHoldingTarget({ anchorAccountId: 'gone', accepts: takesLedger }, [
        accountOf('wallet', 'cash'),
      ]),
    ).toEqual(['HoldingForm', { accountId: 'wallet' }]);
  });

  it('skips the implicit property and debt accounts, which create only ledgerless types', () => {
    const accounts = [
      accountOf('flats', 'property'),
      accountOf('loans', 'debt'),
      accountOf('wallet', 'cash'),
    ];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'wallet' },
    ]);
  });

  it('skips an archived account', () => {
    const accounts = [accountOf('old', 'cash', { archivedAt: 1 }), accountOf('wallet', 'cash')];

    expect(resolveCreateHoldingTarget(withoutAnchor(takesLedger), accounts)).toEqual([
      'HoldingForm',
      { accountId: 'wallet' },
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
});
