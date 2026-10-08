import { currencyOptions, isFiat } from '@kiko/currency/currency';

import { canConvert, guardedNetWorth } from '../net-worth-view';
import { BASE_LEGS, composeRateTable } from '../monobank-feed-test-helper';

const NOW = Date.UTC(2026, 0, 1);

const composeTable = () => composeRateTable(async () => []);

describe('Monobank fiat coverage — every added fiat reaches every base leg', () => {
  it('composes a convertible path from every fiat to every base leg (no silent drop)', async () => {
    const table = await composeTable();

    for (const currency of currencyOptions) {
      if (!isFiat(currency)) {
        continue;
      }

      for (const base of BASE_LEGS) {
        expect(canConvert(currency, base, table)).toBe(true);
      }
    }
  });

  it('includes a holding of every fiat in the net-worth total for every base leg', async () => {
    const table = await composeTable();

    for (const currency of currencyOptions) {
      if (!isFiat(currency)) {
        continue;
      }

      for (const base of BASE_LEGS) {
        const total = guardedNetWorth(
          [{ id: 'h1', currency, balanceMinorUnits: 100_000, type: 'cash', metadata: null }],
          base,
          table,
          NOW,
        );

        // A dropped holding would leave the base-currency total at exactly zero.
        expect(total.currency).toBe(base);
        expect(total.minorUnits).toBeGreaterThan(0);
      }
    }
  });
});
