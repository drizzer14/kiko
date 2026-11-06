import { i18n } from '@kiko/i18n/init';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { entityColorsLight } from '@kiko/design-system/palette';
import { accountIdentity } from '@kiko/holdings/account-identity';
import type { CategoryDisplay } from '@kiko/categories/category-display';

import { type CategorySlice, resolveCategoryColor } from '../category-breakdown';

import {
  buildAccountOptions,
  buildCategoryOptions,
  buildFilterScope,
  excludedCategoryKeysOf,
  visibleCategorySelection,
} from '.';

const account = (overrides: Partial<AccountRow> & Pick<AccountRow, 'id'>): AccountRow => ({
  name: overrides.id,
  kind: 'bank',
  institution: null,
  currency: 'UAH',
  bankId: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  ...overrides,
});

const holding = (
  overrides: Partial<HoldingRow> & Pick<HoldingRow, 'id' | 'accountId'>,
): HoldingRow => ({
  name: overrides.id,
  type: 'card',
  currency: 'UAH',
  icon: null,
  color: null,
  balanceMinorUnits: 0,
  syncedBalanceMinorUnits: null,
  balanceSetAt: null,
  balanceSetRowId: null,
  metadata: null,
  sortOrder: 0,
  closedAt: null,
  createdAt: 0,
  ...overrides,
});

const BANK = account({ id: 'bank' });
const SAVINGS = account({ id: 'savings' });
const ARCHIVED = account({ id: 'archived', archivedAt: 1 });
const LOANS = account({ id: 'loans', kind: 'debt', name: 'Loans' });

const CARD = holding({ id: 'card', accountId: 'bank' });
const CLOSED_JAR = holding({ id: 'closed-jar', accountId: 'bank', closedAt: 5 });
const SAVINGS_CARD = holding({ id: 'savings-card', accountId: 'savings' });
const ARCHIVED_CARD = holding({ id: 'archived-card', accountId: 'archived' });
const LOAN = holding({ id: 'loan', accountId: 'loans', type: 'loan' });

const ACCOUNTS = [BANK, SAVINGS, ARCHIVED, LOANS];
const HOLDINGS = [CARD, CLOSED_JAR, SAVINGS_CARD, ARCHIVED_CARD];

const scopeOf = (
  selectedAccounts: string[],
  overrides: { accounts?: AccountRow[]; holdings?: HoldingRow[] } = {},
) =>
  buildFilterScope({
    accounts: overrides.accounts ?? ACCOUNTS,
    holdings: overrides.holdings ?? HOLDINGS,
    selectedAccounts: new Set(selectedAccounts),
  });

const idsOf = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);

describe('buildFilterScope', () => {
  it('leaves an archived account out of the options and of every holding list', () => {
    const scope = scopeOf([]);

    expect(idsOf(scope.optionAccounts)).not.toContain('archived');
    expect(idsOf(scope.filteredAccounts)).not.toContain('archived');
    expect(idsOf(scope.netWorthHoldings)).not.toContain('archived-card');
  });

  it('reads a pick of an archived account as All', () => {
    const scope = scopeOf(['archived']);

    expect(scope.visibleSelectedAccounts).toEqual(new Set());
    expect(idsOf(scope.filteredAccounts)).toEqual(['bank', 'savings', 'loans']);
  });

  it('keeps the live part of a pick that also names an archived account', () => {
    const scope = scopeOf(['archived', 'savings']);

    expect(scope.visibleSelectedAccounts).toEqual(new Set(['savings']));
    expect(idsOf(scope.filteredAccounts)).toEqual(['savings']);
  });

  it('narrows the holdings to the picked account, with its closed holding in the net worth list only', () => {
    const scope = scopeOf(['bank']);

    expect(idsOf(scope.netWorthHoldings)).toEqual(['card', 'closed-jar']);
    expect(idsOf(scope.visibleHoldings)).toEqual(['card']);
  });

  it('leaves an implicit account with no holding out of the options, and in the accounts it filters', () => {
    const scope = scopeOf([]);

    expect(idsOf(scope.optionAccounts)).toEqual(['bank', 'savings']);
    expect(idsOf(scope.filteredAccounts)).toContain('loans');
  });

  it('reads a pick of an implicit account with no holding as All', () => {
    expect(scopeOf(['loans']).visibleSelectedAccounts).toEqual(new Set());
  });

  it('offers an implicit account once it holds something', () => {
    const scope = scopeOf([], { holdings: [...HOLDINGS, LOAN] });

    expect(idsOf(scope.optionAccounts)).toEqual(['bank', 'savings', 'loans']);
    expect(scopeOf(['loans'], { holdings: [...HOLDINGS, LOAN] }).visibleSelectedAccounts).toEqual(
      new Set(['loans']),
    );
  });

  it('reads a pick of a deleted account as All', () => {
    expect(scopeOf(['gone']).visibleSelectedAccounts).toEqual(new Set());
  });
});

describe('buildAccountOptions', () => {
  it('names an implicit account by its display name and tints each option with its identity', () => {
    const options = buildAccountOptions([BANK, LOANS], i18n.t, 'dark');

    expect(options).toEqual([
      { value: 'bank', label: 'bank', ...accountIdentity(BANK, 'dark') },
      {
        value: 'loans',
        label: i18n.t('accounts.implicitName.debt'),
        ...accountIdentity(LOANS, 'dark'),
      },
    ]);
  });

  it('tints each option with the light twin of its identity color in the light scheme', () => {
    const options = buildAccountOptions([BANK, LOANS], i18n.t, 'light');

    expect(options.map((option) => option.color)).toEqual([
      entityColorsLight.white,
      entityColorsLight.red,
    ]);
  });
});

