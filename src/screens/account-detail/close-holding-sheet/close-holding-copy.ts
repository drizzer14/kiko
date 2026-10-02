import type { ParseKeys } from 'i18next';
import type { HoldingRow } from '@kiko/db';
import { holdingDescriptorOrUndefined } from '@kiko/holdings/holding-descriptor';

type CloseHoldingCopy = Record<'action' | 'title' | 'message' | 'errorTitle', ParseKeys>;

const HOLDING_COPY: CloseHoldingCopy = {
  action: 'accountDetail.closeHoldingAction',
  title: 'accountDetail.closeHoldingTitle',
  message: 'accountDetail.closeHoldingMessage',
  errorTitle: 'accountDetail.closeHoldingErrorTitle',
};

const LOAN_COPY: CloseHoldingCopy = {
  action: 'accountDetail.closeLoanAction',
  title: 'accountDetail.closeLoanTitle',
  message: 'accountDetail.closeLoanMessage',
  errorTitle: 'accountDetail.closeLoanErrorTitle',
};

// A debt-side type (a loan) is owed, not held, so its Close never calls it a
// holding. Keyed off the same descriptor `side` net-worth math reads.
export const closeHoldingCopy = (type: HoldingRow['type']): CloseHoldingCopy =>
  holdingDescriptorOrUndefined(type)?.side === 'debt' ? LOAN_COPY : HOLDING_COPY;
