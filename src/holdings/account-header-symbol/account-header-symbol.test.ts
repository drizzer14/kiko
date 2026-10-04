import {
  KIKO_CATEGORIES_ICONS,
  KIKO_ENTITIES_ICONS,
} from '@kiko/design-system/components/icon-pools';

import { accountKindSymbol } from '../entity-symbols';
import { implicitAccountKinds } from '../implicit-account';

import { accountHeaderSymbol } from '.';

describe('accountHeaderSymbol', () => {
  it.each(implicitAccountKinds)('shows the stored icon of a %s account', (kind) => {
    expect(accountHeaderSymbol({ kind, icon: 'dollarsign.circle', color: null })).toBe(
      'dollarsign.circle',
    );
  });

  it.each(implicitAccountKinds)(
    'shows the kind default of a %s account that stores no icon',
    (kind) => {
      expect(accountHeaderSymbol({ kind, icon: null, color: null })).toBe(accountKindSymbol[kind]);
    },
  );

  it.each(implicitAccountKinds)('keeps the stored kind default of a %s account', (kind) => {
    expect(accountHeaderSymbol({ kind, icon: accountKindSymbol[kind], color: null })).toBe(
      accountKindSymbol[kind],
    );
  });

  // A backup from before the pool split kept the account picker's own pick,
  // and the AccountForm chip and the Home filter show it as is.
  it.each(['house', 'car'])('keeps the stored legacy %s icon', (icon) => {
    expect(accountHeaderSymbol({ kind: 'property', icon, color: null })).toBe(icon);
  });

  it.each(KIKO_CATEGORIES_ICONS)('keeps the stored category-pool icon %s', (icon) => {
    expect(accountHeaderSymbol({ kind: 'debt', icon, color: null })).toBe(icon);
  });

  it.each(KIKO_ENTITIES_ICONS)('keeps the stored entity-pool icon %s', (icon) => {
    expect(accountHeaderSymbol({ kind: 'property', icon, color: null })).toBe(icon);
  });

  // A restored .kiko can carry any string: the native bar item draws no image
  // at all for a name UIKit does not know, so such an icon falls back.
  it.each([
    ['an unknown name', 'not.a.symbol'],
    ['an empty string', ''],
    ["another kind's default", accountKindSymbol.bank],
  ])('falls back to the kind default for %s', (_label, icon) => {
    expect(accountHeaderSymbol({ kind: 'property', icon, color: null })).toBe(
      accountKindSymbol.property,
    );
  });
});
