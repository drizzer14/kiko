import { useCallback } from 'react';
import { useLiveQuery } from '@kiko/db';
import { settingsRepo } from '@kiko/settings';
import { logOnFailure } from '@kiko/diagnostics';

import { pickTip } from './pick-tip';
import { dismissedTipIds, type TipId } from './tip-ids';

type Tip = { visible: boolean; dismiss: () => void };

// `visible` stays false while the settings query loads, so a dismissed tip never flashes for
// one frame. A failed dismiss leaves the tip shown, which is harmless, so there is no alert.
export const useTip = (id: TipId, condition: boolean): Tip => {
  const { data, isLoading } = useLiveQuery(settingsRepo.getQuery(), ['settings'], true, {
    cached: true,
  });
  const dismissed = dismissedTipIds(data.at(0)?.dismissedTips ?? []);
  const visible = !isLoading && pickTip([{ id, condition }], dismissed) === id;
  const dismiss = useCallback(async (): Promise<void> => {
    await logOnFailure('tips.dismiss', () => settingsRepo.dismissTip(id));
  }, [id]);

  return { visible, dismiss };
};
