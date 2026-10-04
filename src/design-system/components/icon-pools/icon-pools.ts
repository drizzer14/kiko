// The two curated SF Symbol picker pools, each governing one flow.
// Editing an icon is deliberately a pick from a closed list rather than free
// text: the app renders every icon through SymbolIcon/SFSymbolView, whose tint
// path only handles known-good names, so an arbitrary user string could resolve
// to an invisible/blank glyph.
//
// These are pools of USER-SELECTABLE OPTIONS only. A seeded default (a category
// row, an entity type-default) may legitimately sit OUTSIDE its pool — a default
// is not required to be a member of the picker options, and must never be
// filtered or remapped to force pool membership.
//
// Both lists are copied VERBATIM from the curated "Kiko Entities" and "Kiko
// Categories" SF Symbols collections. A unit of its own, apart from the
// modal, so domain code that only needs the names (the header symbol guard)
// does not load the modal component and its styles; the screen call sites
// import the matching pool and thread it through the shared identity field →
// IconEditor → IconPickerModal.

// Kiko Entities pool (62) — the curated base of the account/holding IconEditor
// pools. Does NOT include the per-KIND type-defaults, which stay decided in the
// central entity-symbols map: the account and holding forms open the pools
// `@kiko/holdings/entity-icon-pool` composes (these icons after those defaults),
// so a user who picks a custom icon can pick the entity's own glyph back.
export const KIKO_ENTITIES_ICONS = [
  'archivebox',
  'australiandollarsign',
  'australsign',
  'bahtsign',
  'banknote',
  'bitcoinsign',
  'bitcoinsign.circle',
  'brazilianrealsign',
  'building',
  'calendar',
  'cedisign',
  'centsign',
  'chineseyuanrenminbisign',
  'coloncurrencysign',
  'creditcard',
  'cruzeirosign',
  'danishkronesign',
  'document',
  'dollarsign',
  'dollarsign.circle',
  'dongsign',
  'envelope.front',
  'eurosign',
  'eurosign.circle',
  'eurozonesign',
  'externaldrive',
  'florinsign',
  'folder',
  'francsign',
  'giftcard',
  'guaranisign',
  'hockey.puck',
  'hryvniasign',
  'hryvniasign.circle',
  'indianrupeesign',
  'kipsign',
  'larisign',
  'lirasign',
  'malaysianringgitsign',
  'manatsign',
  'millsign',
  'nairasign',
  'norwegiankronesign',
  'peruviansolessign',
  'pesetasign',
  'pesosign',
  'polishzlotysign',
  'receipt',
  'rectangle.portrait',
  'rupeesign',
  'shekelsign',
  'singaporedollarsign',
  'sterlingsign',
  'swedishkronasign',
  'tengesign',
  'tray',
  'tugriksign',
  'turkishlirasign',
  'wallet.bifold',
  'wallet.pass',
  'wonsign',
  'yensign',
] as const;

// Kiko Categories pool (78) — the category picker pool. Every seeded
// category default IS a member of this pool, so each of the 10 default icons
// (e.g. Utilities `bolt`, Other `square.grid.2x2`, Transfers
// `arrow.left.arrow.right`) is selectable in the picker. `percent`
// is the eleventh default's icon (`loan_interest`, seeded by its
// own LATER migration, 0039 — not part of `SEEDED_CATEGORIES`, see that
// fixture's own comment), added here for the same reason. The generic
// category glyph a new category starts on (`genericEntitySymbol.category`
// in @kiko/holdings/entity-symbols) is added beyond the curated collection so
// a user who picks another icon can pick it back.
export const KIKO_CATEGORIES_ICONS = [
  'airplane',
  'antenna.radiowaves.left.and.right',
  'arrow.left.arrow.right',
  'arrow.up.arrow.down',
  'bag',
  'banknote',
  'basket',
  'bed.double',
  'bicycle',
  'bird',
  'bolt',
  'book',
  'brain',
  'briefcase',
  'building',
  'bus',
  'calendar.and.person',
  'camera',
  'car',
  'cart',
  'cat',
  'creditcard',
  'cross',
  'cup.and.heat.waves',
  'cup.and.saucer',
  'display',
  'dog',
  'dumbbell',
  'fish',
  'flask',
  'fork.knife',
  'fuelpump',
  'gamecontroller',
  'gift',
  'guitars',
  'hammer',
  'handbag',
  'hare',
  'headphones',
  'heart',
  'hifispeaker',
  'house',
  'key.horizontal',
  'laptopcomputer',
  'lock',
  'lungs',
  'mouth',
  'movieclapper',
  'mustache',
  'nosign',
  'paintbrush.pointed',
  'paintpalette',
  'parkingsign',
  'party.popper',
  'pawprint',
  'percent',
  'phone',
  'pianokeys',
  'popcorn',
  'repeat',
  'shippingbox',
  'shoe',
  'smartphone',
  'square.grid.2x2',
  'staroflife',
  'stethoscope',
  'stroller',
  'tag',
  'teddybear',
  'tent',
  'theatermasks',
  'ticket',
  'tram',
  'tshirt',
  'wallet.pass',
  'wheelchair',
  'wineglass',
  'xmark.triangle.circle.square',
] as const;
