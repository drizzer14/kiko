import type { HoldingType } from './holding-type';

// The default SF Symbol glyph shown for a holding until the user picks a custom
// icon — the display-side fallback used by the holding list rows, the holding
// detail header, and (as the type-derived default) the create form's icon chip.
// One shared map so all three read the same default and a new holding type has
// a single place to gain its glyph.
export const holdingTypeIcon: Record<HoldingType, string> = {
  card: 'creditcard',
  term_deposit: 'banknote',
  bond: 'doc.text',
  cash: 'banknote',
  crypto_asset: 'bitcoinsign.circle',
  jar: 'cup.and.saucer',
};
