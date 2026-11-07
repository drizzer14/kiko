import { act, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { DAY_MS } from '@kiko/dates';
import { i18n } from '@kiko/i18n/init';
import { en } from '@kiko/i18n/locales';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { providerDisplayName } from '@kiko/crypto-sync/provider';

import CryptoSyncSection from './crypto-sync-section.component';

// The section reads the account's own `sync_state` row through one live query; `mockSyncState` is
// what that query answers. The rest of the section's wiring is tested in
// `crypto-sync-section.component.test.tsx`.
let mockSyncState: { data: { exchangeState: string }[]; isLoading: boolean };

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => mockSyncState,
}));
jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: async () => undefined,
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/sync/use-crypto-sync', () => ({
  useCryptoSync: () => ({ isSyncing: false, error: undefined, sync: async () => true }),
}));
jest.mock('@kiko/crypto-sync/disconnect', () => ({
  disconnectCryptoAccount: async () => undefined,
}));
// The section reads the tracked-coin rules through the exchange barrels, which load the
// credentials modules and their react-native-keychain binding, absent under Jest.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

const SYNCED_AT = 1_700_000_000_000;

const accountOf = (institution: string): AccountRow =>
  ({
    id: 'a',
    name: 'Exchange',
    kind: 'crypto',
    institution,
    sortOrder: 0,
    createdAt: 0,
  }) as unknown as AccountRow;

const holdingOf = (institution: string): HoldingRow =>
  ({
    id: 'h1',
    accountId: 'a',
    type: 'crypto_asset',
    currency: 'BTC',
    metadata: {
      [institution === 'bybit' ? 'bybitAsset' : 'binanceAsset']: 'BTC',
      syncedAt: SYNCED_AT,
    },
  }) as unknown as HoldingRow;

const renderState = (institution: string, state: string | Record<string, unknown>) => {
  mockSyncState = {
    data: [
      {
        exchangeState: typeof state === 'string' ? state : JSON.stringify({ version: 1, ...state }),
      },
    ],
    isLoading: false,
  };

  return render(
    <CryptoSyncSection account={accountOf(institution)} holdings={[holdingOf(institution)]} />,
  );
};

// The registry wires no Bybit entry yet, so the name reads as the raw id.
const BYBIT_NAME = providerDisplayName('bybit', i18n.t);

const PENDING_FRAGMENT = 'transaction history is not imported yet';

// What an absence assert hunts comes from its key, so a reword cannot leave it matching nothing.
const LOG_LEFT_OUT_START = i18n
  .t('accountDetail.bybitLogLeftOut', { kinds: '' })
  .replace(': .', '');

const untrackedLine = (tickers: string, exchange: string): string =>
  `Not tracked: ${tickers}. Kiko does not import a currency its ${exchange} sync does not support.`;

const NOW = 1_700_000_000_000;
const RENEW_PHRASE = 'Renew it on Bybit; the key stays the same.';
const KEY_ENDED_FRAGMENT = 'Bybit key ended on';

const expiryLineFragments = [
  'Bybit key ends on',
  'Bybit key ends in',
  KEY_ENDED_FRAGMENT,
  'Kiko could not read when this Bybit key ends',
];

// The tests of the calling suite run in Ukrainian, and English is put back after each.
const inUkrainian = () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });
};

const shownExpiryLines = (queryByText: (text: string, options: { exact: false }) => unknown) =>
  expiryLineFragments.filter((fragment) => queryByText(fragment, { exact: false }) !== null);

