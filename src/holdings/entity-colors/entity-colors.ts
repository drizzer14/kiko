import type { AccountRow } from '../../db/schema';
import type { HoldingType } from '../holding-type';
import { entityColorsDark } from '../../design-system/palette';

// The default swatch shown for a newly-created account or holding, keyed by its
// kind/type. A user may override the color per entity later; until then the row
// renders the kind/type default. Values reference the named entity-color tokens
// (src/design-system/palette.ts) — the one source of truth for these hues — so a
// palette tweak never touches these maps.

type AccountKind = AccountRow['kind'];

// bank -> white, cash -> khaki, crypto -> yellow, property -> brown,
// metals -> gray, debt -> red. Typed over the full `AccountKind` union, so
// adding an account kind is a compile error here until its default color is
// supplied. `gray` (previously unused in either default map) is the T17 pick
// for `metals` — thematically metallic, and brief left color choice
// unspecified, as with `brown` for `property` at T13. `red` (also previously
// unused in either map) is the T26 pick for `debt` — the conventional "money
// owed" hue, matching its sole holding type below.
export const defaultAccountColor: Record<AccountKind, string> = {
  bank: entityColorsDark.white,
  cash: entityColorsDark.khaki,
  crypto: entityColorsDark.yellow,
  property: entityColorsDark.brown,
  metals: entityColorsDark.gray,
  debt: entityColorsDark.red,
};

// card -> white, term_deposit -> blue, bond -> green, jar -> violet,
// cash -> khaki, crypto_asset -> yellow, property_item -> brown,
// metal -> gray, loan -> red. Typed over the full `HoldingType` union for
// the same exhaustiveness guarantee as the account map above. `loan` shares
// its `debt` kind's color, the same reuse `property_item`/`metal` follow.
export const defaultHoldingColor: Record<HoldingType, string> = {
  card: entityColorsDark.white,
  term_deposit: entityColorsDark.blue,
  bond: entityColorsDark.green,
  jar: entityColorsDark.violet,
  cash: entityColorsDark.khaki,
  crypto_asset: entityColorsDark.yellow,
  property_item: entityColorsDark.brown,
  metal: entityColorsDark.gray,
  loan: entityColorsDark.red,
};
