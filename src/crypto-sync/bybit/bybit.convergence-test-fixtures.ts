import { DAY_MS } from '@kiko/dates';

import { NOW } from './bybit.client-test-fixtures';
import { capitalWalkOf, served } from './bybit.capital-test-fixtures';
import { transferAt, transferWalkOf } from './bybit.transfer-test-fixtures';
import { depositRow, internalDepositRow, withdrawalRow } from './bybit.history-test-fixtures';

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
