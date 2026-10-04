import type { AccountRow } from '@kiko/db';
import { KIKO_CATEGORIES_ICONS } from '@kiko/design-system/components/icon-pools';
import type { NativeStackHeaderItemButton } from '@react-navigation/native-stack';

import { accountIdentity } from '../account-identity';
import { accountIconPool } from '../entity-icon-pool';
import { accountKindSymbol } from '../entity-symbols';
import type { ImplicitAccountKind } from '../implicit-account';

// The name type a native header item takes for its SF Symbol: the symbol
// catalogue's union (`sf-symbols-typescript`, a transitive dependency of
// native-stack, so read through the item's own type rather than imported).
type HeaderSymbol = Extract<NativeStackHeaderItemButton['icon'], { type: 'sfSymbol' }>['name'];

// `accountKindSymbol`'s two implicit entries, picked so the `satisfies` proves
// each is a member of `HeaderSymbol` at compile time.
const implicitKindSymbol = {
  property: accountKindSymbol.property,
  debt: accountKindSymbol.debt,
} as const satisfies Record<ImplicitAccountKind, HeaderSymbol>;

// The icons an implicit account can hold in this app: a pick from the account
// picker's pool (`accountIconPool`, the very list the AccountForm offers, so
// the two cannot drift; it includes every kind glyph), or from the category
// pool, which covers part of the account picker's pool before the split. The
// `Set<HeaderSymbol>` element type proves every one is in `HeaderSymbol`, so a
// `has` check narrows soundly. A restored .kiko can hold any other string, and
// the native bar item draws no image at all for a name UIKit does not know.
const headerSymbols: ReadonlySet<HeaderSymbol> = new Set<HeaderSymbol>([
  ...accountIconPool,
  ...KIKO_CATEGORIES_ICONS,
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
