import type { HoldingRow } from '@kiko/db';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';

import type { ChangeReturnRow } from '../row-labels';

import { applyHoldingChange, emptyReturnsInOtherCurrency } from './holding-change';

const setters = () => ({
  setMode: jest.fn(),
  setDestinationHoldingId: jest.fn(),
  setValueIn: jest.fn(),
  setChangeReturns: jest.fn(),
});

const HOLDINGS: Pick<HoldingRow, 'id' | 'currency'>[] = [
  { id: 'uah-friend', currency: 'UAH' },
  { id: 'usd-friend', currency: 'USD' },
];

const returnOf = (id: number, holdingId: string | null, amount = '5.00'): ChangeReturnRow => ({
  id,
  holdingId,
  amount,
});

const currentOf = (mode: FormMode, destinationHoldingId: string | null) => ({
  mode,
  destinationHoldingId,
  holdings: HOLDINGS,
});

describe('applyHoldingChange', () => {
  it.each<FormMode>(['exchange', 'split'])('settles %s to expense for a card', (mode) => {
    const spies = setters();

    applyHoldingChange(
      { id: 'card', type: 'card', currency: 'UAH' },
      currentOf(mode, 'usd'),
      spies,
    );

    expect(spies.setMode).toHaveBeenCalledWith('expense');
    expect(spies.setDestinationHoldingId).not.toHaveBeenCalled();
    expect(spies.setValueIn).not.toHaveBeenCalled();
  });

  it.each<FormMode>(['income', 'expense', 'exchange', 'split'])(
    'leaves %s and every field alone for a cash holding',
    (mode) => {
      const spies = setters();

      applyHoldingChange(
        { id: 'wallet', type: 'cash', currency: 'UAH' },
        currentOf(mode, 'usd'),
        spies,
      );

      expect(spies.setMode).not.toHaveBeenCalled();
      expect(spies.setDestinationHoldingId).not.toHaveBeenCalled();
      expect(spies.setValueIn).not.toHaveBeenCalled();
    },
  );

  it.each<FormMode>(['income', 'expense'])('leaves %s alone for a card', (mode) => {
    const spies = setters();

    applyHoldingChange({ id: 'card', type: 'card', currency: 'UAH' }, currentOf(mode, null), spies);

    expect(spies.setMode).not.toHaveBeenCalled();
  });

  it('drops a destination that is the new source, with the Value in typed for it', () => {
    const spies = setters();

    applyHoldingChange(
      { id: 'usd', type: 'cash', currency: 'USD' },
      currentOf('exchange', 'usd'),
      spies,
    );

    expect(spies.setDestinationHoldingId).toHaveBeenCalledWith(null);
    expect(spies.setValueIn).toHaveBeenCalledWith('');
    expect(spies.setMode).not.toHaveBeenCalled();
  });

  it('empties the return rows in another currency than the picked holding', () => {
    const spies = setters();

    applyHoldingChange(
      { id: 'usd', type: 'cash', currency: 'USD' },
      currentOf('split', null),
      spies,
    );

    const [update] = spies.setChangeReturns.mock.calls[0];

    expect(update([returnOf(0, 'uah-friend'), returnOf(1, 'usd-friend', '2.00')])).toEqual([
      returnOf(0, null),
      returnOf(1, 'usd-friend', '2.00'),
    ]);
  });
});

describe('emptyReturnsInOtherCurrency', () => {
  it('empties the holding of a row in another currency, keeping its amount and key', () => {
    expect(
      emptyReturnsInOtherCurrency([returnOf(3, 'uah-friend', '7.50')], 'USD', HOLDINGS),
    ).toEqual([returnOf(3, null, '7.50')]);
  });

  it('leaves a row in the same currency as it is', () => {
    const rows = [returnOf(0, 'uah-friend')];

    expect(emptyReturnsInOtherCurrency(rows, 'UAH', HOLDINGS)).toEqual(rows);
  });

  it('leaves a row with no holding as it is', () => {
    const rows = [returnOf(0, null, '')];

    expect(emptyReturnsInOtherCurrency(rows, 'USD', HOLDINGS)).toEqual(rows);
  });

  it('empties a row whose holding is unknown, since its currency cannot be matched', () => {
    expect(emptyReturnsInOtherCurrency([returnOf(0, 'gone')], 'UAH', HOLDINGS)).toEqual([
      returnOf(0, null),
    ]);
  });

  it('treats each row on its own', () => {
    expect(
      emptyReturnsInOtherCurrency(
        [returnOf(0, 'uah-friend'), returnOf(1, 'usd-friend'), returnOf(2, null, '')],
        'USD',
        HOLDINGS,
      ),
    ).toEqual([returnOf(0, null), returnOf(1, 'usd-friend'), returnOf(2, null, '')]);
  });
});
