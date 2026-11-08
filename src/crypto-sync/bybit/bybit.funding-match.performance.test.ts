// The rule on rows of one amount and of plain amounts. Only results and counted work are asserted:
// a wall-clock bound fails under a loaded machine or a mutation run.
jest.mock('./bybit.funding-gap', () => {
  const actual = jest.requireActual('./bybit.funding-gap');

  return { ...actual, gapBetween: jest.fn(actual.gapBetween) };
});
jest.mock('@kiko/currency/decimal', () => {
  const actual = jest.requireActual('@kiko/currency/decimal');

  return { ...actual, normalizeDecimal: jest.fn(actual.normalizeDecimal) };
});

import { DAY_MS } from '@kiko/dates';
import type { FundingMatchRow } from '@kiko/db';
import { normalizeDecimal } from '@kiko/currency/decimal';

import { gapBetween } from './bybit.funding-gap';
import { FUNDING_MATCH_WINDOW_MS } from './bybit.funding-match';
import { atDay, ledgerRowOf, sourceRowOf, verdictsOf } from './bybit.funding-test-fixtures';

const HOUR_MS = DAY_MS / 24;

const WINDOW_HOURS = FUNDING_MATCH_WINDOW_MS / HOUR_MS;

const keyOf = (prefix: string, index: number): string =>
  `${prefix}-${String(index).padStart(6, '0')}`;

// A source far from a row can pair with it only past the window, so a scan that visits it has
// done work no verdict needs: the pairs inside the window are the least that a scan must test.
const pairsWithinWindow = (ledgerCount: number, sourceCount: number): number => {
  let pairs = 0;

  for (let ledger = 0; ledger < ledgerCount; ledger += 1) {
    const first = Math.max(0, ledger + 1 - WINDOW_HOURS);
    const last = Math.min(sourceCount - 1, ledger + 1 + WINDOW_HOURS);

    pairs += Math.max(0, last - first + 1);
  }

  return pairs;
};

describe('the work of the rule on a long series of one amount', () => {
  it('scans only the sources of an amount that lie within W of each ledger row', () => {
    const count = 2_000;
    const rows = [
      ...Array.from({ length: count }, (_unused, index) =>
        sourceRowOf(keyOf('source', index), 'deposit', atDay(0) + index * HOUR_MS),
      ),
      ...Array.from({ length: count }, (_unused, index) =>
        ledgerRowOf(keyOf('ledger', index), atDay(0) + (index + 1) * HOUR_MS),
      ),
    ];

    jest.mocked(gapBetween).mockClear();

    const verdicts = verdictsOf(rows);

    expect(new Set(Object.values(verdicts))).toEqual(new Set(['explained']));
    expect(Object.keys(verdicts)).toHaveLength(count);
    expect(jest.mocked(gapBetween)).toHaveBeenCalledTimes(pairsWithinWindow(count, count));
  });
});

describe('the work of the rule on plain amounts', () => {
  it('reads a plain ledger amount with no normalizeDecimal', () => {
    const sourceCount = 200;
    const rows: FundingMatchRow[] = [
      ...Array.from({ length: sourceCount }, (_unused, index) =>
        sourceRowOf(keyOf('source', index), 'deposit', atDay(10), { amount: `${index}.75` }),
      ),
      ...Array.from({ length: 10_000 }, (_unused, index) =>
        ledgerRowOf(keyOf('ledger', index), atDay(10), { amount: `${index}.25` }),
      ),
    ];

    jest.mocked(normalizeDecimal).mockClear();

    verdictsOf(rows);

    expect(jest.mocked(normalizeDecimal)).toHaveBeenCalledTimes(sourceCount);
  });
});
