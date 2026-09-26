import { holdingValue } from '@kiko/holdings/holding-value';
import { seedCounterpartMinorUnits } from '@kiko/holdings/exchange-prefill';

import { Money, toMajor } from '../../currency/money';
import { FIAT_UAH_PRICE_SEED } from '../fiat-rate-seed';
import { buildPriceBook } from '../../prices/price-book';
import { metalInstrument } from '../../prices/instrument';
import { type RefreshDeps, refreshRates } from '../rates-refresh';
import { isCurrency, type Currency, type CryptoCurrency } from '../../currency/currency';
import { buildRateTable, canConvert, guardedBreakdown, guardedNetWorth } from '../net-worth-view';

import { convert, type RateEntry, type RateTable } from './conversion';

// This is a parity pin: it must pass unedited both before and after a
// stored-cross-pair rate table is replaced by a read-time UAH pivot. It
// therefore imports only the seams that exist on both sides of that change —
// `refreshRates`, `buildRateTable`, `canConvert`, `guardedNetWorth`,
// `guardedBreakdown`, `convert`, `seedCounterpartMinorUnits` — and never a
// pair-composition helper or a `RateTable` key read directly. Every expected
// value is computed HERE, from the fixture's own raw UAH-anchored prices,
// never read back from a `RateTable` the production code built.
const NOW = Date.UTC(2026, 0, 1);

// A distinct UAH price per fiat and a distinct USD price per crypto, all
// different from the fiat-rate-seed's own snapshot (`fiat-rate-seed.ts`) so a
// test that overrides the seed's default value is unambiguous.
const FIAT_UAH = { UAH: 1, USD: 41.5, EUR: 45.25, GBP: 52.1, PLN: 10.6 } as const;
const CRYPTO_USD = { BTC: 65_000, ETH: 3_100, USDT: 1.0002 } as const;

const isFiatFixtureKey = (currency: Currency): currency is keyof typeof FIAT_UAH =>
  currency in FIAT_UAH;
const isCryptoFixtureKey = (currency: Currency): currency is keyof typeof CRYPTO_USD =>
  currency in CRYPTO_USD;

/**
 * Each fixture currency's price in ONE UAH — the SAME pivot the parity
 * argument (PHASE4-plan.md, "Why a read-time pivot is bit-exact") describes:
 * `rateBetween(A, B) = uahPer(A) / uahPer(B)`, with a crypto's own UAH price
 * anchored through the SAME run's USD price, exactly as `buildUahPrice` does.
 */
const uahPer = (currency: Currency): number => {
  if (isCryptoFixtureKey(currency)) {
    return CRYPTO_USD[currency] * FIAT_UAH.USD;
  }

  if (isFiatFixtureKey(currency)) {
    return FIAT_UAH[currency];
  }
  throw new Error(`fixture has no UAH price for ${currency}`);
};

const fiatEntries: RateEntry[] = Object.entries(FIAT_UAH)
  .filter(([base]) => base !== 'UAH')
  .map(([base, rate]) => ({ base: base as Currency, quote: 'UAH', rate, source: 'monobank' }));

const cryptoEntries: RateEntry[] = Object.entries(CRYPTO_USD).map(([base, rate]) => ({
  base: base as Currency,
  quote: 'USD',
  rate,
  source: 'coingecko',
}));

type RefreshFixture = {
  fetchFiatRates?: RefreshDeps['fetchFiatRates'];
  fetchNbuRates?: RefreshDeps['fetchNbuRates'];
  fetchCryptoPrices?: RefreshDeps['fetchCryptoPrices'];
  cryptoCurrencies?: CryptoCurrency[];
};

/** Runs `refreshRates`, captures the upserted rows, and returns `buildRateTable(rows)`. */
const tableFromRefresh = async (fixture: RefreshFixture = {}): Promise<RateTable> => {
  const captured: { base: string; quote: string; rate: string }[][] = [];

  await refreshRates({
    fetchFiatRates: fixture.fetchFiatRates ?? (async () => fiatEntries),
    fetchNbuRates: fixture.fetchNbuRates ?? (async () => []),
    fetchCryptoPrices: fixture.fetchCryptoPrices ?? (async () => cryptoEntries),
    upsertMany: async (rows) => {
      captured.push(rows);
    },
    now: () => 1_000,
    lastRefreshAt: null,
    // A no-op, instant sleep so a fixture where fiat providers reject never
    // waits on `withRetry`'s real backoff timers.
    sleep: async () => {},
    openCurrencies: async () => ({
      needsFiat: true,
      cryptoCurrencies: fixture.cryptoCurrencies ?? ['BTC', 'ETH', 'USDT'],
    }),
  });

  const rows = captured[0] ?? [];

  return buildRateTable(
    rows.map((row) => {
      if (!isCurrency(row.base) || !isCurrency(row.quote)) {
        throw new Error(`unexpected pair ${row.base}:${row.quote}`);
      }

      return { base: row.base, quote: row.quote, rate: row.rate };
    }),
  );
};

