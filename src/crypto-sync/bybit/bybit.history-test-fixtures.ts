import type { WalkWindow } from '@kiko/crypto-sync/exchange/walk';

import { NOW, answerWith, envelopeOf } from './bybit.client-test-fixtures';

export const SPAN: WalkWindow = { start: 1_741_000_000_000, end: 1_743_000_000_000 };

// A value in a field the client must never read: a test looks for it in what the client gives back.
export const NEVER_READ = 'SENTINEL-NEVER-READ';

// Each row keeps the field words and the sample values of its page (deposit: amount "999.0496",
// status 3, successAt "1742728163000", depositType "0"; internal deposit: createdTime
// "1705393280"; withdrawal: amount "41.43008", status "success"; transfer: amount "5000", SPOT to
// UNIFIED, status "SUCCESS"). The values the page does not give are built.
export const depositRow = (overrides: Record<string, unknown> = {}) => ({
  id: '1234',
  coin: 'USDT',
  chain: 'ETH',
  amount: '999.0496',
  status: 3,
  toAddress: NEVER_READ,
  tag: NEVER_READ,
  depositFee: '',
  successAt: '1742728163000',
  confirmations: '',
  blockHash: NEVER_READ,
  batchReleaseLimit: '-1',
  depositType: '0',
  fromAddress: NEVER_READ,
  ...overrides,
});

export const internalDepositRow = (overrides: Record<string, unknown> = {}) => ({
  id: '5678',
  type: 1,
  coin: 'USDT',
  amount: '12.5',
  status: 2,
  address: NEVER_READ,
  txID: NEVER_READ,
  createdTime: '1705393280',
  fromMemberId: NEVER_READ,
  complianceStatus: NEVER_READ,
  ...overrides,
});

export const withdrawalRow = (overrides: Record<string, unknown> = {}) => ({
  withdrawId: '9012',
  withdrawType: 0,
  coin: 'USDT',
  chain: 'ETH',
  amount: '41.43008',
  withdrawFee: '5',
  status: 'success',
  toAddress: NEVER_READ,
  tag: NEVER_READ,
  createTime: '1742728163000',
  updateTime: '1742728999000',
  ...overrides,
});

export const transferRow = (overrides: Record<string, unknown> = {}) => ({
  transferId: 'f4a5e7b8-0000-4000-8000-000000000001',
  coin: 'USDT',
  amount: '5000',
  fromAccountType: 'SPOT',
  toAccountType: 'UNIFIED',
  timestamp: '1742728163000',
  status: 'SUCCESS',
  ...overrides,
});

// The log page's three sample rows, as the page prints them (a SETTLEMENT and two linear TRADE
// rows, from the page's response example read 2026-11-06). No page shows a spot row.
export const LOG_PAGE_SAMPLE = [
  {
    transSubType: '',
    id: '592324_XRPUSDT_161440249321',
    symbol: 'XRPUSDT',
    side: 'Buy',
    funding: '-0.003676',
    orderLinkId: '',
    orderId: '1672128000-8-592324-1-2',
    fee: '0.00000000',
    change: '-0.003676',
    cashFlow: '0',
    transactionTime: '1672128000000',
    type: 'SETTLEMENT',
    feeRate: '0.0001',
    bonusChange: '',
    size: '100',
    qty: '100',
    cashBalance: '5086.55825002',
    currency: 'USDT',
    category: 'linear',
    tradePrice: '0.3676',
    tradeId: '534c0003-4bf7-486f-aa02-78cee36825e4',
    extraFees: '',
  },
  {
    transSubType: '',
    id: '592324_XRPUSDT_161440249321',
    symbol: 'XRPUSDT',
    side: 'Buy',
    funding: '',
    orderLinkId: 'linear-order',
    orderId: '592b7e41-78fd-42e2-9aa3-91e1835ef3e1',
    fee: '0.01908720',
    change: '-0.0190872',
    cashFlow: '0',
    transactionTime: '1672121182224',
    type: 'TRADE',
    feeRate: '0.0006',
    bonusChange: '-0.1430544',
    size: '100',
    qty: '88',
    cashBalance: '5086.56192602',
    currency: 'USDT',
    category: 'linear',
    tradePrice: '0.3615',
    tradeId: '5184f079-88ec-54c7-8774-5173cafd2b4e',
    extraFees: '',
  },
  {
    transSubType: '',
    id: '592324_XRPUSDT_161407743011',
    symbol: 'XRPUSDT',
    side: 'Buy',
    funding: '',
    orderLinkId: 'linear-order',
    orderId: '592b7e41-78fd-42e2-9aa3-91e1835ef3e1',
    fee: '0.00260280',
    change: '-0.0026028',
    cashFlow: '0',
    transactionTime: '1672121182224',
    type: 'TRADE',
    feeRate: '0.0006',
    bonusChange: '',
    size: '12',
    qty: '12',
    cashBalance: '5086.58101322',
    currency: 'USDT',
    category: 'linear',
    tradePrice: '0.3615',
    tradeId: '8569c10f-5061-5891-81c4-a54929847eb3',
    extraFees: '',
  },
];

