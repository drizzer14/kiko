import { i18n } from '@kiko/i18n/init';
import { accounts, type AccountRow, type HoldingRow } from '@kiko/db';

import {
  accountDisplayName,
  accountsForFilter,
  hasNoAccounts,
  IMPLICIT_ACCOUNT_STORED_NAME,
  type ImplicitAccountKind,
  implicitAccountStoredName,
  isImplicitAccount,
  isImplicitAccountKind,
} from '.';

type AccountKind = AccountRow['kind'];

const accountKinds = accounts.kind.enumValues as readonly AccountKind[];

const otherKinds = accountKinds.filter((kind) => !isImplicitAccountKind(kind));

const translate = i18n.t.bind(i18n);

describe('isImplicitAccountKind', () => {
  it('is true only for property and debt, over every account kind', () => {
    expect(accountKinds.filter(isImplicitAccountKind)).toEqual(['property', 'debt']);
  });
});

describe('isImplicitAccount', () => {
  it('is true for a live property or debt account', () => {
    expect(isImplicitAccount({ kind: 'property', archivedAt: null })).toBe(true);
    expect(isImplicitAccount({ kind: 'debt', archivedAt: null })).toBe(true);
  });

  it('is false for an archived property or debt account', () => {
    expect(isImplicitAccount({ kind: 'property', archivedAt: 1 })).toBe(false);
    expect(isImplicitAccount({ kind: 'debt', archivedAt: 1 })).toBe(false);
  });

  it('is false for every other kind, live or archived', () => {
    for (const kind of otherKinds) {
      expect(isImplicitAccount({ kind, archivedAt: null })).toBe(false);
      expect(isImplicitAccount({ kind, archivedAt: 1 })).toBe(false);
    }
  });

  // Compile-time half: an archived property account takes the false branch, and
  // that branch must not narrow it to `never`, or its fields could not be read.
  it('leaves an archived property account usable in the false branch', () => {
    const archived = {
      kind: 'property' as const,
      name: 'Old flat',
      archivedAt: 5 as number | null,
    };

    if (isImplicitAccount(archived)) {
      throw new Error('an archived account is not implicit');
    }

    expect(archived.name).toBe('Old flat');
    expect(archived.kind).toBe('property');
  });
});

describe('accountsForFilter', () => {
  const account = (
    id: string,
    kind: AccountKind,
    archivedAt: number | null = null,
  ): Pick<AccountRow, 'id' | 'kind' | 'archivedAt'> => ({ id, kind, archivedAt });

  it('lists a live implicit account that still has a holding, open or closed', () => {
    const accountList = [account('open', 'property'), account('closed', 'debt')];

    expect(
      accountsForFilter(accountList, [{ accountId: 'open' }, { accountId: 'closed' }]).map(
        (listed) => listed.id,
      ),
    ).toEqual(['open', 'closed']);
  });

  // A transaction hangs off a holding (`transactions.holding_id` is NOT NULL)
  // and a holding's delete removes its transactions, so no holding means no
  // transaction and no history left to isolate.
  it('leaves out a live implicit account with no holding at all', () => {
    const accountList = [account('flat', 'property'), account('loans', 'debt')];

    expect(accountsForFilter(accountList, [])).toEqual([]);
  });

  it('keeps an empty bank account and any other kind listed', () => {
    const accountList = otherKinds.map((kind) => account(kind, kind));

    expect(accountsForFilter(accountList, [])).toEqual(accountList);
  });

  it('drops an archived account, implicit or not, whatever it holds', () => {
    const accountList = [account('old-flat', 'property', 5), account('old-bank', 'bank', 5)];

    expect(
      accountsForFilter(accountList, [{ accountId: 'old-flat' }, { accountId: 'old-bank' }]),
    ).toEqual([]);
  });

  it('treats only the holding of its own account as that account holding', () => {
    const accountList = [account('flat', 'property'), account('loans', 'debt')];

    expect(
      accountsForFilter(accountList, [{ accountId: 'flat' }]).map((listed) => listed.id),
    ).toEqual(['flat']);
  });
});

describe('hasNoAccounts', () => {
  const account = (
    id: string,
    kind: AccountKind,
    archivedAt: number | null = null,
  ): Pick<AccountRow, 'id' | 'kind' | 'archivedAt'> => ({ id, kind, archivedAt });

  const holding = (
    accountId: string,
    closedAt: number | null = null,
  ): Pick<HoldingRow, 'accountId' | 'closedAt'> => ({ accountId, closedAt });

  it('is true for no accounts at all', () => {
    expect(hasNoAccounts([], [])).toBe(true);
  });

  it('is true when the only bank account is archived', () => {
    expect(hasNoAccounts([account('old-bank', 'bank', 5)], [])).toBe(true);
  });

  it('is true for a live property account whose only holding is closed', () => {
    expect(hasNoAccounts([account('flat', 'property')], [holding('flat', 5)])).toBe(true);
  });

  it('is true for live implicit accounts with no holding at all', () => {
    expect(hasNoAccounts([account('flat', 'property'), account('loans', 'debt')], [])).toBe(true);
  });

  it('is false for a live account of any other kind, even with no holding', () => {
    for (const kind of otherKinds) {
      expect(hasNoAccounts([account(kind, kind)], [])).toBe(false);
    }
  });

  it('is false for a property account with an open holding', () => {
    expect(hasNoAccounts([account('flat', 'property')], [holding('flat')])).toBe(false);
  });

  it('is false for a debt account with an open holding', () => {
    expect(hasNoAccounts([account('loans', 'debt')], [holding('loans')])).toBe(false);
  });

  it('ignores an open holding of an archived implicit account', () => {
    expect(hasNoAccounts([account('old-flat', 'property', 5)], [holding('old-flat')])).toBe(true);
  });

  it('ignores an open holding whose account is not in the list', () => {
    expect(hasNoAccounts([account('flat', 'property')], [holding('elsewhere')])).toBe(true);
  });
});

