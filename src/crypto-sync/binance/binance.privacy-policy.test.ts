import path from 'node:path';
import { readFileSync } from 'node:fs';

import { BINANCE_PUBLIC_PATHS, BINANCE_SIGNED_PATHS } from './binance.endpoints';

type PolicyLanguage = 'english' | 'ukrainian';

type Phrase = {
  english: string;
  ukrainian: string;
  paths: readonly string[];
};

const PHRASES: readonly Phrase[] = [
  {
    english: 'balances of every coin and fiat currency',
    ukrainian: 'баланси всіх монет і фіатних валют',
    paths: [
      '/api/v3/account',
      '/sapi/v1/asset/get-funding-asset',
      '/sapi/v1/simple-earn/flexible/position',
      '/sapi/v1/simple-earn/locked/position',
    ],
  },
  {
    english: 'deposit and withdrawal history',
    ukrainian: 'історія ваших поповнень і виведень',
    paths: ['/sapi/v1/capital/deposit/hisrec', '/sapi/v1/capital/withdraw/history'],
  },
  {
    english: 'Binance Pay history',
    ukrainian: 'історія Binance Pay',
    paths: ['/sapi/v1/pay/transactions'],
  },
  {
    english: 'transfers between your Binance wallets',
    ukrainian: 'перекази між гаманцями Binance',
    paths: ['/sapi/v1/asset/transfer'],
  },
  {
    english: 'Simple Earn subscriptions, redemptions and rewards',
    ukrainian: 'підписки, погашення й винагороди Simple Earn',
    paths: [
      '/sapi/v1/simple-earn/flexible/history/subscriptionRecord',
      '/sapi/v1/simple-earn/flexible/history/redemptionRecord',
      '/sapi/v1/simple-earn/flexible/history/rewardsRecord',
      '/sapi/v1/simple-earn/locked/history/subscriptionRecord',
      '/sapi/v1/simple-earn/locked/history/redemptionRecord',
      '/sapi/v1/simple-earn/locked/history/rewardsRecord',
    ],
  },
  {
    english: 'Spot trade history',
    ukrainian: 'історія ваших угод Spot',
    paths: ['/api/v3/myTrades'],
  },
  {
    english: 'Convert history',
    ukrainian: 'історія Convert',
    paths: ['/sapi/v1/convert/tradeFlow'],
  },
  {
    english: 'conversions of small balances to BNB',
    ukrainian: 'обміни малих залишків на BNB',
    paths: ['/sapi/v1/asset/dribblet'],
  },
  {
    english: 'P2P orders',
    ukrainian: 'замовлення P2P',
    paths: ['/sapi/v1/c2c/orderMatch/listUserOrderHistory'],
  },
  {
    english: 'fiat deposits and withdrawals',
    ukrainian: 'фіатні поповнення й виведення',
    paths: ['/sapi/v1/fiat/orders'],
  },
  {
    english: 'card purchases and sales',
    ukrainian: 'купівлі й продажі карткою',
    paths: ['/sapi/v1/fiat/payments'],
  },
  {
    english: 'public list of markets',
    ukrainian: 'публічний список ринків',
    paths: ['/api/v3/exchangeInfo'],
  },
  {
    english: 'public market prices',
    ukrainian: 'публічні ринкові ціни',
    paths: ['/api/v3/klines'],
  },
];

const CALLED_PATHS: readonly string[] = [...BINANCE_SIGNED_PATHS, ...BINANCE_PUBLIC_PATHS];

const ROOT = path.join(__dirname, '../../..');

const POLICY_FILES: readonly (readonly [string, PolicyLanguage, string])[] = [
  [
    'docs/privacy-policy.en.md',
    'english',
    readFileSync(path.join(ROOT, 'docs/privacy-policy.en.md'), 'utf-8'),
  ],
  [
    'docs/privacy-policy.md',
    'ukrainian',
    readFileSync(path.join(ROOT, 'docs/privacy-policy.md'), 'utf-8'),
  ],
  [
    'docs/privacy-site/en.html',
    'english',
    readFileSync(path.join(ROOT, 'docs/privacy-site/en.html'), 'utf-8'),
  ],
  [
    'docs/privacy-site/index.html',
    'ukrainian',
    readFileSync(path.join(ROOT, 'docs/privacy-site/index.html'), 'utf-8'),
  ],
];

// A markdown source wraps its lines and the built page does not, so a phrase is compared with
// every run of whitespace read as one space.
const sectionThreeOf = (text: string): string => {
  const start = text.search(/(?:^## |<h2>)3\. /m);
  const end = text.search(/(?:^## |<h2>)4\. /m);

  return text.slice(start, end).replace(/\s+/g, ' ');
};

describe('the Binance paths the app calls and section 3 of the privacy policy', () => {
  it.each(POLICY_FILES)(
    'names every Binance path the app calls in section 3 of %s',
    (_file, language, text) => {
      const section = sectionThreeOf(text);

      expect(section).toContain('api.binance.com');

      const missing = CALLED_PATHS.flatMap((calledPath) =>
        PHRASES.filter((phrase) => phrase.paths.includes(calledPath))
          .filter((phrase) => !section.includes(phrase[language]))
          .map((phrase) => `${calledPath}: ${phrase[language]}`),
      );

      expect(missing).toEqual([]);
    },
  );

  it('maps every listed path to one phrase', () => {
    const phrasesOf = (calledPath: string): number =>
      PHRASES.filter((phrase) => phrase.paths.includes(calledPath)).length;
    const mappedPaths = PHRASES.flatMap((phrase) => phrase.paths);

    expect(CALLED_PATHS.filter((calledPath) => phrasesOf(calledPath) !== 1)).toEqual([]);
    expect(mappedPaths.filter((mappedPath) => !CALLED_PATHS.includes(mappedPath))).toEqual([]);
  });
});
