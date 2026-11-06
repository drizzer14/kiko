import type { AccountRow } from '@kiko/db';
import type { ColorScheme } from '@kiko/design-system/palette';
import { entityDisplayColor, resolveEntityColor } from '@kiko/design-system/entity-tint';

import { accountKindSymbol } from '../entity-symbols';
import { defaultAccountColor } from '../entity-colors';

// The one icon + color every screen shows for an account, so the card, the
// detail header, the reminders list, and the filter menus can never diverge.
// The color goes through `resolveEntityColor`, not a bare `color ?? default`:
// an empty-string stored color slips past `??` and tints with an invalid value.
// It is the DISPLAY color for `scheme`; the stored color stays the canonical dark
// hex, so a form never feeds this result to a write.
export const accountIdentity = (
  account: Pick<AccountRow, 'icon' | 'color' | 'kind'>,
  scheme: ColorScheme,
): { icon: string; color: string } => ({
  icon: account.icon ?? accountKindSymbol[account.kind],
  color: entityDisplayColor(
    resolveEntityColor(account.color, defaultAccountColor[account.kind]),
    scheme,
  ),
});
