import type { FormMode } from '@kiko/screens/forms/mode-select-field';

import { applyHoldingChange } from './holding-change';

const setters = () => ({
  setMode: jest.fn(),
  setDestinationHoldingId: jest.fn(),
  setValueIn: jest.fn(),
});

describe('applyHoldingChange', () => {
  it.each<FormMode>(['exchange', 'split'])('settles %s to expense for a card', (mode) => {
    const spies = setters();

    applyHoldingChange({ id: 'card', type: 'card' }, { mode, destinationHoldingId: 'usd' }, spies);

    expect(spies.setMode).toHaveBeenCalledWith('expense');
    expect(spies.setDestinationHoldingId).not.toHaveBeenCalled();
    expect(spies.setValueIn).not.toHaveBeenCalled();
  });

  it.each<FormMode>(['income', 'expense', 'exchange', 'split'])(
    'leaves %s and every field alone for a cash holding',
    (mode) => {
      const spies = setters();

      applyHoldingChange(
        { id: 'wallet', type: 'cash' },
        { mode, destinationHoldingId: 'usd' },
        spies,
      );

      expect(spies.setMode).not.toHaveBeenCalled();
      expect(spies.setDestinationHoldingId).not.toHaveBeenCalled();
      expect(spies.setValueIn).not.toHaveBeenCalled();
    },
  );

  it.each<FormMode>(['income', 'expense'])('leaves %s alone for a card', (mode) => {
    const spies = setters();

    applyHoldingChange({ id: 'card', type: 'card' }, { mode, destinationHoldingId: null }, spies);

    expect(spies.setMode).not.toHaveBeenCalled();
  });

  it('drops a destination that is the new source, with the Value in typed for it', () => {
    const spies = setters();

    applyHoldingChange(
      { id: 'usd', type: 'cash' },
      { mode: 'exchange', destinationHoldingId: 'usd' },
      spies,
    );

    expect(spies.setDestinationHoldingId).toHaveBeenCalledWith(null);
    expect(spies.setValueIn).toHaveBeenCalledWith('');
    expect(spies.setMode).not.toHaveBeenCalled();
  });
});