describe('the key expiry line of a Bybit account', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['far', { expiredAtMs: Date.UTC(2024, 0, 20, 12) }, 'Bybit key ends on 20.01.2024.'],
    [
      'far, from the days left at the read',
      { deadlineDay: 20, readAtMs: NOW - 2 * DAY_MS },
      'Bybit key ends on 03.12.2023.',
    ],
    [
      'near, 3 days',
      { expiredAtMs: NOW + 3 * DAY_MS - 3_600_000 },
      `Bybit key ends in 3 days. ${RENEW_PHRASE}`,
    ],
    [
      'near, on the 14th day',
      { expiredAtMs: NOW + 14 * DAY_MS },
      `Bybit key ends in 14 days. ${RENEW_PHRASE}`,
    ],
    [
      'near, 1 day',
      { expiredAtMs: NOW + 5 * 3_600_000 },
      `Bybit key ends in 1 day. ${RENEW_PHRASE}`,
    ],
    [
      'expired',
      { expiredAtMs: Date.UTC(2023, 10, 10, 12) },
      'Bybit key ended on 10.11.2023. Balances are as of the last sync. Try to renew it on Bybit: the key then stays the same, so there is nothing to enter here. If Bybit offers no renewal, create a new key, then disconnect and connect again.',
    ],
    [
      'expired, at the instant of the end',
      { expiredAtMs: NOW },
      'Bybit key ended on 15.11.2023. Balances are as of the last sync. Try to renew it on Bybit: the key then stays the same, so there is nothing to enter here. If Bybit offers no renewal, create a new key, then disconnect and connect again.',
    ],
  ])('reads %s from the stored end', async (_title, keyExpiry, line) => {
    const { getByText, queryByText } = await renderState('bybit', { walks: {}, keyExpiry });

    expect(getByText(line)).toBeTruthy();
    expect(shownExpiryLines(queryByText)).toHaveLength(1);
  });

  it('starts the far state one millisecond past the 14th day', async () => {
    const { queryByText } = await renderState('bybit', {
      walks: {},
      keyExpiry: { expiredAtMs: NOW + 14 * DAY_MS + 1 },
    });

    expect(queryByText('Bybit key ends on', { exact: false })).not.toBeNull();
    expect(queryByText('Bybit key ends in', { exact: false })).toBeNull();
  });

  it.each([
    ['no entry', undefined],
    ['an entry with no date', { readAtMs: NOW }],
    ['an end at the epoch with negative days', { expiredAtMs: 0, deadlineDay: -2, readAtMs: NOW }],
    ['an end that is no number', { expiredAtMs: '2099-01-02T03:04:05Z', readAtMs: NOW }],
    ['an entry that is no record', 'x'],
  ])('reads %s as unknown', async (_title, keyExpiry) => {
    const { getByText, queryByText } = await renderState('bybit', { walks: {}, keyExpiry });

    expect(
      getByText(
        'Kiko could not read when this Bybit key ends. A key with no IP restriction lasts about 90 days.',
      ),
    ).toBeTruthy();
    expect(shownExpiryLines(queryByText)).toHaveLength(1);
  });

  it('sits under the last sync line, before the coin lines', async () => {
    const { toJSON } = await renderState('bybit', {
      walks: {},
      keyExpiry: { expiredAtMs: Date.UTC(2024, 0, 20, 12) },
      oversizedCoins: { balance: ['BTC'], history: [] },
    });
    const text = JSON.stringify(toJSON());

    expect(text.indexOf('Last sync')).toBeLessThan(text.indexOf('Bybit key ends on'));
    expect(text.indexOf('Bybit key ends on')).toBeLessThan(text.indexOf('Kiko could not import'));
  });

  it('is not shown while the state row is still loading', async () => {
    mockSyncState = { data: [], isLoading: true };
    const { queryByText } = await render(
      <CryptoSyncSection account={accountOf('bybit')} holdings={[holdingOf('bybit')]} />,
    );

    expect(shownExpiryLines(queryByText)).toEqual([]);
    expect(queryByText('Bybit key', { exact: false })).toBeNull();
  });

  describe('in Ukrainian', () => {
    inUkrainian();

    it.each([
      [1, 'Ключ Bybit діє ще 1 день. Подовжте його на Bybit; ключ лишається той самий.'],
      [2, 'Ключ Bybit діє ще 2 дні. Подовжте його на Bybit; ключ лишається той самий.'],
      [5, 'Ключ Bybit діє ще 5 днів. Подовжте його на Bybit; ключ лишається той самий.'],
      [11, 'Ключ Bybit діє ще 11 днів. Подовжте його на Bybit; ключ лишається той самий.'],
    ])('gives the near state of %i days its plural form', async (days, line) => {
      const { getByText } = await renderState('bybit', {
        walks: {},
        keyExpiry: { expiredAtMs: NOW + days * DAY_MS - 3_600_000 },
      });

      expect(getByText(line)).toBeTruthy();
    });

    it('gives the far, expired and unknown states their Ukrainian lines', async () => {
      const far = await renderState('bybit', {
        walks: {},
        keyExpiry: { expiredAtMs: Date.UTC(2024, 0, 20, 12) },
      });
      const expired = await renderState('bybit', {
        walks: {},
        keyExpiry: { expiredAtMs: Date.UTC(2023, 10, 10, 12) },
      });
      const unknown = await renderState('bybit', { walks: {} });

      expect(far.getByText('Дія ключа Bybit завершується 20.01.2024.')).toBeTruthy();
      expect(
        expired.getByText(i18n.t('accountDetail.bybitKeyEnded', { date: '10.11.2023' })),
      ).toBeTruthy();
      expect(expired.getByText('Дія ключа Bybit завершилася', { exact: false })).toBeTruthy();
      expect(
        unknown.getByText('Кіко не зміг прочитати, коли завершується дія цього ключа Bybit', {
          exact: false,
        }),
      ).toBeTruthy();
    });
  });
});

