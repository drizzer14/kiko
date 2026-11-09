import path from 'node:path';
import { readFileSync } from 'node:fs';
import { BYBIT_API_ENDPOINT } from '@env';

import { BYBIT_SIGNED_PATHS } from './bybit.endpoints';

type PolicyLanguage = 'english' | 'ukrainian';

type Phrase = {
  english: string;
  ukrainian: string;
  paths: readonly string[];
};

// The shipped kind set is "E2 and E4": Earn is not read, so the balance list names two wallets
// and no Earn product.
const PHRASES: readonly Phrase[] = [
  {
    english:
      'details of the key itself (whether it is read-only, whether it belongs to your main account, and when it ends)',
    ukrainian:
      'дані самого ключа (чи він лише для читання, чи належить вашому основному акаунту й коли завершується його дія)',
    paths: ['/v5/user/query-api'],
  },
  {
    english: 'balances of every coin and fiat currency (Unified, Funding)',
    ukrainian: 'баланси всіх монет і фіатних валют (Unified, Funding)',
    paths: ['/v5/account/wallet-balance', '/v5/asset/transfer/query-account-coins-balance'],
  },
  {
    english: 'your deposit history',
    ukrainian: 'історія ваших поповнень',
    paths: ['/v5/asset/deposit/query-record'],
  },
  {
    english: 'including deposits sent by another Bybit user',
    ukrainian: 'зокрема від іншого користувача Bybit',
    paths: ['/v5/asset/deposit/query-internal-record'],
  },
  {
    english: 'your withdrawal history',
    ukrainian: 'історія виведень',
    paths: ['/v5/asset/withdraw/query-record'],
  },
  {
    english: 'your transfers between your Bybit wallets',
    ukrainian: 'перекази між гаманцями Bybit',
    paths: ['/v5/asset/transfer/query-inter-transfer-list'],
  },
  {
    english: "your Unified account's transaction log, from which Kiko imports spot trades",
    ukrainian: 'журнал операцій вашого акаунта Unified, з якого Кіко імпортує спотові угоди',
    paths: ['/v5/account/transaction-log'],
  },
  {
    english: 'your convert history',
    ukrainian: 'історія ваших конвертацій',
    paths: ['/v5/asset/exchange/query-convert-history'],
  },
  {
    english: "your Funding wallet's transaction record",
    ukrainian: 'журнал операцій вашого гаманця Funding',
    paths: ['/v5/asset/fundinghistory'],
  },
];

const CALLED_PATHS: readonly string[] = BYBIT_SIGNED_PATHS;

const COUNTERPARTY_TEXT = {
  english:
    "Bybit's answers can include your Bybit user ID and the sender's or recipient's address, email, phone number or Bybit user ID.",
  ukrainian:
    'Відповіді Bybit можуть містити ваш ID користувача Bybit, а також адресу, email, номер телефону чи ID користувача Bybit відправника або отримувача.',
} as const;

// "Does not keep" carries its one exception, named at the end of the entry.
const DOES_NOT_KEEP = {
  english:
    'They reach only your device, and Kiko does not keep those details, with one exception named at the end of this entry.',
  ukrainian:
    'Вони надходять лише на ваш пристрій, і Кіко цих даних не зберігає, за одним винятком, названим наприкінці цього пункту.',
} as const;

const KEPT_PHRASES = {
  english: [
    'the tickers of coins it does not track or could not read, the wallets it left out, the kinds of log entries it did not import, the date your key ends',
    "each convert it could not import, Bybit's IDs of that record and its order, which can hold your account number",
    "its coin, direction, amount, fee, tax, time, kind of move and Bybit's ID, also for one that Kiko does not list",
  ],
  ukrainian: [
    'тікери монет, які не відстежує або не зміг прочитати, гаманці, які він не врахував, види записів журналу, які він не імпортував, дату завершення дії ключа',
    'та в кожній конвертації, яку він не зміг імпортувати, ID цього запису й замовлення в Bybit, де може бути номер вашого акаунта',
    'монету, напрям, суму, комісію, податок, час, вид руху та ID у Bybit, також для руху, який Кіко не показує',
  ],
} as const;

const INTRO = {
  english: 'Binance account data, Bybit account data, Blockstream',
  ukrainian: 'дані облікового запису Binance, дані облікового запису Bybit, Blockstream',
} as const;

