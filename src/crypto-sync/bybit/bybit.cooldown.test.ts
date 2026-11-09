import { isBybitCoolingDown, setBybitCooldownUntil } from './bybit.cooldown';

describe('bybit.cooldown', () => {
  it('reports cooling down before the cooldown instant, and not once it passes', () => {
    setBybitCooldownUntil('acc-cooldown-1', 1_000);

    expect(isBybitCoolingDown('acc-cooldown-1', 999)).toBe(true);
    expect(isBybitCoolingDown('acc-cooldown-1', 1_000)).toBe(false);
  });

  it('reports not cooling down for an account that never had a cooldown set', () => {
    expect(isBybitCoolingDown('acc-cooldown-never-set', 0)).toBe(false);
  });

  it('keeps the cooldown of each account apart', () => {
    setBybitCooldownUntil('acc-cooldown-2', 5_000);

    expect(isBybitCoolingDown('acc-cooldown-2', 4_999)).toBe(true);
    expect(isBybitCoolingDown('acc-cooldown-3', 4_999)).toBe(false);
  });
});
