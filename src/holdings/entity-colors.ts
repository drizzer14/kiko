import type { AccountRow } from '../db/schema';
import { darkTheme } from '../design-system/theme';

import type { HoldingType } from './holding-type';

// The default swatch shown for a newly-created account or holding, keyed by its
// kind/type. A user may override the color per entity later; until then the row
// renders the kind/type default. Values reference the named entity-color tokens
// (src/design-system/theme.ts) — the one source of truth for these hues — so a
// palette tweak never touches these maps.

type AccountKind = AccountRow['kind'];

const { entityColors } = darkTheme.colors;

// bank -> white, cash -> khaki, crypto -> yellow. Typed over the full
// `AccountKind` union, so adding an account kind is a compile error here until
// its default color is supplied.
export const defaultAccountColor: Record<AccountKind, string> = {
  bank: entityColors.white,
  cash: entityColors.khaki,
  crypto: entityColors.yellow,
};

// card -> white, term_deposit -> blue, bond -> green, jar -> violet,
// cash -> khaki, crypto_asset -> yellow. Typed over the full `HoldingType`
// union for the same exhaustiveness guarantee as the account map above.
export const defaultHoldingColor: Record<HoldingType, string> = {
  card: entityColors.white,
  term_deposit: entityColors.blue,
  bond: entityColors.green,
  jar: entityColors.violet,
  cash: entityColors.khaki,
  crypto_asset: entityColors.yellow,
};
