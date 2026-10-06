import type { HoldingRow } from '@kiko/db';
import { resolveEntityColor } from '@kiko/design-system/entity-tint';

import { defaultHoldingColor } from '../entity-colors';
import { defaultHoldingSymbol } from '../entity-symbols';

// The one icon + color every screen shows for a holding, the sibling of
// `accountIdentity`, so a picker row, the card, and the detail header can never
// diverge. The color goes through `resolveEntityColor`, not a bare
// `color ?? default`: an empty-string stored color slips past `??` and tints with
// an invalid value.
export const holdingIdentity = (
  holding: Pick<HoldingRow, 'icon' | 'color' | 'type' | 'metadata'>,
): { icon: string; color: string } => ({
  icon: holding.icon ?? defaultHoldingSymbol(holding),
  color: resolveEntityColor(holding.color, defaultHoldingColor[holding.type]),
});
