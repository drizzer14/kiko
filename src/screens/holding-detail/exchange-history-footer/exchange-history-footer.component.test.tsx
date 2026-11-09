import { act, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';

import ExchangeHistoryFooter from './exchange-history-footer.component';
import type { ExchangeHistoryFooterProps } from './exchange-history-footer.props';

type Holding = ExchangeHistoryFooterProps['holding'];

const binanceAccount = { institution: 'binance' };

const holdingOf = (currency: Holding['currency'], balanceMinorUnits: number): Holding => ({
  currency,
  balanceMinorUnits,
  metadata: { binanceAsset: currency },
});

const rowsOf = (...amounts: number[]) => amounts.map((amountMinorUnits) => ({ amountMinorUnits }));

const EARLIER_HISTORY = /^Earlier history:/;
const NOT_LISTED = /^Not listed:/;

const EN_NOTE =
  'Not listed: futures, margin and options trades; Binance Card and gift card spending; Auto-Invest; loans; ETH and SOL staking; mining; NFTs; copy trading; Dual Investment; sub-accounts; distributions other than Simple Earn rewards; P2P sales and P2P orders you placed as an advertiser; trades of coins sold before this version that Kiko saw nowhere else; and records older than Binance keeps. Binance does not say which wallet P2P and fiat operations use: Kiko shows P2P orders on Funding and fiat operations on Spot.';

const UK_NOTE =
  'Не показано: угоди з фʼючерсами, маржею та опціонами; витрати з Binance Card і подарункових карток; Auto-Invest; позики; стейкінг ETH і SOL; майнінг; NFT; копітрейдинг; Dual Investment; субакаунти; розподіли, крім винагород Simple Earn; продажі P2P і замовлення P2P, які ви розмістили у ролі рекламодавця; угоди з монетами, які ви продали до цієї версії і які Кіко більше ніде не бачив; записи, старіші за ті, що зберігає Binance. Binance не вказує гаманець для операцій P2P і фіатних операцій: Кіко показує замовлення P2P на Funding, а фіатні операції — на Spot.';

const EN_BYBIT_NOTE =
  "Not listed: interest, bonuses, airdrops and other Unified log entries that are not spot trades; converts made on the website or in the app before 10 September 2025; Earn orders and yield; P2P orders, which Bybit's API opens only to advertisers; derivatives profit and loss; loans; sub-accounts; and records older than two years. Earn is not read, so money there is not in your balance. Bybit's deposit and withdrawal records do not say which wallet they used, so Kiko lists them all on Funding. Your current balances are not affected. Deposit and withdrawal amounts are as Bybit reports them, with no separate fee line. A spot trade's amount already holds its fee. A Funding wallet move is one no other Bybit record explains; it does not count as spending, and one that looks like a record Kiko already has stays out. Kiko does not support Bybit EU accounts, and a key from another regional site may not be accepted.";

const UK_BYBIT_NOTE =
  'Не показано: відсотки, бонуси, аірдропи й інші записи журналу Unified, крім спотових угод; конвертації на сайті чи в застосунку до 10 вересня 2025 року; замовлення й дохід Earn; замовлення P2P, бо API Bybit відкритий для них лише рекламодавцям; прибуток і збитки деривативів; позики; субакаунти; записи, старіші за два роки. Він не читає Earn, тож кошти там не входять до вашого балансу. Записи Bybit про поповнення й виведення не вказують, який гаманець використано, тож Кіко показує їх усі на Funding. Це не впливає на ваші поточні баланси. Суми поповнень і виведень показано так, як їх повідомляє Bybit, без окремого рядка комісії. Сума спотової угоди вже містить її комісію. Рух коштів у гаманці Funding — це запис, якого не пояснює жоден інший запис Bybit; він не рахується як витрата, а рух, схожий на вже наявний запис, Кіко не показує. Кіко не підтримує акаунти Bybit EU, а ключ з іншого регіонального сайту може не підійти.';

describe('ExchangeHistoryFooter', () => {
  it.each([
    ['BTC', 1_234_567_891, [1_000_000_000, 234_567_000], 891],
    ['ETH', 30_000_001, [10_000_000, 20_000_000], 1],
    ['USDT', 12_345_678, [5_000_000, 7_000_000, 345_000], 678],
  ] as const)(
    "sums the rows exactly at the coin's scale: %s",
    async (currency, balance, amounts, earlier) => {
      const { getByText } = await render(
        <ExchangeHistoryFooter
          holding={holdingOf(currency, balance)}
          account={binanceAccount}
          transactions={rowsOf(...amounts)}
        />,
      );

      expect(getByText(EARLIER_HISTORY)).toHaveTextContent(
        `Earlier history: ${formatMoney(Money.of(currency, earlier))}`,
      );
    },
  );

  it('writes the earlier history of a BTC holding at eight decimals', async () => {
    const { getByText } = await render(
      <ExchangeHistoryFooter
        holding={holdingOf('BTC', 1_234_567_891)}
        account={binanceAccount}
        transactions={rowsOf(1_000_000_000, 234_567_000)}
      />,
    );

    expect(getByText(EARLIER_HISTORY)).toHaveTextContent('Earlier history: ₿0.00000891');
  });

  it('shows a negative earlier history when the rows exceed the balance', async () => {
    const { getByText } = await render(
      <ExchangeHistoryFooter
        holding={holdingOf('BTC', 100_000_000)}
        account={binanceAccount}
        transactions={rowsOf(150_000_000, -20_000_000)}
      />,
    );

    expect(getByText(EARLIER_HISTORY)).toHaveTextContent('Earlier history: -₿0.30');
  });

  it('shows only the note when the rows sum to the balance', async () => {
    const { getByText, queryByText } = await render(
      <ExchangeHistoryFooter
        holding={holdingOf('BTC', 100_000_000)}
        account={binanceAccount}
        transactions={rowsOf(60_000_000, 40_000_000)}
      />,
    );

    expect(queryByText(EARLIER_HISTORY)).toBeNull();
    expect(getByText(NOT_LISTED)).toHaveTextContent(EN_NOTE);
  });

  it('shows the whole balance as earlier history when the holding has no row', async () => {
    const { getByText } = await render(
      <ExchangeHistoryFooter
        holding={holdingOf('BTC', 5_000_000)}
        account={binanceAccount}
        transactions={[]}
      />,
    );

    expect(getByText(EARLIER_HISTORY)).toHaveTextContent('Earlier history: ₿0.05');
  });

  it.each([
    ['a holding of a Bitcoin wallet', { institution: 'btc_wallet' }, { walletAddress: 'bc1q' }],
    ['a holding of a disconnected account', { institution: null }, { binanceAsset: 'BTC' }],
    ['a holding with no account', undefined, { binanceAsset: 'BTC' }],
    ['a holding of no sync key', binanceAccount, {}],
    ['a wallet holding on a Binance account', binanceAccount, { walletAddress: 'bc1q' }],
  ])('renders nothing for %s', async (_state, account, metadata) => {
    const { toJSON } = await render(
      <ExchangeHistoryFooter
        holding={{ ...holdingOf('BTC', 100_000_000), metadata }}
        account={account}
        transactions={rowsOf(1)}
      />,
    );

    expect(toJSON()).toBeNull();
  });
});

describe('ExchangeHistoryFooter on a Bybit holding', () => {
  const bybitAccount = { institution: 'bybit' };
  const bybitHolding = (balanceMinorUnits: number): Holding => ({
    currency: 'BTC',
    balanceMinorUnits,
    metadata: { bybitAsset: 'BTC' },
  });

  it('a Bybit holding shows no earlier history line; a Binance holding keeps it', async () => {
    const bybit = await render(
      <ExchangeHistoryFooter
        holding={bybitHolding(1_234_567_891)}
        account={bybitAccount}
        transactions={rowsOf(1_000_000_000, 234_567_000)}
      />,
    );

    expect(bybit.queryByText(EARLIER_HISTORY)).toBeNull();
    expect(bybit.getByText(NOT_LISTED)).toBeTruthy();

    const binance = await render(
      <ExchangeHistoryFooter
        holding={holdingOf('BTC', 1_234_567_891)}
        account={binanceAccount}
        transactions={rowsOf(1_000_000_000, 234_567_000)}
      />,
    );

    expect(binance.getByText(EARLIER_HISTORY)).toHaveTextContent('Earlier history: ₿0.00000891');
  });

  it('shows no earlier history line for a Bybit holding whose rows exceed its balance', async () => {
    const { queryByText } = await render(
      <ExchangeHistoryFooter
        holding={bybitHolding(100_000_000)}
        account={bybitAccount}
        transactions={rowsOf(150_000_000)}
      />,
    );

    expect(queryByText(EARLIER_HISTORY)).toBeNull();
  });

  it('writes the Bybit note under the holding', async () => {
    const { getByText } = await render(
      <ExchangeHistoryFooter
        holding={bybitHolding(100_000_000)}
        account={bybitAccount}
        transactions={rowsOf(100_000_000)}
      />,
    );

    expect(getByText(NOT_LISTED)).toHaveTextContent(EN_BYBIT_NOTE);
  });

  it.each([
    ['holds the Bybit EU sentence', /Kiko does not support Bybit EU accounts/],
    ['holds clause F2', /A spot trade's amount already holds its fee\./],
    ['holds clause F3', /A Funding wallet move is one no other Bybit record explains/],
    ['names the two-year limit', /records older than two years/],
  ])('the Bybit note %s', async (_label, pattern) => {
    const { getByText } = await render(
      <ExchangeHistoryFooter
        holding={bybitHolding(100_000_000)}
        account={bybitAccount}
        transactions={rowsOf(100_000_000)}
      />,
    );

    expect(getByText(NOT_LISTED)).toHaveTextContent(pattern);
  });
});

describe('ExchangeHistoryFooter on a Bybit holding in Ukrainian', () => {
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

  it('reads the Bybit note in Ukrainian', async () => {
    const { getByText } = await render(
      <ExchangeHistoryFooter
        holding={{ currency: 'BTC', balanceMinorUnits: 1, metadata: { bybitAsset: 'BTC' } }}
        account={{ institution: 'bybit' }}
        transactions={rowsOf(1)}
      />,
    );

    expect(getByText(/^Не показано:/)).toHaveTextContent(UK_BYBIT_NOTE);
  });
});

describe('ExchangeHistoryFooter in Ukrainian', () => {
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

  it('reads the line and the note in Ukrainian', async () => {
    const { getByText } = await render(
      <ExchangeHistoryFooter
        holding={holdingOf('BTC', 1_234_567_891)}
        account={binanceAccount}
        transactions={rowsOf(1_000_000_000, 234_567_000)}
      />,
    );

    expect(getByText(/^Попередня історія:/)).toHaveTextContent('Попередня історія: ₿0,00000891');
    expect(getByText(/^Не показано:/)).toHaveTextContent(UK_NOTE);
  });
});
