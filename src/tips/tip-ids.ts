export const TIP_IDS = [
  'accountDetail.importStatement',
  'settings.categories',
  'transaction.applyToAll',
] as const;

export type TipId = (typeof TIP_IDS)[number];