describe('the notes of a Bybit account', () => {
  it('names the wallet the key was refused for', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {},
      balanceNotes: { fund: { refused: true } },
    });

    expect(
      getByText(
        "Bybit refused this key for Funding, so Kiko did not update that balance. Check the key's permissions on Bybit.",
      ),
    ).toBeTruthy();
  });

  it('names the wallet that was not read, and says its balance is from an earlier sync', async () => {
    const { getByText, queryByText } = await renderState('bybit', {
      walks: {},
      balanceNotes: { unified: {}, fund: { notRead: true } },
    });

    expect(
      getByText(
        'Kiko could not read Funding in the last sync, so it did not update that balance. A balance shown here is from an earlier sync. With no earlier sync, money there is not in your balance.',
      ),
    ).toBeTruthy();
    expect(queryByText('Bybit refused this key', { exact: false })).toBeNull();
  });

  it('names a wallet this build does not know by its key, apart from one the key was refused for', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {},
      balanceNotes: { margin: { notRead: true }, fund: { refused: true } },
    });

    expect(getByText('Kiko could not read margin in the last sync', { exact: false })).toBeTruthy();
    expect(getByText('Bybit refused this key for Funding', { exact: false })).toBeTruthy();
  });

  it.each([
    [
      'set aside for a loan',
      { borrowed: ['BTC', 'ETH'] },
      'Bybit shows a loan against this coin, so Kiko does not read its balance. A balance shown here is from an earlier sync. With no earlier sync, this coin is not in your balance.',
    ],
    [
      'with an open order',
      { openOrder: ['BTC', 'ETH'] },
      'Bybit may hold part of this coin for an open order, so Kiko does not read its balance now. A balance shown here is from an earlier sync. With no earlier sync, this coin is not in your balance.',
    ],
  ])('names the wallet of each coin %s', async (_title, unified, text) => {
    const { getByText, queryAllByText } = await renderState('bybit', {
      walks: {},
      balanceNotes: { unified, fund: {} },
    });
    const line = (coin: string) => `${coin}: ${text}`;

    expect(getByText(line('BTC (Unified)'))).toBeTruthy();
    expect(queryAllByText(line('ETH (Unified)'))).toHaveLength(1);
    expect(queryAllByText(line('ETH'))).toHaveLength(0);
  });

  it('shows one line per wallet for a coin Bybit refused in both, and says its balance is from an earlier sync', async () => {
    const { getByText, queryAllByText } = await renderState('bybit', {
      walks: {},
      balanceNotes: { unified: { refusedCoins: ['BTC', 'ETH'] }, fund: { refusedCoins: ['ETH'] } },
    });
    const line = (coin: string) =>
      `${coin}: Kiko could not read this coin's amounts from Bybit, so it left the coin out. A balance shown here is from an earlier sync. With no earlier sync, this coin is not in your balance.`;

    expect(getByText(line('BTC (Unified)'))).toBeTruthy();
    expect(queryAllByText(line('ETH (Unified)'))).toHaveLength(1);
    expect(queryAllByText(line('ETH (Funding)'))).toHaveLength(1);
  });

  it('names Unified in the line of a coin held for an open order beside a Funding holding of that coin', async () => {
    const { getByText, queryByText } = await renderState('bybit', {
      walks: {},
      balanceNotes: { unified: { openOrder: ['BTC'] }, fund: {} },
    });

    expect(
      getByText('BTC (Unified): Bybit may hold part of this coin', { exact: false }),
    ).toBeTruthy();
    expect(queryByText('BTC: Bybit may hold', { exact: false })).toBeNull();
  });

  it('a coin refused for an empty loan field shows the read text, never the oversized text', async () => {
    const { getByText, queryByText } = await renderState('bybit', {
      walks: {},
      balanceNotes: { unified: { refusedCoins: ['BTC'] }, fund: {} },
    });

    expect(
      getByText("BTC (Unified): Kiko could not read this coin's amounts", { exact: false }),
    ).toBeTruthy();
    expect(queryByText(i18n.t('accountDetail.oversizedAmount', { coin: 'BTC' }))).toBeNull();
    expect(queryByText('could not import an amount exactly', { exact: false })).toBeNull();
  });

  it('shows no note line for a read with nothing to note', async () => {
    const { queryByText } = await renderState('bybit', {
      walks: {},
      balanceNotes: { unified: {}, fund: {} },
    });

    for (const fragment of [
      'Bybit refused this key',
      'Kiko could not read Funding',
      'Kiko could not read Unified',
      'Bybit shows a loan',
      'Bybit may hold part of this coin',
      "Kiko could not read this coin's amounts",
    ]) {
      expect(queryByText(fragment, { exact: false })).toBeNull();
    }
  });

  describe('in Ukrainian', () => {
    inUkrainian();

    it('gives the refused and borrowed lines in Ukrainian', async () => {
      const { getByText } = await renderState('bybit', {
        walks: {},
        balanceNotes: { fund: { refused: true }, unified: { borrowed: ['BTC'] } },
      });

      expect(
        getByText(
          'Bybit не дозволив цьому ключу читати Funding, тож Кіко не оновив цей баланс. Перевірте дозволи ключа на Bybit.',
        ),
      ).toBeTruthy();
      expect(
        getByText('BTC (Unified): Bybit показує позику під цю монету', { exact: false }),
      ).toBeTruthy();
    });

    it('gives the not-read wallet line in Ukrainian, with its first-sync sentence', async () => {
      const { getByText } = await renderState('bybit', {
        walks: {},
        balanceNotes: { fund: { notRead: true } },
      });

      expect(
        getByText(
          'Кіко не зміг прочитати Funding під час останньої синхронізації, тож не оновив цей баланс. Баланс, показаний тут, узято з попередньої синхронізації. Якщо попередньої синхронізації не було, кошти там не входять до вашого балансу.',
        ),
      ).toBeTruthy();
    });

    it('gives the open-order line in Ukrainian, with its first-sync sentence', async () => {
      const { getByText } = await renderState('bybit', {
        walks: {},
        balanceNotes: { unified: { openOrder: ['BTC'] } },
      });

      expect(
        getByText(
          'BTC (Unified): Bybit може тримати частину цієї монети для відкритого замовлення, тож Кіко зараз не читає її баланс. Баланс, показаний тут, узято з попередньої синхронізації. Якщо попередньої синхронізації не було, цієї монети немає у вашому балансі.',
        ),
      ).toBeTruthy();
    });

    it('gives the refused-coin line in Ukrainian, with its first-sync sentence', async () => {
      const { getByText } = await renderState('bybit', {
        walks: {},
        balanceNotes: { unified: { refusedCoins: ['BTC'] } },
      });

      expect(
        getByText(
          'BTC (Unified): Кіко не зміг прочитати суми цієї монети з Bybit, тож не врахував її. Баланс, показаний тут, узято з попередньої синхронізації. Якщо попередньої синхронізації не було, цієї монети немає у вашому балансі.',
        ),
      ).toBeTruthy();
    });
  });
});

