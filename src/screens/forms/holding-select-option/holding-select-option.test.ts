import type { HoldingRow } from '@kiko/db';
import { holdingIdentity } from '@kiko/holdings/holding-identity';

import { toHoldingOption } from '.';

const holdingOf = (overrides: Partial<HoldingRow> = {}): HoldingRow =>
  ({
    id: 'h1',
    name: 'Black card',
    accountId: 'a1',
    type: 'card',
    currency: 'USD',
    icon: null,
    color: null,
    metadata: null,
    ...overrides,
  }) as HoldingRow;

describe('toHoldingOption', () => {
  it('projects the holding to a picker option with its account name', () => {
    expect(toHoldingOption(holdingOf(), new Map([['a1', 'Monobank']]))).toEqual({
      id: 'h1',
      name: 'Black card',
      currency: 'USD',
      accountName: 'Monobank',
      ...holdingIdentity(holdingOf()),
    });
  });

  it("carries the holding's own stored icon and color", () => {
    const option = toHoldingOption(
      holdingOf({ icon: 'star', color: '#ABCDEF' }),
      new Map([['a1', 'Monobank']]),
    );

    expect(option).toMatchObject({ icon: 'star', color: '#ABCDEF' });
  });

  it('leaves the account name empty when the parent account is not in the map', () => {
    expect(toHoldingOption(holdingOf(), new Map([['other', 'Monobank']])).accountName).toBe('');
  });

  it('adds no field beyond the six a picker row reads', () => {
    expect(Object.keys(toHoldingOption(holdingOf(), new Map())).sort()).toEqual([
      'accountName',
      'color',
      'currency',
      'icon',
      'id',
      'name',
    ]);
  });
});
