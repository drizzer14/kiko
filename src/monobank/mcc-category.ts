/**
 * MCC (Merchant Category Code) → `categories.key` slug.
 *
 * This map is intentionally partial and MCC-approximate: MCCs are assigned
 * by card networks/acquirers and cover thousands of merchant types, but a
 * small, well-known subset is enough to give most everyday transactions a
 * useful category. Any MCC not present here falls back to the `other` slug
 * rather than guessing. Extend the per-category MCC lists below as more codes
 * are observed in real statement data.
 *
 * The value produced here is PERSISTED into `transactions.category`, so it is
 * the slug — never a display title. The user-facing title comes from the
 * categories table via `resolveCategoryDisplay`.
 */
/**
 * A cash withdrawal at an ATM/POS. Always an internal money movement (money
 * leaves the card as physical cash), never spending on the category chart.
 */
const CASH_OUT_MCC = 6011;

/**
 * Card top-ups / e-wallet loads. Like a cash-out, these move the user's own
 * money onto/off the card rather than spending it, so they are always excluded.
 */
const CARD_TOPUP_MCCS = [6012, 6540] as const;

/**
 * A bank transfer. This one is AMBIGUOUS: a 4829 to the user's OWN card is an
 * own-account transfer (excluded), but a 4829 to someone else is a genuine P2P
 * payment (kept as spending). The counterparty IBAN disambiguates — see
 * `transfer-exclusion.ts`.
 */
export const OWN_ACCOUNT_TRANSFER_MCC = 4829;

/**
 * The MCCs that are ALWAYS an internal money movement (a cash-out plus card
 * top-ups), never spending — dropped from the category pie unconditionally.
 * `OWN_ACCOUNT_TRANSFER_MCC` is deliberately NOT here: it is only excluded when
 * its counterparty IBAN is one of the user's own cards.
 */
export const ALWAYS_EXCLUDED_MCCS = [CASH_OUT_MCC, ...CARD_TOPUP_MCCS] as const;

// Keys are `categories.key` SLUGS, lowercase, matching
// drizzle/migrations/0002_seed_categories.sql exactly. This is the value
// persisted into `transactions.category`, so it MUST be the slug and not a
// display title: `transactions.category` is a plain text column with no
// COLLATE NOCASE, so a capitalized 'Groceries' never matched
// `categoriesRepo.delete`'s `eq(transactions.category, 'groceries')` predicate
// and stayed orphaned on a deleted category. The user-facing TITLE comes from
// the categories table via resolveCategoryDisplay, never from here.
const MCC_CATEGORIES: Record<string, readonly number[]> = {
  groceries: [5411, 5422, 5451, 5462, 5499],
  dining: [5812, 5813, 5814],
  transport: [4111, 4121, 4131, 4784, 5541, 5542, 7523],
  shopping: [5651, 5691, 5732, 5912, 5941, 5944, 5945, 5977],
  utilities: [4814, 4899, 4900],
  entertainment: [7832, 7922, 7996, 7997],
  health: [8011, 8021, 8042, 8062],
  cash: [CASH_OUT_MCC],
  transfers: [OWN_ACCOUNT_TRANSFER_MCC, ...CARD_TOPUP_MCCS],
};

const MCC_TO_CATEGORY: ReadonlyMap<number, string> = new Map(
  Object.entries(MCC_CATEGORIES).flatMap(([category, mccs]) =>
    mccs.map((mcc) => [mcc, category] as const),
  ),
);

export const categoryForMcc = (mcc: number): string => MCC_TO_CATEGORY.get(mcc) ?? 'other';
