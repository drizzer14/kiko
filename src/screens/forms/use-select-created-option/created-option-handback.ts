export type HandbackId = string;

// Module state, so it survives a fold, which remounts the picker. A value of `undefined` is an open
// handback that got no option yet.
const handbacks = new Map<HandbackId, string | undefined>();

let openedCount = 0;

// The id travels to the create form as a route param. It is a correlation id, not a secret, so it
// may ride in params.
export const openHandback = (): HandbackId => {
  openedCount += 1;

  const handbackId = `created-option-${openedCount}`;

  handbacks.set(handbackId, undefined);

  return handbackId;
};

// Writes only for an open id: a create form opened from anywhere else carries no id (or a closed
// one), so nothing is ever stored for it.
export const handBackCreatedOption = (
  handbackId: HandbackId | undefined,
  optionId: string,
): void => {
  if (handbackId !== undefined && handbacks.has(handbackId)) {
    handbacks.set(handbackId, optionId);
  }
};

// Reads the handed-back option id and deletes the entry, so the same call is the discard.
export const closeHandback = (handbackId: HandbackId): string | undefined => {
  const optionId = handbacks.get(handbackId);

  handbacks.delete(handbackId);

  return optionId;
};