describe('the kinds line of a Bybit account', () => {
  it('states what Kiko reads and what it leaves out, with what stays wrong', async () => {
    const { getByText } = await renderState('bybit', { walks: {} });

    expect(getByText(i18n.t('accountDetail.bybitKinds'))).toBeTruthy();
    expect(i18n.t('accountDetail.bybitKinds')).toContain('It does not read P2P orders');
    expect(i18n.t('accountDetail.bybitKinds')).toContain('The past of your net worth can be off');
  });

  it('shows on a state this build cannot read, since it states no stored fact', async () => {
    const { getByText } = await renderState('bybit', '{not json');

    expect(getByText(i18n.t('accountDetail.bybitKinds'))).toBeTruthy();
  });
});

const ALL_LOG_KINDS = [
  'other',
  'custody',
  'stocks',
  'earn',
  'bonuses',
  'interestAndLoans',
  'convertEntries',
  'derivatives',
];

describe('the left-out line of a Bybit account', () => {
  it('names the kinds the log left out, in the order of the closed list, joined by commas', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {},
      logKinds: ['other', 'stocks', 'derivatives'],
    });

    expect(
      getByText('Unified log entries not imported: derivatives, stocks, other entries.'),
    ).toBeTruthy();
  });

  it('gives each of the eight kinds its words', async () => {
    const { getByText } = await renderState('bybit', { walks: {}, logKinds: ALL_LOG_KINDS });

    expect([...ALL_LOG_KINDS].sort()).toEqual(Object.keys(en.accountDetail.bybitLogKind).sort());

    expect(
      getByText(
        'Unified log entries not imported: derivatives, convert and liquidation entries, interest and loans, bonuses and airdrops, Earn moves, stocks, custody entries, other entries.',
      ),
    ).toBeTruthy();
  });

  it('shows no line while the log left out nothing', async () => {
    const { queryByText } = await renderState('bybit', { walks: {}, logKinds: [] });

    expect(queryByText(LOG_LEFT_OUT_START, { exact: false })).toBeNull();
  });

  it('names no kind this build does not know, and no line when it knows none', async () => {
    const mixed = await renderState('bybit', { walks: {}, logKinds: ['mystery', 'earn'] });
    const unknownOnly = await renderState('bybit', { walks: {}, logKinds: ['mystery'] });

    expect(mixed.getByText('Unified log entries not imported: Earn moves.')).toBeTruthy();
    expect(mixed.queryByText('mystery', { exact: false })).toBeNull();
    expect(unknownOnly.queryByText(LOG_LEFT_OUT_START, { exact: false })).toBeNull();
  });

  it('is not shown while the state row is still loading', async () => {
    mockSyncState = {
      data: [{ exchangeState: JSON.stringify({ version: 1, walks: {}, logKinds: ['earn'] }) }],
      isLoading: true,
    };
    const { queryByText } = await render(
      <CryptoSyncSection account={accountOf('bybit')} holdings={[holdingOf('bybit')]} />,
    );

    expect(queryByText(LOG_LEFT_OUT_START, { exact: false })).toBeNull();
  });

  describe('in Ukrainian', () => {
    inUkrainian();

    it('gives the line and each kind in Ukrainian', async () => {
      const some = await renderState('bybit', {
        walks: {},
        logKinds: ['other', 'stocks', 'derivatives'],
      });
      const every = await renderState('bybit', { walks: {}, logKinds: ALL_LOG_KINDS });

      expect(
        some.getByText(
          'Записи журналу Unified, які не імпортовано: деривативи, акції, інші записи.',
        ),
      ).toBeTruthy();
      expect(
        every.getByText(
          'Записи журналу Unified, які не імпортовано: деривативи, записи конвертацій і ліквідацій, відсотки й позики, бонуси й аірдропи, рухи коштів Earn, акції, записи кастоді, інші записи.',
        ),
      ).toBeTruthy();
    });
  });
});

