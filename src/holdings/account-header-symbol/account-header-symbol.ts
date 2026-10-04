import type { AccountRow } from '@kiko/db';
import {
  KIKO_CATEGORIES_ICONS,
  KIKO_ENTITIES_ICONS,
} from '@kiko/design-system/components/icon-pools';
import type { NativeStackHeaderItemButton } from '@react-navigation/native-stack';

import { accountIdentity } from '../account-identity';
import type { ImplicitAccountKind } from '../implicit-account';

// The name type a native header item takes for its SF Symbol: the symbol
// catalogue's union (`sf-symbols-typescript`, a transitive dependency of
// native-stack, so read through the item's own type rather than imported).
type HeaderSymbol = Extract<NativeStackHeaderItemButton['icon'], { type: 'sfSymbol' }>['name'];

// `accountKindSymbol`'s two implicit entries as literals, so each is a member of
// `HeaderSymbol` at compile time; the plain `string` of `accountKindSymbol`
// is not. A test ties them to `accountKindSymbol`, the source of truth.
const implicitKindSymbol = {
  property: 'house.fill',
  debt: 'minus.circle.fill',
} as const satisfies Record<ImplicitAccountKind, HeaderSymbol>;

// The icons an implicit account can hold in this app: a pick from either icon
// pool the app ships (the account picker's pool today, and the pools an
// older build offered it, such as the category pool's `house`), or the kind
// glyph, which only a restored row stores (the app itself writes NULL). The
// `Set<HeaderSymbol>` element type proves every one is in `HeaderSymbol`, so
// a `has` check narrows soundly. A restored .kiko can hold any other string,
// and the native bar item draws no image at all for a name UIKit does not
// know.
const headerSymbols: ReadonlySet<HeaderSymbol> = new Set<HeaderSymbol>([
  ...KIKO_ENTITIES_ICONS,
  ...KIKO_CATEGORIES_ICONS,
  ...Object.values(implicitKindSymbol),
]);

const isHeaderSymbol = (name: string): name is HeaderSymbol => {
  const trustedNames: ReadonlySet<string> = headerSymbols;

  return trustedNames.has(name);
};

// The glyph on the header button of an implicit account: its stored icon (or
// the kind glyph when none is stored, per `accountIdentity`), and the kind
// glyph when that icon is not one the app can have written.
export const accountHeaderSymbol = (
  account: Pick<AccountRow, 'icon' | 'color'> & { kind: ImplicitAccountKind },
): HeaderSymbol => {
  const { icon } = accountIdentity(account);

  return isHeaderSymbol(icon) ? icon : implicitKindSymbol[account.kind];
};
