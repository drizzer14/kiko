import type { Currency } from '@kiko/currency/currency';

// The currencies the user already holds, for a screen test that renders a currency picker.
// A test installs it with
// `jest.mock('@kiko/holdings/use-held-currencies', () =>
//   jest.requireActual('@kiko/test-support/held-currencies').heldCurrenciesModule)`
// and chooses what the picker sees with `holdCurrencies`, so the real live query is never read.
let held: readonly Currency[] = [];

export const holdCurrencies = (currencies: readonly Currency[]): void => {
  held = currencies;
};

export const heldCurrenciesModule = {
  useHeldCurrencies: (): readonly Currency[] => held,
};
