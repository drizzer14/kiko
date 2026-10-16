import type { HoldingRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';

import { settleMode } from '../mode-options';
import type { ChangeReturnRow } from '../row-labels';

type HoldingChangeSetters = {
  setMode: (mode: FormMode) => void;
  setDestinationHoldingId: (holdingId: string | null) => void;
  setValueIn: (valueIn: string) => void;
  setChangeReturns: (update: (rows: ChangeReturnRow[]) => ChangeReturnRow[]) => void;
};

// A return lands on a holding in the payer's currency (the return picker offers no other), so a
// row whose holding is in another one, or is not among `holdings` at all, would write a return in
// a currency the payment is not in. Its holding is emptied for the form to ask again; the row, its
// key and its amount stay.
export const emptyReturnsInOtherCurrency = <Row extends { holdingId: string | null }>(
  rows: readonly Row[],
  payerCurrency: Currency,
  holdings: readonly Pick<HoldingRow, 'id' | 'currency'>[],
): Row[] =>
  rows.map((row) =>
    row.holdingId === null ||
    holdings.some((holding) => holding.id === row.holdingId && holding.currency === payerCurrency)
      ? row
      : { ...row, holdingId: null },
  );

// What the form holds once the user picks `picked` as its primary holding. The mode moves only
// when the holding does not offer it (an exchange or a split from a card), a destination that is
// now the source goes with the Value in typed in its currency, and a split return in another
// currency than the pick loses its holding; every other field stays as typed.
export const applyHoldingChange = (
  picked: Pick<HoldingRow, 'id' | 'type' | 'currency'>,
  current: {
    mode: FormMode;
    destinationHoldingId: string | null;
    holdings: readonly Pick<HoldingRow, 'id' | 'currency'>[];
  },
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

  setters.setChangeReturns((rows) =>
    emptyReturnsInOtherCurrency(rows, picked.currency, current.holdings),
  );
};
