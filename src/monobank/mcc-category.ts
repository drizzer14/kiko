/**
 * MCC (Merchant Category Code) → human-readable transaction category.
 *
 * This map is intentionally partial and MCC-approximate: MCCs are assigned
 * by card networks/acquirers and cover thousands of merchant types, but a
 * small, well-known subset is enough to give most everyday transactions a
 * useful category. Any MCC not present here falls back to 'Other' rather
 * than guessing. Extend the per-category MCC lists below as more codes are
 * observed in real statement data.
 */
const MCC_CATEGORIES: Record<string, readonly number[]> = {
  Groceries: [5411, 5422, 5451, 5462, 5499],
  Dining: [5812, 5813, 5814],
  Transport: [4111, 4121, 4131, 4784, 5541, 5542, 7523],
  Shopping: [5651, 5691, 5732, 5912, 5941, 5944, 5945, 5977],
  Utilities: [4814, 4899, 4900],
  Entertainment: [7832, 7922, 7996, 7997],
  Health: [8011, 8021, 8042, 8062],
  Cash: [6011],
  Transfers: [4829, 6012, 6540],
};

const MCC_TO_CATEGORY: ReadonlyMap<number, string> = new Map(
  Object.entries(MCC_CATEGORIES).flatMap(([category, mccs]) =>
    mccs.map((mcc) => [mcc, category] as const),
  ),
);

export const categoryForMcc = (mcc: number): string => MCC_TO_CATEGORY.get(mcc) ?? 'Other';
