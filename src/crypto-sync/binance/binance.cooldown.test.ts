import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';

describe('binance.cooldown', () => {
  it('reports cooling down before the cooldown instant, and not once it passes', () => {
    setBinanceCooldownUntil('acc-cooldown-1', 1_000);

    expect(isBinanceCoolingDown('acc-cooldown-1', 999)).toBe(true);
    expect(isBinanceCoolingDown('acc-cooldown-1', 1_000)).toBe(false);
  });

  it('reports not cooling down for an account that never had a cooldown set', () => {
    expect(isBinanceCoolingDown('acc-cooldown-never-set', 0)).toBe(false);
  });
});
