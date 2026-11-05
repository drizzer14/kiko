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
