import type {
  AccountsStackParamList,
  HomeStackParamList,
  SettingsStackParamList,
  StatisticsStackParamList,
} from './types';

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

type CreateFormName = 'AccountForm' | 'HoldingForm';

// Distributes over the union (`ParamList extends unknown` makes the type parameter the checked
// type; `keyof` of a union alone keeps only the keys every member shares), so a stack that opens
// the Transaction form without the create forms its empty holding picker navigates to contributes
// the names it misses; any other stack contributes nothing.
type MissingCreateForms<ParamList> = ParamList extends unknown
  ? 'TransactionForm' extends keyof ParamList
    ? Exclude<CreateFormName, keyof ParamList>
    : never
  : never;

// Every exported stack param list belongs in this union: a stack added to `types.d.ts` and left
// out of it is the one case this proof does not see.
type StackParamList =
  | AccountsStackParamList
  | HomeStackParamList
  | SettingsStackParamList
  | StatisticsStackParamList;

// Type level, proven by `check:typecheck`: the assignment below fails tsc while any stack that
// has `TransactionForm` lacks `AccountForm` or `HoldingForm`, whose "Add holding" row dead-ends
// there (an unhandled navigate, which core does not pass down to a child navigator).
describe('stacks that open the Transaction form', () => {
  it('also register the account and holding forms its empty picker opens', () => {
    const missingCreateForms: [MissingCreateForms<StackParamList>] extends [never]
      ? true
      : MissingCreateForms<StackParamList> = true;

    expect(missingCreateForms).toBe(true);
  });
});
