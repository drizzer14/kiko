import type { AccountRow } from '@kiko/db';

import { eligibleReminderKinds } from '.';

type Account = Pick<AccountRow, 'institution' | 'kind'>;

describe('eligibleReminderKinds', () => {
  it.each<[string, Account, string[]]>([
    [
      'a manual bank',
      { kind: 'bank', institution: null },
      ['statement_import', 'add_transactions'],
    ],
    ['a synced bank', { kind: 'bank', institution: 'monobank' }, []],
    ['a cash', { kind: 'cash', institution: null }, ['add_transactions']],
    ['a manual crypto', { kind: 'crypto', institution: null }, ['add_transactions']],
    ['a synced crypto', { kind: 'crypto', institution: 'binance' }, []],
    ['a property', { kind: 'property', institution: null }, ['add_transactions']],
    ['a metals', { kind: 'metals', institution: null }, ['add_transactions']],
    ['a debt', { kind: 'debt', institution: null }, ['add_transactions']],
    ['a broker', { kind: 'broker', institution: null }, ['add_transactions']],
  ])('offers the right kinds on %s account', (_label, account, kinds) => {
    expect(eligibleReminderKinds(account)).toEqual(kinds);
  });

  it('treats an institution no sync owns as manual', () => {
    expect(eligibleReminderKinds({ kind: 'bank', institution: 'some-old-bank' })).toEqual([
      'statement_import',
      'add_transactions',
    ]);
  });
});
