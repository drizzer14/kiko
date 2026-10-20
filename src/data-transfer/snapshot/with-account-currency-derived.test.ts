import type { AccountRow, HoldingRow } from '@kiko/db';

import { withAccountCurrencyDerived } from './with-account-currency-derived';

const accountOf = (id: string, currency?: AccountRow['currency']): AccountRow => {
  const row = {
    id,
    name: id,
    kind: 'bank',
    institution: null,
    bankId: null,
    icon: null,
    color: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: 1,
  };

  return (currency === undefined ? row : { ...row, currency }) as AccountRow;
};

const holdingOf = (
  accountId: string,
  currency: HoldingRow['currency'],
  closedAt: number | null = null,
): HoldingRow => ({ accountId, currency, closedAt }) as HoldingRow;

const currenciesOf = (rows: AccountRow[]): Record<string, unknown> =>
  Object.fromEntries(rows.map((row) => [row.id, row.currency]));

describe('withAccountCurrencyDerived', () => {
  const holdings = [
    holdingOf('single', 'EUR'),
    holdingOf('mixed', 'EUR'),
    holdingOf('mixed', 'GBP'),
    holdingOf('closed-foreign', 'EUR'),
    holdingOf('closed-foreign', 'GBP', 1_700_000_000_000),
    holdingOf('all-closed', 'GBP', 1_700_000_000_000),
  ];
  const accounts = ['single', 'mixed', 'closed-foreign', 'all-closed', 'empty'].map((id) =>
    accountOf(id),
  );

  it('derives every account of a file with no currency key', () => {
    expect(
      currenciesOf(
        withAccountCurrencyDerived({
          fileAccounts: accounts,
          accounts,
          holdings,
          baseCurrency: 'USD',
        }),
      ),
    ).toEqual({
      single: 'EUR',
      mixed: 'USD',
      'closed-foreign': 'EUR',
      'all-closed': 'USD',
      empty: 'USD',
    });
  });

  it('derives an account the file does not carry, as the crypto cash move adds one', () => {
    const added = accountOf('crypto-from-source');

    expect(
      currenciesOf(
        withAccountCurrencyDerived({
          fileAccounts: accounts,
          accounts: [...accounts, added],
          holdings: [...holdings, holdingOf('crypto-from-source', 'BTC')],
          baseCurrency: 'USD',
        }),
      )['crypto-from-source'],
    ).toBe('BTC');
  });

  it('keeps every value of a file that carries the key, even against the rule', () => {
    const carried = [
      accountOf('single', 'GBP'),
      accountOf('mixed', 'UAH'),
      accountOf('empty', 'EUR'),
    ];

    expect(
      currenciesOf(
        withAccountCurrencyDerived({
          fileAccounts: carried,
          accounts: carried,
          holdings,
          baseCurrency: 'USD',
        }),
      ),
    ).toEqual({ single: 'GBP', mixed: 'UAH', empty: 'EUR' });
  });

  it('keeps the key of a file whose first account lacks it but a later one has it', () => {
    const carried = [accountOf('single'), accountOf('mixed', 'UAH')];

    expect(
      withAccountCurrencyDerived({
        fileAccounts: carried,
        accounts: carried,
        holdings,
        baseCurrency: 'USD',
      }),
    ).toBe(carried);
  });

  it('gives several or no open currency the base currency it is given', () => {
    expect(
      currenciesOf(
        withAccountCurrencyDerived({
          fileAccounts: accounts,
          accounts,
          holdings,
          baseCurrency: 'UAH',
        }),
      ),
    ).toMatchObject({ mixed: 'UAH', empty: 'UAH', 'all-closed': 'UAH', single: 'EUR' });
  });

  it('returns the same array when the file carries the key', () => {
    const carried = [accountOf('single', 'EUR')];

    expect(
      withAccountCurrencyDerived({
        fileAccounts: carried,
        accounts: carried,
        holdings,
        baseCurrency: 'USD',
      }),
    ).toBe(carried);
  });

  it('returns the same array when the file has no account', () => {
    const none: AccountRow[] = [];

    expect(
      withAccountCurrencyDerived({
        fileAccounts: none,
        accounts: none,
        holdings,
        baseCurrency: 'USD',
      }),
    ).toBe(none);
  });

  it('changes nothing on an account but its currency', () => {
    const [derived] = withAccountCurrencyDerived({
      fileAccounts: accounts,
      accounts,
      holdings,
      baseCurrency: 'USD',
    });

    expect(derived).toEqual({ ...accounts[0], currency: 'EUR' });
  });
});