describe('the dense line of a Bybit account', () => {
  const DENSE_START = Date.UTC(2024, 0, 20, 12);
  const DENSE_LINE =
    'Bybit lists too many records within one second on 20.01.2024. Kiko cannot read past them, so later trades or Funding moves stay out, and the past of your net worth can be off by those amounts.';
  const DENSE_LINE_OF_KEY = i18n.t('accountDetail.bybitHistoryDense', { date: '20.01.2024' });

  it('replaces the pending caption while a mark stands, with the date of the mark', async () => {
    const { getByText, queryByText } = await renderState('bybit', {
      walks: {},
      denseSpans: { log: DENSE_START },
    });

    expect(getByText(DENSE_LINE)).toBeTruthy();
    expect(queryByText(PENDING_FRAGMENT, { exact: false })).toBeNull();
  });

  it('shows the pending caption again once the mark is gone', async () => {
    const { getByText, queryByText } = await renderState('bybit', { walks: {}, denseSpans: {} });

    expect(getByText(PENDING_FRAGMENT, { exact: false })).toBeTruthy();
    expect(queryByText(DENSE_LINE_OF_KEY)).toBeNull();
  });

  it('shows once, with the earliest date, for a mark of each series', async () => {
    const { getAllByText } = await renderState('bybit', {
      walks: {},
      denseSpans: { log: DENSE_START + 3 * DAY_MS, fundingLedger: DENSE_START },
    });

    expect(getAllByText(DENSE_LINE)).toHaveLength(1);
  });

  it('shows while the history is not behind, since the mark is a standing fact of the last run', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {
        capital: { cursor: SYNCED_AT },
        transfer: { cursor: SYNCED_AT },
        log: { cursor: SYNCED_AT },
        convert: { cursor: SYNCED_AT, pending: [] },
      },
      denseSpans: { log: DENSE_START },
    });

    expect(getByText(DENSE_LINE)).toBeTruthy();
  });

  it('is not shown while the state row is still loading', async () => {
    mockSyncState = {
      data: [
        {
          exchangeState: JSON.stringify({
            version: 1,
            walks: {},
            denseSpans: { log: DENSE_START },
          }),
        },
      ],
      isLoading: true,
    };
    const { queryByText } = await render(
      <CryptoSyncSection account={accountOf('bybit')} holdings={[holdingOf('bybit')]} />,
    );

    expect(queryByText(DENSE_LINE_OF_KEY)).toBeNull();
  });

  it('keeps the Binance pending caption word for word', async () => {
    const { getByText } = await renderState('binance', { walks: {} });

    expect(
      getByText(
        'Some Binance transaction history is not imported yet. Kiko will keep importing on each sync.',
      ),
    ).toBeTruthy();
  });

  describe('in Ukrainian', () => {
    inUkrainian();

    it('gives the line in Ukrainian', async () => {
      const { getByText } = await renderState('bybit', {
        walks: {},
        denseSpans: { log: DENSE_START },
      });

      expect(
        getByText(
          'Bybit показує забагато записів за одну секунду 20.01.2024. Кіко не може прочитати далі, тож пізніші угоди чи рухи коштів у Funding не показано, а минуле вашого капіталу може відрізнятися на ці суми.',
        ),
      ).toBeTruthy();
    });
  });
});

