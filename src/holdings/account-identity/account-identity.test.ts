import type { AccountRow } from '@kiko/db';
import { entityColorsDark } from '@kiko/design-system/palette';

import { accountKindSymbol } from '../entity-symbols';
import { defaultAccountColor } from '../entity-colors';

import { accountIdentity } from '.';

type AccountKind = AccountRow['kind'];

const accountKinds = Object.keys(accountKindSymbol) as AccountKind[];

describe('accountIdentity', () => {
  it('keeps a stored icon', () => {
    expect(accountIdentity({ kind: 'bank', icon: 'creditcard', color: null }).icon).toBe(
      'creditcard',
    );
  });

  it('falls back to the kind glyph for every kind when the stored icon is null', () => {
    for (const kind of accountKinds) {
      expect(accountIdentity({ kind, icon: null, color: null }).icon).toBe(accountKindSymbol[kind]);
    }
  });

  it('keeps a stored valid hex color', () => {
    expect(
      accountIdentity({ kind: 'bank', icon: null, color: entityColorsDark.violet }).color,
    ).toBe(entityColorsDark.violet);
  });

  it.each([null, ''])('resolves a %p stored color to the kind default for every kind', (color) => {
    for (const kind of accountKinds) {
      expect(accountIdentity({ kind, icon: null, color }).color).toBe(defaultAccountColor[kind]);
    }
  });

  it('resolves an unmapped kind with no stored color to the gray fallback', () => {
    const removedKind = 'retired_kind' as AccountKind;

    expect(accountIdentity({ kind: removedKind, icon: null, color: null }).color).toBe(
      entityColorsDark.gray,
    );
  });

  it('leaves the icon undefined for an unmapped kind with no stored icon', () => {
    const removedKind = 'retired_kind' as AccountKind;

    expect(accountIdentity({ kind: removedKind, icon: null, color: null }).icon).toBeUndefined();
  });
});
