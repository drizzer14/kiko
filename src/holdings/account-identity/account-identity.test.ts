import type { AccountRow } from '@kiko/db';
import { lightTwinOfDark } from '@kiko/test-support/light-twin-of-dark';
import { entityColorsDark, entityColorsLight } from '@kiko/design-system/palette';

import { accountKindSymbol } from '../entity-symbols';
import { defaultAccountColor } from '../entity-colors';

import { accountIdentity } from '.';

type AccountKind = AccountRow['kind'];

const accountKinds = Object.keys(accountKindSymbol) as AccountKind[];

describe('accountIdentity', () => {
  it('keeps a stored icon', () => {
    expect(accountIdentity({ kind: 'bank', icon: 'creditcard', color: null }, 'dark').icon).toBe(
      'creditcard',
    );
  });

  it('falls back to the kind glyph for every kind when the stored icon is null', () => {
    for (const kind of accountKinds) {
      expect(accountIdentity({ kind, icon: null, color: null }, 'dark').icon).toBe(
        accountKindSymbol[kind],
      );
    }
  });

  it('keeps a stored valid hex color', () => {
    expect(
      accountIdentity({ kind: 'bank', icon: null, color: entityColorsDark.violet }, 'dark').color,
    ).toBe(entityColorsDark.violet);
  });

  it.each([null, ''])('resolves a %p stored color to the kind default for every kind', (color) => {
    for (const kind of accountKinds) {
      expect(accountIdentity({ kind, icon: null, color }, 'dark').color).toBe(
        defaultAccountColor[kind],
      );
    }
  });

  it('resolves an unmapped kind with no stored color to the gray fallback', () => {
    const removedKind = 'retired_kind' as AccountKind;

    expect(accountIdentity({ kind: removedKind, icon: null, color: null }, 'dark').color).toBe(
      entityColorsDark.gray,
    );
  });

  it('leaves the icon undefined for an unmapped kind with no stored icon', () => {
    const removedKind = 'retired_kind' as AccountKind;

    expect(
      accountIdentity({ kind: removedKind, icon: null, color: null }, 'dark').icon,
    ).toBeUndefined();
  });

  describe('in the light scheme', () => {
    it('maps a stored swatch to its light twin', () => {
      expect(
        accountIdentity({ kind: 'bank', icon: null, color: entityColorsDark.violet }, 'light')
          .color,
      ).toBe(entityColorsLight.violet);
    });

    it('maps a lower-case stored swatch to its light twin', () => {
      expect(
        accountIdentity(
          { kind: 'bank', icon: null, color: entityColorsDark.orange.toLowerCase() },
          'light',
        ).color,
      ).toBe(entityColorsLight.orange);
    });

    it.each([null, ''])('maps the kind default of a %p stored color for every kind', (color) => {
      for (const kind of accountKinds) {
        expect(accountIdentity({ kind, icon: null, color }, 'light').color).toBe(
          lightTwinOfDark[defaultAccountColor[kind]],
        );
      }
    });

    it('maps the gray fallback of an unmapped kind', () => {
      const removedKind = 'retired_kind' as AccountKind;

      expect(accountIdentity({ kind: removedKind, icon: null, color: null }, 'light').color).toBe(
        entityColorsLight.gray,
      );
    });

    it('leaves the icon as it is', () => {
      expect(accountIdentity({ kind: 'bank', icon: 'creditcard', color: null }, 'light').icon).toBe(
        'creditcard',
      );
    });
  });
});
