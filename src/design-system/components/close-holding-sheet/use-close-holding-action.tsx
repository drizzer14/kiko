import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { type ReactNode, useState } from 'react';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { isSyncedHolding } from '@kiko/holdings/deletable';

import { closeHoldingCopy } from './close-holding-copy';
import CloseHoldingSheet from './close-holding-sheet.component';

type CloseAction = { label: string; onPress: () => void };

type CloseHoldingAction = {
  closeActionFor: (holding: HoldingRow) => CloseAction | undefined;
  closeSheet: ReactNode;
};

// `account` is the account the holdings belong to: the sync check reads its
// connection, so a screen listing holdings of several accounts calls this once
// per account.
export const useCloseHoldingAction = (account: AccountRow | undefined): CloseHoldingAction => {
  const { t } = useTranslation();
  const [closeTarget, setCloseTarget] = useState<HoldingRow>();
  const [isCloseConfirmVisible, setCloseConfirmVisible] = useState(false);

  // A synced holding keeps its sync-driven close: the bank decides when it is
  // gone, so only a manual one offers Close.
  const closeActionFor = (holding: HoldingRow): CloseAction | undefined => {
    if (isSyncedHolding(holding, account)) {
      return undefined;
    }

    return {
      label: t(closeHoldingCopy(holding.type).action),
      onPress: () => {
        setCloseTarget(holding);
        setCloseConfirmVisible(true);
      },
    };
  };

  // The target stays set while the sheet animates out, so its title keeps the name.
  const closeSheet = foldMap(maybe(closeTarget), (holding) => (
    <CloseHoldingSheet
      holding={holding}
      visible={isCloseConfirmVisible}
      onDismiss={() => setCloseConfirmVisible(false)}
    />
  ));

  return { closeActionFor, closeSheet };
};