// A phrase never spans the `.kiko` code span, which the built page tags and the markdown does not.
const EXCEPTION = {
  english: [
    'from your own Bybit user ID, Kiko makes a value and keeps it on your device and in a',
    'so that it can refuse a key of another Bybit account while an account in Kiko still has holdings from the first',
    'The value is not the ID itself, but the ID is a short number: anyone who can read the value, for example from a',
    'export and its key, can find your ID with a script',
    'A later read of a key replaces the value, and deleting that account in Kiko deletes it.',
  ],
  ukrainian: [
    'із вашого власного ID користувача Bybit Кіко створює значення й зберігає його на вашому пристрої та в експорті',
    'щоб відхилити ключ іншого акаунта Bybit, поки рахунок у Кіко ще містить активи першого',
    'Це значення не є самим ID, але ID — коротке число: будь-хто, хто може прочитати це значення, наприклад з експорту',
    'і його ключа, може знайти ваш ID за допомогою скрипта',
    'Пізніше читання ключа замінює це значення, а видалення цього рахунку в Кіко видаляє його.',
  ],
} as const;

const EARN_WORDS = ['Earn', 'Flexible Savings'];

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

// The entry runs from its bold name to the next entry's, in the markdown and in the built page.
const bybitEntryOf = (text: string): string => {
  const section = sectionThreeOf(text);
  const start = section.search(/Bybit(?:\*\*|<\/strong>) \(/);
  const end = section.search(/Blockstream(?:\*\*|<\/strong>) \(/);

  return section.slice(start, end);
};

// The entry's start: its bold name and host, as the markdown and the built page write them.
const entryLabelOf = (name: string, host: string, isHtml: boolean): string =>
  isHtml ? `<strong>${name}</strong> (<code>${host}</code>) — ` : `**${name}** (\`${host}\`) — `;

const entryStartingAt = (text: string, name: string): string => {
  const section = sectionThreeOf(text);

  return section.slice(
    section.search(new RegExp(`(?:\\*\\*|<strong>)${name}(?:\\*\\*|</strong>) \\(`)),
  );
};

describe('the label of a provider entry of section 3 of the privacy policy', () => {
  it.each(POLICY_FILES)(
    'the Bybit entry starts with its name and host, then " — ", as the Monobank and Binance entries do, in %s',
    (file, _language, text) => {
      const isHtml = file.endsWith('.html');

      expect(
        entryStartingAt(text, 'Binance').startsWith(
          entryLabelOf('Binance', 'api.binance.com', isHtml),
        ),
      ).toBe(true);
      expect(
        entryStartingAt(text, 'Bybit').startsWith(entryLabelOf('Bybit', 'api.bybit.com', isHtml)),
      ).toBe(true);
    },
  );
});

describe('the Bybit paths the app calls and section 3 of the privacy policy', () => {
  it.each(POLICY_FILES)(
    'names every Bybit path the app calls in section 3 of %s',
    (_file, language, text) => {
      const section = sectionThreeOf(text);

      expect(section).toContain(new URL(BYBIT_API_ENDPOINT).host);

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

  it.each(POLICY_FILES)(
    'names no Earn product in the Bybit entry of %s',
    (_file, _language, text) => {
      const entry = bybitEntryOf(text);

      expect(entry).toContain('Bybit');
      expect(EARN_WORDS.filter((word) => entry.includes(word))).toEqual([]);
    },
  );
});

describe('the rest of the Bybit entry of the privacy policy', () => {
  it.each(POLICY_FILES)(
    'the section 3 intro names Bybit, the counterparty text names the Bybit user ID and says it does not keep with one exception, and the kept ids name a refused convert and the kept Funding fields name fee and tax, in %s',
    (_file, language, text) => {
      const entry = bybitEntryOf(text);

      expect(sectionThreeOf(text)).toContain(INTRO[language]);
      expect(entry).toContain(COUNTERPARTY_TEXT[language]);
      expect(entry).toContain(DOES_NOT_KEEP[language]);
      expect(KEPT_PHRASES[language].filter((phrase) => !entry.includes(phrase))).toEqual([]);
    },
  );

  it.each(POLICY_FILES)(
    'the policy names the value made from the user id, and says that a script can find the id, in %s',
    (_file, language, text) => {
      const entry = bybitEntryOf(text);

      expect(EXCEPTION[language].filter((phrase) => !entry.includes(phrase))).toEqual([]);
    },
  );

  it.each(POLICY_FILES)(
    'ends the Bybit entry with the exception, after the Funding fields, in %s',
    (_file, language, text) => {
      const entry = bybitEntryOf(text);
      const closing = EXCEPTION[language][4];
      const closingEnd = entry.indexOf(closing) + closing.length;

      expect(entry.indexOf(closing)).toBeGreaterThan(entry.indexOf(KEPT_PHRASES[language][2]));
      expect(entry.slice(closingEnd).replace(/<[^>]*>|[-*\s]/g, '')).toBe('');
    },
  );
});