describe('IMPLICIT_ACCOUNT_STORED_NAME', () => {
  it('holds the fixed English sentinel migration 0050 writes', () => {
    const expected: Record<ImplicitAccountKind, string> = { property: 'Properties', debt: 'Loans' };

    expect(IMPLICIT_ACCOUNT_STORED_NAME).toEqual(expected);
  });
});

describe('accountDisplayName', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('names a live property account holding the sentinel by its localized kind name', () => {
    expect(
      accountDisplayName({ kind: 'property', name: 'Properties', archivedAt: null }, translate),
    ).toBe('Properties');
  });

  it('names a live debt account holding the sentinel by its localized kind name', () => {
    expect(accountDisplayName({ kind: 'debt', name: 'Loans', archivedAt: null }, translate)).toBe(
      'Loans',
    );
  });

  it('returns the name a user gave a live property account', () => {
    expect(
      accountDisplayName({ kind: 'property', name: 'Family assets', archivedAt: null }, translate),
    ).toBe('Family assets');
  });

  it('returns the name a user gave a live debt account', () => {
    expect(
      accountDisplayName({ kind: 'debt', name: 'Bank debts', archivedAt: null }, translate),
    ).toBe('Bank debts');
  });

  it("returns the OTHER kind's sentinel as the typed name it is", () => {
    expect(
      accountDisplayName({ kind: 'property', name: 'Loans', archivedAt: null }, translate),
    ).toBe('Loans');
    expect(
      accountDisplayName({ kind: 'debt', name: 'Properties', archivedAt: null }, translate),
    ).toBe('Properties');
  });

  it('names a live implicit account with a blank stored name by its localized kind name', async () => {
    await i18n.changeLanguage('uk');

    expect(accountDisplayName({ kind: 'property', name: '', archivedAt: null }, translate)).toBe(
      'Майно',
    );
    expect(accountDisplayName({ kind: 'debt', name: '   ', archivedAt: null }, translate)).toBe(
      'Кредити',
    );
  });

  it('returns the stored name of an archived property account', () => {
    expect(accountDisplayName({ kind: 'property', name: 'Flat', archivedAt: 5 }, translate)).toBe(
      'Flat',
    );
  });

  it('returns the stored name of an archived debt account', () => {
    expect(accountDisplayName({ kind: 'debt', name: 'Mortgage', archivedAt: 5 }, translate)).toBe(
      'Mortgage',
    );
  });

  it('returns the stored name of every other kind', () => {
    for (const kind of otherKinds) {
      expect(accountDisplayName({ kind, name: 'Stored', archivedAt: null }, translate)).toBe(
        'Stored',
      );
    }
  });

  it('translates the sentinel under uk but returns a user-given name as typed', async () => {
    await i18n.changeLanguage('uk');

    expect(
      accountDisplayName({ kind: 'property', name: 'Properties', archivedAt: null }, translate),
    ).toBe('Майно');
    expect(accountDisplayName({ kind: 'debt', name: 'Loans', archivedAt: null }, translate)).toBe(
      'Кредити',
    );
    expect(
      accountDisplayName({ kind: 'property', name: 'Family assets', archivedAt: null }, translate),
    ).toBe('Family assets');
  });
});

describe('implicitAccountStoredName', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('stores the sentinel for the sentinel typed back', () => {
    expect(implicitAccountStoredName('property', 'Properties', translate)).toBe('Properties');
    expect(implicitAccountStoredName('debt', 'Loans', translate)).toBe('Loans');
  });

  it('stores the sentinel for the localized default left unchanged, under uk too', async () => {
    await i18n.changeLanguage('uk');

    expect(implicitAccountStoredName('property', 'Майно', translate)).toBe('Properties');
    expect(implicitAccountStoredName('debt', 'Кредити', translate)).toBe('Loans');
  });

  it('stores another name as typed, trimmed', () => {
    expect(implicitAccountStoredName('property', '  Family assets ', translate)).toBe(
      'Family assets',
    );
    expect(implicitAccountStoredName('debt', 'Bank debts', translate)).toBe('Bank debts');
  });

  it("stores the OTHER kind's sentinel as the name typed", () => {
    expect(implicitAccountStoredName('property', 'Loans', translate)).toBe('Loans');
    expect(implicitAccountStoredName('debt', 'Properties', translate)).toBe('Properties');
  });

  it("stores the OTHER kind's localized default as the name typed", async () => {
    await i18n.changeLanguage('uk');

    expect(implicitAccountStoredName('property', 'Кредити', translate)).toBe('Кредити');
  });
});