const DISPLAY: Record<string, CategoryDisplay> = {
  groceries: { title: 'Groceries', icon: 'cart', color: null },
  transport: { title: 'Transport', icon: 'bus', color: '#112233' },
  health: { title: 'Health', icon: 'cross', color: null },
  other: { title: 'Other', icon: 'ellipsis', color: null },
};
const CATEGORY_BY_KEY = new Map(Object.entries(DISPLAY));
const CATEGORIES = [{ key: 'Groceries' }, { key: 'transport' }, { key: 'health' }];

const slice = (key: string, amount = 100): CategorySlice => ({
  key,
  title: DISPLAY[key].title,
  icon: DISPLAY[key].icon,
  amount,
  share: 0.5,
  color: '#abcdef',
});

const optionKeys = (options: { value: string }[]): string[] =>
  options.map((option) => option.value);

describe('buildCategoryOptions', () => {
  it('offers one option per slice key, carrying the slice title, icon and color', () => {
    const options = buildCategoryOptions({
      slices: [slice('transport')],
      categories: CATEGORIES,
      categoryByKey: CATEGORY_BY_KEY,
      keptKeys: [],
    });

    expect(options).toEqual([
      { value: 'transport', label: 'Transport', icon: 'bus', color: '#abcdef' },
    ]);
  });

  it('lists the options in the order of the categories, the synthetic default last', () => {
    const options = buildCategoryOptions({
      slices: [slice('other'), slice('health'), slice('groceries'), slice('transport')],
      categories: CATEGORIES,
      categoryByKey: CATEGORY_BY_KEY,
      keptKeys: [],
    });

    expect(optionKeys(options)).toEqual(['groceries', 'transport', 'health', 'other']);
  });

  it('puts a kept key that fell out of the slices back, in the order of the categories', () => {
    const options = buildCategoryOptions({
      slices: [slice('health')],
      categories: CATEGORIES,
      categoryByKey: CATEGORY_BY_KEY,
      keptKeys: ['transport'],
    });

    expect(optionKeys(options)).toEqual(['transport', 'health']);
    expect(options[0]).toEqual({
      value: 'transport',
      label: 'Transport',
      icon: 'bus',
      color: resolveCategoryColor('#112233', 'transport'),
    });
  });

  it('gives a kept key with no stored color its palette color', () => {
    const [option] = buildCategoryOptions({
      slices: [],
      categories: CATEGORIES,
      categoryByKey: CATEGORY_BY_KEY,
      keptKeys: ['groceries'],
    });

    expect(option.color).toBe(resolveCategoryColor(null, 'groceries'));
  });

  it('lists a key once, as the slice option, when it is both in the slices and kept', () => {
    const options = buildCategoryOptions({
      slices: [slice('health')],
      categories: CATEGORIES,
      categoryByKey: CATEGORY_BY_KEY,
      keptKeys: new Set(['health', 'health']),
    });

    expect(options).toEqual([
      { value: 'health', label: 'Health', icon: 'cross', color: '#abcdef' },
    ]);
  });

  it('leaves out a kept key no category resolves', () => {
    const options = buildCategoryOptions({
      slices: [],
      categories: CATEGORIES,
      categoryByKey: CATEGORY_BY_KEY,
      keptKeys: ['deleted'],
    });

    expect(options).toEqual([]);
  });

  it('does not offer a category with no spending when nothing keeps it', () => {
    const options = buildCategoryOptions({
      slices: [slice('health')],
      categories: CATEGORIES,
      categoryByKey: CATEGORY_BY_KEY,
      keptKeys: [],
    });

    expect(optionKeys(options)).toEqual(['health']);
  });
});

describe('visibleCategorySelection', () => {
  it('prunes a key of a deleted category, which reads as All', () => {
    const visible = visibleCategorySelection(new Set(['deleted']), CATEGORY_BY_KEY, [
      slice('health'),
    ]);

    expect(visible).toEqual(new Set());
  });

  it('keeps a key that merely fell out of the range', () => {
    const visible = visibleCategorySelection(new Set(['transport']), CATEGORY_BY_KEY, [
      slice('health'),
    ]);

    expect(visible).toEqual(new Set(['transport']));
  });

  it('keeps the live keys of a pick that also names a deleted one', () => {
    const visible = visibleCategorySelection(new Set(['deleted', 'health']), CATEGORY_BY_KEY, []);

    expect(visible).toEqual(new Set(['health']));
  });

  it('keeps a slice key no category row names, the synthetic default', () => {
    const visible = visibleCategorySelection(new Set(['uncategorized']), new Map(), [
      { ...slice('health'), key: 'uncategorized' },
    ]);

    expect(visible).toEqual(new Set(['uncategorized']));
  });
});

describe('excludedCategoryKeysOf', () => {
  it('excludes nothing when nothing is picked', () => {
    expect(excludedCategoryKeysOf([slice('health'), slice('transport')], new Set())).toEqual(
      new Set(),
    );
  });

  it('excludes every slice key that is not picked', () => {
    expect(
      excludedCategoryKeysOf(
        [slice('health'), slice('transport'), slice('groceries')],
        new Set(['transport']),
      ),
    ).toEqual(new Set(['health', 'groceries']));
  });
});