const pin = (table: RateTable, from: Currency, to: Currency, sourceMajor = 100): void => {
  const expected = Money.fromMajor(to, sourceMajor * (uahPer(from) / uahPer(to)));
  expect(convert(Money.fromMajor(from, sourceMajor), to, table).minorUnits).toBe(
    expected.minorUnits,
  );
};

describe('Task 1.1 — current-rate pins', () => {
  let table: RateTable;

  beforeAll(async () => {
    table = await tableFromRefresh();
  });

  it.each([
    ['USD', 'EUR'],
    ['EUR', 'USD'],
    ['USD', 'UAH'],
    ['UAH', 'USD'],
    ['UAH', 'EUR'],
    ['GBP', 'PLN'],
    ['PLN', 'GBP'],
    ['BTC', 'UAH'],
    ['BTC', 'USD'],
    ['BTC', 'EUR'],
    ['ETH', 'BTC'],
    ['USDT', 'USD'],
    ['EUR', 'BTC'],
  ] as [Currency, Currency][])('pins %s -> %s through the UAH pivot', (from, to) => {
    pin(table, from, to);
  });
});

describe('Task 1.2 — seed-only pins (offline, fresh install)', () => {
  const seedUahPer = (currency: Currency): number => {
    const price = FIAT_UAH_PRICE_SEED[currency];

    if (price === undefined) {
      throw new Error(`seed has no UAH price for ${currency}`);
    }

    return price;
  };

  const seedPin = (table: RateTable, from: Currency, to: Currency, sourceMajor = 100): void => {
    const expected = Money.fromMajor(to, sourceMajor * (seedUahPer(from) / seedUahPer(to)));
    expect(convert(Money.fromMajor(from, sourceMajor), to, table).minorUnits).toBe(
      expected.minorUnits,
    );
  };

  it('prices GBP->USD, UAH->EUR, CHF->PLN from the seed with no live rows', () => {
    const table = buildRateTable([]);
    seedPin(table, 'GBP', 'USD');
    seedPin(table, 'UAH', 'EUR');
    seedPin(table, 'CHF', 'PLN');
  });

  it('excludes BTC->UAH — crypto has no offline seed', () => {
    expect(canConvert('BTC', 'UAH', buildRateTable([]))).toBe(false);
  });

  it('a live USD row overrides the seed while GBP stays seed-priced', () => {
    const table = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '999.5' }]);

    expect(convert(Money.fromMajor('USD', 100), 'UAH', table).minorUnits).toBe(
      Money.fromMajor('UAH', 99_950).minorUnits,
    );
    seedPin(table, 'GBP', 'UAH');
  });
});

// A cash/card holding + a term_deposit + two crypto assets + a metal + a bond
// + a loan, one holding per currency in FIAT_UAH/CRYPTO_USD above except PLN.
// `metadata` shapes mirror the same fixtures already proven correct in
// `net-worth-view.test.ts` (metal, loan) and `bond.descriptor.ts` (a bond
// valued on its own purchase day, before maturity, is worth exactly its own
// cost — no coupon/accrual math needed to make this pin deterministic).
const uahCard = {
  id: 'uah-card',
  currency: 'UAH' as Currency,
  type: 'cash' as const,
  balanceMinorUnits: 100_000, // 1000.00 UAH
  metadata: null,
};
const usdCard = {
  id: 'usd-card',
  currency: 'USD' as Currency,
  type: 'card' as const,
  balanceMinorUnits: 10_000, // 100.00 USD
  metadata: null,
};
const eurDeposit = {
  id: 'eur-deposit',
  currency: 'EUR' as Currency,
  type: 'term_deposit' as const,
  balanceMinorUnits: 0,
  metadata: {
    // Opened exactly `NOW`, so zero days have elapsed and zero interest has
    // accrued (`accruedMajor`'s `daysElapsed` clamps at 0) — the deposit's
    // value is exactly its own contribution, with no interest engine math
    // needed to make this pin deterministic.
    contributions: [{ amountMinorUnits: 300_000, date: NOW }], // 3000.00 EUR
    annualRatePct: 10,
    termMonths: 12,
    recapitalization: false,
    compounding: 'monthly' as const,
  },
};
const gbpCash = {
  id: 'gbp-cash',
  currency: 'GBP' as Currency,
  type: 'cash' as const,
  balanceMinorUnits: 5_000, // 50.00 GBP
  metadata: null,
};
const btcWallet = {
  id: 'btc-wallet',
  currency: 'BTC' as Currency,
  type: 'crypto_asset' as const,
  balanceMinorUnits: 100_000_000, // 1 BTC
  metadata: null,
};
const usdtWallet = {
  id: 'usdt-wallet',
  currency: 'USDT' as Currency,
  type: 'crypto_asset' as const,
  balanceMinorUnits: 10_000, // 100.00 USDT
  metadata: null,
};
const uahMetal = {
  id: 'uah-metal',
  currency: 'UAH' as Currency,
  type: 'metal' as const,
  balanceMinorUnits: 0,
  metadata: {
    metal: 'XAU',
    form: 'bar',
    unit: 'oz',
    purity: '1',
    lots: [{ day: NOW, quantityDelta: '1', costMinorUnits: 500_000 }],
  },
};
const uahBond = {
  id: 'uah-bond',
  currency: 'UAH' as Currency,
  type: 'bond' as const,
  balanceMinorUnits: 0,
  metadata: {
    quantity: 1,
    faceValueMinorUnits: 1_000_000,
    couponPct: 0,
    couponFrequency: 'annually' as const,
    bondKind: 'government' as const,
    purchaseDate: NOW, // live today, valued at its own cost: 7000.00 UAH
    purchasePriceMinorUnits: 700_000,
    maturityDate: NOW + 365 * 24 * 60 * 60 * 1000,
  },
};
const usdLoan = {
  id: 'usd-loan',
  currency: 'USD' as Currency,
  type: 'loan' as const,
  balanceMinorUnits: 0,
  metadata: {
    kind: 'personal' as const,
    principalMinorUnits: 200_000, // 2000.00 USD, no installment due yet at startDate
    startDate: NOW,
    annualRatePct: 10,
    termMonths: 24,
    schedule: 'annuity' as const,
  },
};

