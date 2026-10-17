import {
  type HistoryBackfillState,
  type SettledHistory,
  serializeHistoryBackfillState,
  settingsRepo,
} from '@kiko/settings';
import { DAY_MS } from '@kiko/dates';
import type { CryptoCurrency, Currency } from '@kiko/currency/currency';

import type { HistoryRateEntry } from '../history-entry';
import type { CryptoHistory } from '../coingecko-history';

import { type BackfillDeps, runBackfill } from './history-backfill';

const day = (index: number) => Date.UTC(2026, 8, 1) + index * DAY_MS;
const TODAY = day(2);

const anchors = (base: Currency, firstIndex: number): HistoryRateEntry[] =>
  [...new Set([firstIndex, 1, 2])].map((index) => ({
    base,
    quote: 'UAH',
    day: day(index),
    rate: 40,
    source: 'nbu',
  }));

const answeredNothing = (rateLimited: CryptoCurrency[] = []): CryptoHistory => ({
  entries: [],
  failedCurrencies: rateLimited,
  rateLimitedCurrencies: rateLimited,
});

type ChangeState = (state: HistoryBackfillState) => HistoryBackfillState;

// The settings row the run reads, and the two settings writers it calls, replaced by spies so a
// run goes through the repo's own default reader and writers.
const settingsRow = (stored: HistoryBackfillState) => {
  jest
    .spyOn(settingsRepo, 'historyBackfillStateQuery')
    .mockImplementation(
      () =>
        Promise.resolve([
          { historyBackfillState: serializeHistoryBackfillState(stored) },
        ]) as unknown as ReturnType<typeof settingsRepo.historyBackfillStateQuery>,
    );

  return {
    changed: jest.spyOn(settingsRepo, 'changeHistoryBackfillState').mockResolvedValue(undefined),
    recorded: jest.spyOn(settingsRepo, 'recordSettledHistory').mockResolvedValue(undefined),
  };
};

const runWithDefaultStore = (input: {
  fiat: Currency[];
  held: CryptoCurrency[];
  nbuAnswersFrom?: number;
  nbuCalls?: Currency[][];
  requested?: CryptoCurrency[][];
  rateLimited?: CryptoCurrency[];
}) => {
  const deps: BackfillDeps = {
    earliestDay: day(0),
    lastBackfilledDay: null,
    today: TODAY,
    fetchNbuHistory: async (currencies) => {
      input.nbuCalls?.push(currencies);

      return {
        entries: currencies.flatMap((currency) => anchors(currency, input.nbuAnswersFrom ?? 0)),
        failedCurrencies: [],
      };
    },
    fetchCryptoHistory: async (_days, currencies) => {
      input.requested?.push(currencies);

      return answeredNothing(input.rateLimited);
    },
    upsertMany: async () => {},
    historyCurrencies: async () => ({ fiatCurrencies: input.fiat, cryptoCurrencies: input.held }),
    knownEmptyCurrencies: new Set(),
  };

  return runBackfill(deps);
};

describe('runBackfill — the settings row as the default store of the cursor and the marks', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts at the stored cursor and leaves out a currency its stored mark says is empty', async () => {
    settingsRow({
      cursor: 'ETH',
      settled: { EUR: { start: day(0), firstDay: null, checkedOn: TODAY } },
    });
    const requested: CryptoCurrency[][] = [];
    const nbuCalls: Currency[][] = [];

    await runWithDefaultStore({
      fiat: ['EUR', 'USD'],
      held: ['BTC', 'ETH', 'SOL'],
      requested,
      nbuCalls,
    });

    expect(requested).toEqual([['ETH', 'SOL', 'BTC']]);
    expect(nbuCalls).toEqual([['USD']]);
  });

  it('saves the next cursor through a change that keeps the stored marks', async () => {
    const { changed } = settingsRow({ cursor: null, settled: {} });

    await runWithDefaultStore({ fiat: ['USD'], held: ['SOL'], rateLimited: ['SOL'] });

    expect(changed).toHaveBeenCalledTimes(1);

    const change = changed.mock.calls[0][0] as ChangeState;
    const marks: SettledHistory = { EUR: { start: 1, firstDay: 2 } };

    expect(change({ cursor: null, settled: marks })).toEqual({ cursor: 'SOL', settled: marks });
  });

  it('records the marks a run earns through the settings row', async () => {
    const { recorded } = settingsRow({ cursor: null, settled: {} });

    await runWithDefaultStore({ fiat: ['EUR'], held: [], nbuAnswersFrom: 1 });

    expect(recorded).toHaveBeenCalledWith({ EUR: { start: day(0), firstDay: day(1) } });
  });
});
