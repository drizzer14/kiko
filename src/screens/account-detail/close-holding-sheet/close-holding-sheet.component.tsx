import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import ConfirmSheet from '@kiko/design-system/components/confirm-sheet';

import type { CloseHoldingSheetProps } from './close-holding-sheet.props';

// Closing stamps `closedAt` and keeps every lot, price, and ledger row, so the
// net-worth line keeps the holding's past value; a delete would erase it.
const CloseHoldingSheet: FC<CloseHoldingSheetProps> = ({ holding, visible, onDismiss }) => {
  const { t } = useTranslation();

  const confirmClose = (): void => {
    onDismiss();
    holdingsRepo
      .closeMany([holding.id])
      .catch(() =>
        alertOnCatch(t, 'accountDetail.closeHoldingErrorTitle', 'accountDetail.tryAgainMessage'),
      );
  };

  return (
    <ConfirmSheet
      visible={visible}
      title={t('accountDetail.closeHoldingTitle', { name: holding.name })}
      message={t('accountDetail.closeHoldingMessage')}
      confirmLabel={t('common.close')}
      onConfirm={confirmClose}
      onCancel={onDismiss}
      confirmTestID="close-holding-confirm"
    />
  );
};

export default CloseHoldingSheet;