describe('a Binance or wallet account beside the Bybit lines', () => {
  const bybitFacts = {
    keyExpiry: { expiredAtMs: Date.UTC(2024, 0, 20, 12), readAtMs: NOW },
    balanceNotes: {
      unified: { borrowed: ['BTC'] },
      fund: { refused: true },
    },
    logKinds: ['stocks', 'earn'],
    denseSpans: { log: Date.UTC(2024, 0, 20, 12) },
  };

  it.each(['binance', 'btc_wallet'])(
    'shows %s byte-identical text, whatever Bybit facts its state holds',
    async (institution) => {
      const plain = await renderState(institution, { walks: {} });
      const plainTree = JSON.stringify(plain.toJSON());
      await plain.unmount();

      const withFacts = await renderState(institution, { walks: {}, ...bybitFacts });

      expect(JSON.stringify(withFacts.toJSON())).toBe(plainTree);
      expect(withFacts.queryByText('Bybit', { exact: false })).toBeNull();
    },
  );

  describe('in Ukrainian', () => {
    inUkrainian();

    it('shows Binance no Bybit line either', async () => {
      const { queryByText } = await renderState('binance', { walks: {}, ...bybitFacts });

      expect(queryByText('Bybit', { exact: false })).toBeNull();
    });
  });
});

