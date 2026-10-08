import { KIKO_ENTITIES_ICONS } from '@kiko/design-system/components/icon-pools';

import {
  accountKindSymbol,
  holdingTypeSymbol,
  loanKindSymbol,
  propertyCategorySymbol,
} from '../entity-symbols';

// The icon pools of the account and holding forms: the Kiko Entities pool with
// the default glyphs of the entities each form edits put FIRST. A default is
// not a member of the curated pool (the pool file says so), so without this a
// user who picked a custom icon could never pick the entity's own glyph back.
// The defaults are read from the entity-symbol maps, the one source of truth,
// never copied. Set order is insertion order, so a default the pool already
// holds appears once, in the defaults position. It lives in `holdings`, not in
// the design system, because the design system must not import the entity
// maps: the screens pass the composed pool into the picker.
const defaultsFirst = <Icon extends string>(
  defaults: readonly Icon[],
  pool: readonly Icon[],
): readonly Icon[] => [...new Set<Icon>([...defaults, ...pool])];

// Every account kind's default: the form can open on any kind, and an implicit
// Properties/Loans account's glyph is the kind default too.
export const accountIconPool = defaultsFirst(Object.values(accountKindSymbol), KIKO_ENTITIES_ICONS);

// Every holding default: each type's glyph, each loan kind's and each property
// category's, since a loan and a property share one type.
export const holdingIconPool = defaultsFirst<string>(
  [
    ...Object.values(holdingTypeSymbol),
    ...Object.values(loanKindSymbol),
    ...Object.values(propertyCategorySymbol),
  ],
  KIKO_ENTITIES_ICONS,
);