export const SPOT_TRADE_ID = '5184f079-88ec-54c7-8774-5173cafd2b4e';

/**
 * A spot TRADE row, BUILT on the field words of the page's TRADE sample and never read from a live
 * answer (no page shows a spot row): 0.003 BTC bought, with a fee of 0.000003 BTC inside the
 * change, so `change + fee = qty`. `userId`, `orderLinkId` and `extInfo` hold a sentinel: the
 * client must read none of them (the page lists no `userId` and no `extInfo` on this route).
 */
export const spotLogRow = (overrides: Record<string, unknown> = {}) => ({
  ...LOG_PAGE_SAMPLE[1],
  symbol: 'BTCUSDT',
  currency: 'BTC',
  category: 'spot',
  qty: '0.003',
  fee: '0.000003',
  change: '0.002997',
  tradeId: SPOT_TRADE_ID,
  orderLinkId: NEVER_READ,
  userId: NEVER_READ,
  extInfo: { paramType: NEVER_READ, paramValue: NEVER_READ },
  ...overrides,
});

// The convert page's two sample rows, as the page prints them (response example read 2026-11-06).
export const CONVERT_PAGE_SAMPLE = [
  {
    accountType: 'eb_convert_funding',
    exchangeTxId: '10100108106409343501030232064',
    userId: 'XXXXX',
    fromCoin: 'ETH',
    fromCoinType: 'crypto',
    fromAmount: '0.1',
    toCoin: 'BTC',
    toCoinType: 'crypto',
    toAmount: '0.00534882723991',
    exchangeStatus: 'success',
    extInfo: { paramType: 'opFrom', paramValue: 'broker-id-001' },
    convertRate: '0.0534882723991',
    createdAt: '1720071899995',
  },
  {
    accountType: 'eb_convert_uta',
    exchangeTxId: '23070eb_convert_uta408933875189391360',
    userId: 'XXXXX',
    fromCoin: 'BTC',
    fromCoinType: 'crypto',
    fromAmount: '0.1',
    toCoin: 'ETH',
    toCoinType: 'crypto',
    toAmount: '1.773938248611074',
    exchangeStatus: 'success',
    extInfo: {},
    convertRate: '17.73938248611074',
    createdAt: '1719974243256',
  },
];

/** The UTA convert of the page's sample, with the fields the client must never read set apart. */
export const convertRow = (overrides: Record<string, unknown> = {}) => ({
  ...CONVERT_PAGE_SAMPLE[1],
  userId: NEVER_READ,
  extInfo: { paramType: NEVER_READ, paramValue: NEVER_READ },
  convertRate: NEVER_READ,
  fromCoinType: NEVER_READ,
  toCoinType: NEVER_READ,
  ...overrides,
});

/** A settled convert row of the sample, created at `time`, with the id `transactionId`. */
export const convertAt = (
  time: number,
  overrides: Record<string, unknown> = {},
  transactionId = `convert-${time}`,
) => convertRow({ exchangeTxId: transactionId, createdAt: String(time), ...overrides });

/** A row without one of its fields: an absent field is no `undefined` value of that field. */
export const withoutField = (row: Record<string, unknown>, field: string) =>
  Object.fromEntries(Object.entries(row).filter(([name]) => name !== field));

/** A convert row that cannot be read: it names no transaction. */
export const convertWithoutId = (time: number) => withoutField(convertAt(time), 'exchangeTxId');

/** A fetch that answers one page of the route's list, with the cursor the page names. */
export const pageAnswer = (field: 'rows' | 'list', list: unknown, nextPageCursor: unknown = '') =>
  answerWith({ body: envelopeOf(0, { [field]: list, nextPageCursor }) });

/** The options every history read of these tests passes: the answer and a fixed clock. */
export const optionsOf = (fetchImpl: typeof fetch) => ({ fetchImpl, now: () => NOW });
