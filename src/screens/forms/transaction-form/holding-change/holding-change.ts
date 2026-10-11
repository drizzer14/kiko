import type { HoldingRow } from '@kiko/db';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';

import { settleMode } from '../mode-options';

type HoldingChangeSetters = {
  setMode: (mode: FormMode) => void;
  setDestinationHoldingId: (holdingId: string | null) => void;
  setValueIn: (valueIn: string) => void;
};

// What the form holds once the user picks `picked` as its primary holding. The mode moves only
// when the holding does not offer it (an exchange or a split from a card), and a destination that
// is now the source goes with the Value in typed in its currency; every other field stays as typed.
export const applyHoldingChange = (
  picked: Pick<HoldingRow, 'id' | 'type'>,
  current: { mode: FormMode; destinationHoldingId: string | null },
  setters: HoldingChangeSetters,
): void => {
  const settledMode = settleMode(current.mode, picked);

  if (settledMode !== current.mode) {
    setters.setMode(settledMode);
  }

  if (current.destinationHoldingId === picked.id) {
    setters.setDestinationHoldingId(null);
    setters.setValueIn('');
  }
};