describe('CryptoSyncSection for a Bybit account', () => {
  it('lists a fiat code outside the five as not tracked, naming the exchange, with no amount', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {},
      untrackedCoins: { balance: ['GBP', 'PEPE'], history: [] },
    });

    expect(getByText(untrackedLine('GBP, PEPE', BYBIT_NAME))).toBeTruthy();
  });

  it('names a coin on the history list alone in the not-tracked line', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {},
      untrackedCoins: { balance: [], history: ['PEPE'] },
    });

    expect(getByText(untrackedLine('PEPE', BYBIT_NAME))).toBeTruthy();
  });

  it('reads the same stored list by the rule of each exchange: Binance quotes GBP, Bybit does not', async () => {
    const lists = { walks: {}, untrackedCoins: { balance: ['GBP', 'PEPE'], history: [] } };
    const binance = await renderState('binance', lists);

    expect(binance.getByText(untrackedLine('PEPE', 'Binance'))).toBeTruthy();
    expect(binance.queryByText('GBP', { exact: false })).toBeNull();
  });

  it('shows the oversized line of a Bybit coin, as the coin lines are shown', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {},
      oversizedCoins: { balance: ['BTC'], history: [] },
    });

    expect(
      getByText('BTC: Kiko could not import an amount exactly, so it was skipped.'),
    ).toBeTruthy();
  });

  it('pauses the history on a state this build cannot read, naming the exchange', async () => {
    const { getByText } = await renderState('bybit', '{not json');

    expect(
      getByText(i18n.t('accountDetail.exchangeHistoryPaused', { exchange: BYBIT_NAME })),
    ).toBeTruthy();
  });

  it('shows the history as behind when the capital walk has no cursor or owes a range, as it does for Binance', async () => {
    const stateWithOwedRange = {
      walks: { capital: { cursor: SYNCED_AT, pending: [{ start: 1, end: 3 }] } },
    };

    for (const state of [{ walks: {} }, stateWithOwedRange]) {
      const binance = await renderState('binance', state);
      const bybit = await renderState('bybit', state);

      expect(binance.getByText(PENDING_FRAGMENT, { exact: false })).toBeTruthy();
      expect(bybit.getByText(PENDING_FRAGMENT, { exact: false })).toBeTruthy();
    }
  });

  it('shows the history as behind for a range owed in one series of the capital walk', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {
        capital: { cursor: SYNCED_AT, pending: [{ start: 1, end: 3, series: 'deposit' }] },
      },
    });

    expect(getByText(PENDING_FRAGMENT, { exact: false })).toBeTruthy();
  });

  it('never shows the history as behind on the ground of a walk Bybit does not read', async () => {
    const state = {
      walks: {
        capital: { cursor: SYNCED_AT },
        transfer: { cursor: SYNCED_AT },
        log: { cursor: SYNCED_AT },
        convert: { cursor: SYNCED_AT },
        pay: { pending: [{ start: 1, end: 3 }] },
      },
    };

    const binance = await renderState('binance', state);
    const bybit = await renderState('bybit', state);

    expect(binance.getByText(PENDING_FRAGMENT, { exact: false })).toBeTruthy();
    expect(bybit.queryByText(PENDING_FRAGMENT, { exact: false })).toBeNull();
  });

  it('shows the history as behind while the convert walk has not ended a pass', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {
        capital: { cursor: SYNCED_AT },
        transfer: { cursor: SYNCED_AT },
        log: { cursor: SYNCED_AT },
      },
    });

    expect(getByText(PENDING_FRAGMENT, { exact: false })).toBeTruthy();
  });

  describe('in Ukrainian', () => {
    inUkrainian();

    it('names the exchange in the not-tracked line', async () => {
      const { getByText } = await renderState('bybit', {
        walks: {},
        untrackedCoins: { balance: ['GBP'], history: [] },
      });

      expect(
        getByText(
          `Не відстежуються: GBP. Кіко не імпортує валюту, яку не підтримує синхронізація ${BYBIT_NAME}.`,
        ),
      ).toBeTruthy();
    });

    it('keeps the Binance line byte-identical', async () => {
      const { getByText } = await renderState('binance', {
        walks: {},
        untrackedCoins: { balance: ['PEPE'], history: [] },
      });

      expect(
        getByText(
          'Не відстежуються: PEPE. Кіко не імпортує валюту, яку не підтримує синхронізація Binance.',
        ),
      ).toBeTruthy();
    });
  });
});
