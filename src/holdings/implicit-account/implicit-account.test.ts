import { i18n } from '@kiko/i18n/init';
import { accounts, type AccountRow } from '@kiko/db';

import {
  accountDisplayName,
  IMPLICIT_ACCOUNT_STORED_NAME,
  type ImplicitAccountKind,
  implicitAccountKinds,
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

  it('lists exactly the kinds it accepts', () => {
    expect([...implicitAccountKinds]).toEqual(['property', 'debt']);
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

  it('names a live property account by its kind, whatever its stored name', () => {
    expect(
      accountDisplayName({ kind: 'property', name: 'Flat', archivedAt: null }, translate),
    ).toBe('Properties');
  });

  it('names a live debt account by its kind, whatever its stored name', () => {
    expect(
      accountDisplayName({ kind: 'debt', name: 'Mortgage', archivedAt: null }, translate),
    ).toBe('Loans');
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

  it('translates the live names under uk', async () => {
    await i18n.changeLanguage('uk');

    expect(
      accountDisplayName({ kind: 'property', name: 'Flat', archivedAt: null }, translate),
    ).toBe('Майно');
    expect(
      accountDisplayName({ kind: 'debt', name: 'Mortgage', archivedAt: null }, translate),
    ).toBe('Кредити');
  });
});
