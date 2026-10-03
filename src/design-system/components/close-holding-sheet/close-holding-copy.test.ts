import { holdingTypes } from '@kiko/holdings/holding-type';

import { closeHoldingCopy } from './close-holding-copy';

describe('closeHoldingCopy', () => {
  it('gives a loan the loan copy', () => {
    expect(closeHoldingCopy('loan')).toEqual({
      action: 'accountDetail.closeLoanAction',
      title: 'accountDetail.closeLoanTitle',
      message: 'accountDetail.closeLoanMessage',
      errorTitle: 'accountDetail.closeLoanErrorTitle',
    });
  });

  it.each(holdingTypes.filter((type) => type !== 'loan'))('gives a %s the holding copy', (type) => {
    expect(closeHoldingCopy(type)).toEqual({
      action: 'accountDetail.closeHoldingAction',
      title: 'accountDetail.closeHoldingTitle',
      message: 'accountDetail.closeHoldingMessage',
      errorTitle: 'accountDetail.closeHoldingErrorTitle',
    });
  });
});
