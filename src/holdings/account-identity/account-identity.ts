import type { AccountRow } from '@kiko/db';
import { resolveEntityColor } from '@kiko/design-system/entity-tint';

import { accountKindSymbol } from '../entity-symbols';
import { defaultAccountColor } from '../entity-colors';

// The one icon + color every screen shows for an account, so the card, the
// detail header, the reminders list, and the filter menus can never diverge.
// The color goes through `resolveEntityColor`, not a bare `color ?? default`:
// an empty-string stored color slips past `??` and tints with an invalid value.
export const accountIdentity = (
  account: Pick<AccountRow, 'icon' | 'color' | 'kind'>,
): { icon: string; color: string } => ({
  icon: account.icon ?? accountKindSymbol[account.kind],
  color: resolveEntityColor(account.color, defaultAccountColor[account.kind]),
});
