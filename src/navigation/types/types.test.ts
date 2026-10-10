import type { AccountsStackParamList, HomeStackParamList } from './types';

const returnTo: NonNullable<AccountsStackParamList['HoldingForm']['returnTo']> = {
  screen: 'StatementImport',
  params: { filePath: 'statement.csv', accountId: 'account-1' },
};

// Type level, proven by `check:typecheck`: the `@ts-expect-error` below fails tsc once the Home
// stack's HoldingForm params accept `returnTo`, which only the Accounts stack's import screens
// may set because only they can be popped back to.
describe('HoldingForm route params', () => {
  it('lets the Accounts stack carry returnTo and the Home stack not', () => {
    const accounts: AccountsStackParamList['HoldingForm'] = { accountId: 'account-1', returnTo };
    const home: HomeStackParamList['HoldingForm'] = {
      accountId: 'account-1',
      // @ts-expect-error the Home stack has no import screen to return to
      returnTo,
    };

    expect(accounts.returnTo).toBe(returnTo);
    expect(home).toBeDefined();
  });
});