const netWorthHoldings = [
  uahCard,
  usdCard,
  eurDeposit,
  gbpCash,
  btcWallet,
  usdtWallet,
  uahMetal,
  uahBond,
  usdLoan,
];

const book = buildPriceBook([
  { instrument: metalInstrument('XAU'), day: NOW, price: '9000', currency: 'UAH', source: 'nbu' },
]);

const expectedConvertedMinor = (money: Money, base: Currency): number =>
  money.currency === base
    ? money.minorUnits
    : Money.fromMajor(
        base,
        toMajor(money.minorUnits, money.currency) * (uahPer(money.currency) / uahPer(base)),
      ).minorUnits;

const expectedNetWorthMinor = (base: Currency): number =>
  netWorthHoldings.reduce(
    (sum, holding) => sum + expectedConvertedMinor(holdingValue(holding, NOW, book), base),
    0,
  );

describe('Task 1.3 — net-worth pins, three bases', () => {
  it.each(['UAH', 'USD', 'EUR'] as Currency[])(
    'base %s: guardedNetWorth equals the sum of the independently computed conversions',
    async (base) => {
      const table = await tableFromRefresh();

      expect(guardedNetWorth(netWorthHoldings, base, table, NOW, book).minorUnits).toBe(
        expectedNetWorthMinor(base),
      );
    },
  );

  it.each(['UAH', 'USD', 'EUR'] as Currency[])(
    'base %s: guardedBreakdown keeps every currency, nothing dropped',
    async (base) => {
      const table = await tableFromRefresh();
      const breakdown = guardedBreakdown(netWorthHoldings, base, table, NOW, book);

      expect(new Set(breakdown.map((money) => money.currency))).toEqual(
        new Set(['UAH', 'USD', 'EUR', 'GBP', 'BTC', 'USDT']),
      );
    },
  );
});

describe('Task 1.4 — exchange-prefill pins', () => {
  it('USD->EUR and BTC->UAH match the 1.1 pins', async () => {
    const table = await tableFromRefresh();

    const usdToEur = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -10_000, // 100.00 USD withdrawn
      sourceCurrency: 'USD',
      counterpartCurrency: 'EUR',
      rateTable: table,
    });
    expect(usdToEur).toBe(Money.fromMajor('EUR', 100 * (uahPer('USD') / uahPer('EUR'))).minorUnits);

    const btcToUah = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -100_000_000, // 1 BTC withdrawn
      sourceCurrency: 'BTC',
      counterpartCurrency: 'UAH',
      rateTable: table,
    });
    expect(btcToUah).toBe(Money.fromMajor('UAH', uahPer('BTC') / uahPer('UAH')).minorUnits);
  });

  it('UAH->BTC with no crypto fetched returns null', async () => {
    const table = await tableFromRefresh({
      fetchCryptoPrices: async () => [],
      cryptoCurrencies: [],
    });

    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -100_00,
      sourceCurrency: 'UAH',
      counterpartCurrency: 'BTC',
      rateTable: table,
    });
    expect(seeded).toBeNull();
  });

  it('same currency returns the magnitude', async () => {
    const table = await tableFromRefresh();

    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -50_000,
      sourceCurrency: 'USD',
      counterpartCurrency: 'USD',
      rateTable: table,
    });
    expect(seeded).toBe(50_000);
  });
});

describe('Task 1.5 — unanchored crypto stays out', () => {
  it('drops BTC when both fiat providers fail, while USD still converts via the seed', async () => {
    const table = await tableFromRefresh({
      fetchFiatRates: () => Promise.reject(new Error('monobank offline')),
      fetchNbuRates: () => Promise.reject(new Error('nbu offline')),
    });

    expect(canConvert('BTC', 'UAH', table)).toBe(false);
    expect(canConvert('USD', 'UAH', table)).toBe(true);
  });
});
