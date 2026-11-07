import type { ChargeGroups, RecurringSeries } from '@kiko/recurring/detection';

// STUB for the developer: the identity until the join of spec 19.2 replaces it, so the pins
// import a module that exists and fail on the missing join.
export const cardSwitchesJoinedOf = (
  detected: readonly RecurringSeries[],
  _chargeGroups: ChargeGroups,
): RecurringSeries[] => [...detected];
