import { BinanceWalkStop, logWalkStop } from './walk';

describe('BinanceWalkStop', () => {
  it('carries its fixed tag as the error name and its own code', () => {
    const stop = new BinanceWalkStop('capital-wallet-unknown');

    expect(stop).toBeInstanceOf(Error);
    expect(stop).toBeInstanceOf(BinanceWalkStop);
    expect(stop.name).toBe('BinanceWalkStop');
    expect(stop.message).toBe('capital-wallet-unknown');
    expect(stop.code).toBe('capital-wallet-unknown');
    expect(Object.hasOwn(stop, 'code')).toBe(true);
  });
});

describe('logWalkStop', () => {
  it('logs only the fixed tag and the stop code', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    logWalkStop('capital-amount-invalid');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[binance sync] history window stopped', {
      name: 'BinanceWalkStop',
      code: 'capital-amount-invalid',
    });
    warn.mockRestore();
  });
});
