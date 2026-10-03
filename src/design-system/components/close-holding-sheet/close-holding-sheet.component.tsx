import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import ConfirmSheet from '@kiko/design-system/components/confirm-sheet';

import { closeHoldingCopy } from './close-holding-copy';
import type { CloseHoldingSheetProps } from './close-holding-sheet.props';

// Closing stamps `closedAt` and keeps every lot, price, and ledger row, so the
// net-worth line keeps the holding's past value; a delete would erase it.
const CloseHoldingSheet: FC<CloseHoldingSheetProps> = ({ holding, visible, onDismiss }) => {
  const { t } = useTranslation();
  const copy = closeHoldingCopy(holding.type);

  const confirmClose = (): void => {
    onDismiss();
    holdingsRepo
      .closeMany([holding.id])
      .catch(() => alertOnCatch(t, copy.errorTitle, 'accountDetail.tryAgainMessage'));
  };

  return (
    <ConfirmSheet
      visible={visible}
      title={t(copy.title, { name: holding.name })}
      message={t(copy.message)}
      confirmLabel={t('common.close')}
      onConfirm={confirmClose}
      onCancel={onDismiss}
      destructive
      confirmTestID="close-holding-confirm"
    />
  );
};

export default CloseHoldingSheet;
