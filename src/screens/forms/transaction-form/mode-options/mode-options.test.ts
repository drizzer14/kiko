import type { HoldingRow } from '@kiko/db';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';

import { DEFAULT_MODE, resolveModeOptions, settleMode } from './mode-options';

describe('settleMode', () => {
  it.each<[FormMode, HoldingRow['type']]>([
    ['income', 'cash'],
    ['expense', 'cash'],
    ['exchange', 'cash'],
    ['split', 'cash'],
    ['income', 'card'],
    ['expense', 'card'],
  ])('keeps %s for a %s holding', (mode, type) => {
    expect(settleMode(mode, { type })).toBe(mode);
  });

  it.each<FormMode>(['exchange', 'split'])('settles %s to the default for a card', (mode) => {
    expect(settleMode(mode, { type: 'card' })).toBe(DEFAULT_MODE);
  });

  it('settles to a mode every holding offers', () => {
    expect(resolveModeOptions(false, { type: 'card' })).toContain(DEFAULT_MODE);
  });
});
