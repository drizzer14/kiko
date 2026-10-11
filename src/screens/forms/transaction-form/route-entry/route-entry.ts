import type { TransactionFormParams } from '@kiko/navigation/types';

// The three mutually-exclusive entry ids read once from the route params, so
// the component body spends no `in`-check branch on any of them (the union
// keeps at most one non-null). `holdingParamId` is the plain-add holding;
// `duplicateOfId` seeds a CREATE pre-filled from an existing manual row.
export const readRouteEntry = (
  params: TransactionFormParams,
): {
  editingId: string | null;
  duplicateOfId: string | null;
  holdingParamId: string | null;
  // The empty-create (global-add, B) case: none of the three ids present, so
  // the form fixes no holding by navigation and renders its own primary-leg
  // picker. Derived here, in the same pure read, so the component spends no
  // boolean chain on it.
  isEmptyCreate: boolean;
} => {
  const editingId = 'transactionId' in params ? params.transactionId : null;
  const duplicateOfId =
    'duplicateOfTransactionId' in params ? params.duplicateOfTransactionId : null;
  const holdingParamId = 'holdingId' in params ? params.holdingId : null;

  return {
    editingId,
    duplicateOfId,
    holdingParamId,
    isEmptyCreate: editingId === null && duplicateOfId === null && holdingParamId === null,
  };
};
