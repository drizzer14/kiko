import type { AccountRow } from '../../db/schema';
import { entityColorsDark } from '../../design-system/palette';
import type { HoldingType } from '../holding-type';

// The default swatch shown for a newly-created account or holding, keyed by its
// kind/type. A user may override the color per entity later; until then the row
// renders the kind/type default. Values reference the named entity-color tokens
// (src/design-system/palette.ts) — the one source of truth for these hues — so a
// palette tweak never touches these maps.

type AccountKind = AccountRow['kind'];

// bank -> white, cash -> khaki, crypto -> yellow. Typed over the full
// `AccountKind` union, so adding an account kind is a compile error here until
// its default color is supplied.
export const defaultAccountColor: Record<AccountKind, string> = {
  bank: entityColorsDark.white,
  cash: entityColorsDark.khaki,
  crypto: entityColorsDark.yellow,
};

// card -> white, term_deposit -> blue, bond -> green, jar -> violet,
// cash -> khaki, crypto_asset -> yellow. Typed over the full `HoldingType`
// union for the same exhaustiveness guarantee as the account map above.
export const defaultHoldingColor: Record<HoldingType, string> = {
  card: entityColorsDark.white,
  term_deposit: entityColorsDark.blue,
  bond: entityColorsDark.green,
  jar: entityColorsDark.violet,
  cash: entityColorsDark.khaki,
  crypto_asset: entityColorsDark.yellow,
};
