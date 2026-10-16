import { heldCurrenciesModule, holdCurrencies } from './held-currencies';

describe('held-currencies test helper', () => {
  afterEach(() => {
    holdCurrencies([]);
  });

  it('reads no held currency until a test chooses some', () => {
    expect(heldCurrenciesModule.useHeldCurrencies()).toEqual([]);
  });

  it('hands the chosen currencies to the mocked hook', () => {
    holdCurrencies(['USD', 'BTC']);

    expect(heldCurrenciesModule.useHeldCurrencies()).toEqual(['USD', 'BTC']);
  });
});
