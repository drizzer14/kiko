import type { HoldingRow } from '@kiko/db';
import type { ColorScheme } from '@kiko/design-system/palette';
import { entityDisplayColor, resolveEntityColor } from '@kiko/design-system/entity-tint';

import { defaultHoldingColor } from '../entity-colors';
import { defaultHoldingSymbol } from '../entity-symbols';

// The one icon + color every screen shows for a holding, the sibling of
// `accountIdentity`, so a picker row, the card, and the detail header can never
// diverge. The color goes through `resolveEntityColor`, not a bare
// `color ?? default`: an empty-string stored color slips past `??` and tints with
// an invalid value. It is the DISPLAY color for `scheme`; the stored color stays
// the canonical dark hex.
export const holdingIdentity = (
  holding: Pick<HoldingRow, 'icon' | 'color' | 'type' | 'metadata'>,
  scheme: ColorScheme,
): { icon: string; color: string } => ({
  icon: holding.icon ?? defaultHoldingSymbol(holding),
  color: entityDisplayColor(
    resolveEntityColor(holding.color, defaultHoldingColor[holding.type]),
    scheme,
  ),
});
