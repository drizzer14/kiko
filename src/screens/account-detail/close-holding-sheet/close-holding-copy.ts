import type { ParseKeys } from 'i18next';
import type { HoldingRow } from '@kiko/db';

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

// A loan is a debt the user owes, not something they hold, so its Close
// never calls it a holding.
export const closeHoldingCopy = (type: HoldingRow['type']): CloseHoldingCopy =>
  type === 'loan' ? LOAN_COPY : HOLDING_COPY;
