import { DAY_MS } from '@kiko/dates';

import {
  convertAt,
  depositRow,
  internalDepositRow,
  withdrawalRow,
} from './bybit.history-test-fixtures';
import { NOW } from './bybit.client-test-fixtures';
import { logWalkOf, spotAt } from './bybit.log-test-fixtures';
import { convertWalkOf } from './bybit.convert-test-fixtures';
import { capitalWalkOf, served } from './bybit.capital-test-fixtures';
import { transferAt, transferWalkOf } from './bybit.transfer-test-fixtures';

export const SECOND_MS = 1_000;

/** The floor of a run at `NOW`: the walks read 729 days back. */
export const FLOOR = NOW - 729 * DAY_MS;

// A row near either end of the history is read by the first forward window or the last, which a
// seed of this suite wants to keep apart from the edge cases the walk suites own.
const EDGE_MS = 3_600_000;

const COINS = ['BTC', 'ETH', 'USDT'];

export type RowSlot = { id: number; at: number; coin: string; amount: string };

/** `count` rows spread evenly over `[from, to)`, at whole seconds, each on its own id. */
export const evenSlots = (count: number, from = FLOOR + EDGE_MS, to = NOW - EDGE_MS): RowSlot[] =>
  Array.from({ length: count }, (_unused, id) => ({
    id,
    at: Math.floor((from + ((id + 0.5) * (to - from)) / count) / SECOND_MS) * SECOND_MS,
    coin: COINS[id % COINS.length],
    amount: String(1 + (id % 9)),
  }));

/** What a world holds: one list of slots per series the fake Bybit serves. */
export type WorldSlots = {
  deposit: RowSlot[];
  internal: RowSlot[];
  withdraw: RowSlot[];
  transfer: RowSlot[];
};

type CapitalOptions = Parameters<typeof capitalWalkOf>[0];

type TransferOptions = Parameters<typeof transferWalkOf>[0];

/**
 * A Bybit account of both walks over one stored state (one `walkStateFake`) and one fake Bybit
 * each.
 */
export const accountOf = <State extends CapitalOptions['state'] & TransferOptions['state']>(
  options: Omit<CapitalOptions, 'state'> & { state: State },
) => ({
  state: options.state,
  capital: capitalWalkOf(options),
  transfer: transferWalkOf(options),
});

type Account = ReturnType<typeof accountOf>;

/**
 * The pages the fake serves: deposits at `successAt`, internal deposits, withdrawals and
 * transfers.
 */
export const serveSlots = (account: Account, slots: WorldSlots): void => {
  account.capital.world.deposit = slots.deposit.map(({ id, at, coin, amount }) =>
    served(at, depositRow({ id: `d${id}`, coin, amount, successAt: String(at) })),
  );
  account.capital.world.internal = slots.internal.map(({ id, at, coin, amount }) =>
    served(
      at,
      internalDepositRow({ id: `i${id}`, coin, amount, createdTime: String(at / SECOND_MS) }),
    ),
  );
  account.capital.world.withdraw = slots.withdraw.map(({ id, at, coin, amount }) =>
    served(
      at,
      withdrawalRow({
        withdrawId: `w${id}`,
        coin,
        amount,
        createTime: String(at),
        updateTime: String(at + SECOND_MS),
      }),
    ),
  );
  account.transfer.world.transfer = slots.transfer.map(({ id, at, coin, amount }) =>
    transferAt(at, { transferId: `t${id}`, coin, amount }),
  );
};

// The pair a spot row of a coin is traded in: the symbol names the row's coin and one other
// tracked coin.
const SYMBOL_OF: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  USDT: 'BTCUSDT',
  EUR: 'BTCEUR',
};

/**
 * One spot row of the log for a slot, built on the docs page's TRADE sample, with no fee. Its
 * `qty` is the slot's amount, so `change + fee = qty` holds; a `qty` of another value is a spot
 * row that fails that check.
 */
export const logRowOf = ({ id, at, coin, amount }: RowSlot, qty = amount) =>
  spotAt(at, {
    id: `l${id}`,
    orderId: `o${id}`,
    symbol: SYMBOL_OF[coin],
    currency: coin,
    qty,
    fee: '0',
    change: amount,
  });

/**
 * `count` rows inside `[from, from + span)` at the millisecond, so several can share one instant.
 */
export const burstOfRows = (count: number, from: number, span: number): RowSlot[] =>
  Array.from({ length: count }, (_unused, id) => ({
    id,
    at: from + Math.floor((id * span) / count),
    coin: 'BTC',
    amount: '1',
  }));

/** The convert list, newest first, in pages of `pageSize` converts, one convert for each slot. */
export const convertPagesOf = (
  slots: RowSlot[],
  pageSize: number,
  overrides: Record<string, unknown> = {},
) => {
  const converts = [...slots]
    .sort((left, right) => right.at - left.at)
    .map(({ id, at, coin, amount }) =>
      convertAt(
        at,
        {
          fromCoin: coin,
          toCoin: coin === 'BTC' ? 'ETH' : 'BTC',
          fromAmount: amount,
          toAmount: amount,
          ...overrides,
        },
        `c${id}`,
      ),
    );

  return Array.from({ length: Math.ceil(converts.length / pageSize) }, (_unused, page) =>
    converts.slice(page * pageSize, (page + 1) * pageSize),
  );
};

type LogOptions = Parameters<typeof logWalkOf>[0];

type ConvertOptions = Parameters<typeof convertWalkOf>[0];

/**
 * A Bybit account of the log walk and the convert walk over one stored state (one
 * `walkStateFake`), the log over its fake Bybit and the convert over its fake list.
 */
export const logAndConvertAccountOf = <State extends LogOptions['state'] & ConvertOptions['state']>(
  options: Omit<LogOptions, 'state'> & { state: State },
) => ({
  state: options.state,
  log: logWalkOf(options),
  convert: convertWalkOf({ state: options.state, beforeWrite: options.beforeWrite }),
});
