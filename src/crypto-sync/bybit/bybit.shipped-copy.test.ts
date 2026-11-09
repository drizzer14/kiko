import { en, uk } from '@kiko/i18n/locales';

import { BYBIT_LOG_TYPES, kindOfLogRow } from './bybit.log-types';

// The Bybit texts that name a route for the user, and the coin notes that say what a first sync
// leaves out.
const ENDED_KEYS = ['bybitKeyEnded', 'bybitKeyRefusedExpired'] as const;

describe('the Bybit copy', () => {
  it.each(ENDED_KEYS)(
    'the ended and refused texts give both the renewal and the new-key route, in en and uk: %s',
    (key) => {
      expect(en.accountDetail[key]).toMatch(/renew it on Bybit/);
      expect(en.accountDetail[key]).toMatch(/If Bybit offers no renewal, create a new key/);
      expect(en.accountDetail[key]).toMatch(/disconnect and connect again/);
      expect(uk.accountDetail[key]).toMatch(/подовжити/);
      expect(uk.accountDetail[key]).toMatch(
        /Якщо Bybit не пропонує подовження, створіть новий ключ/,
      );
      expect(uk.accountDetail[key]).toMatch(/відключіть і підключіть Bybit знову/);
    },
  );

  it('the ended and refused texts say the key and secret stay the same after a renewal', () => {
    expect(en.accountDetail.bybitKeyEnded).toMatch(/the key then stays the same/);
    expect(en.accountDetail.bybitKeyRefusedExpired).toMatch(
      /the key and secret then stay the same/,
    );
    expect(uk.accountDetail.bybitKeyEnded).toMatch(/він лишиться той самий/);
    expect(uk.accountDetail.bybitKeyRefusedExpired).toMatch(/ключ і секрет лишаться ті самі/);
  });

  it('the refused-key text names only a deleted key as a cause, in en and uk', () => {
    expect(en.accountDetail.bybitKeyRefused).toBe(
      'Bybit refused this key. If you deleted it, create a new key, then disconnect and connect again.',
    );
    expect(uk.accountDetail.bybitKeyRefused).toBe(
      'Bybit відхилив цей ключ. Якщо ви його видалили, створіть новий ключ, потім відключіть і підключіть Bybit знову.',
    );
  });

  it('the forbidden text gives the longest wait, since a rate refusal waits for less', () => {
    expect(en.accountDetail.bybitForbidden).toMatch(
      /Kiko waits before trying again, up to 10 minutes\.$/,
    );
    expect(uk.accountDetail.bybitForbidden).toMatch(
      /Кіко зачекає, перш ніж спробувати знову, до 10 хвилин\.$/,
    );
  });

  it('the clock text names the iOS switch as the uk Date & Time settings spell it', () => {
    expect(uk.accountDetail.bybitClockOff).toMatch(
      /Увімкніть «Задавати автоматично» в налаштуваннях дати й часу\.$/,
    );
  });

  it('the switch-refused text says the account has holdings from another exchange', () => {
    expect(en.accountDetail.exchangeSwitchRefused).toBe(
      '{{exchange}} cannot connect here because this account still has holdings from another exchange or wallet. Add a new crypto account, or delete those holdings first.',
    );
  });

  it('the 10024 text states the code, in en and uk, and offers no other step', () => {
    expect(en.accountDetail.bybitComplianceRefused).toMatch(/\(code 10024\)/);
    expect(en.accountDetail.bybitComplianceRefused).not.toMatch(
      /\b(try|create|connect|contact|use|switch|change|ask)\b/i,
    );
    expect(uk.accountDetail.bybitComplianceRefused).toMatch(/\(код 10024\)/);
    expect(uk.accountDetail.bybitComplianceRefused).toMatch(/через вимоги регулятора/);
    expect(uk.accountDetail.bybitComplianceRefused).not.toMatch(
      /спробуйте|створіть|підключ|зверніться|використ|змініть/i,
    );
  });

  it('the open-order line says a shown balance is from an earlier sync, and no last balance or amount', () => {
    const { bybitCoinOpenOrder: english } = en.accountDetail;
    const { bybitCoinOpenOrder: ukrainian } = uk.accountDetail;

    expect(english).toMatch(/A balance shown here is from an earlier sync/);
    expect(english).not.toMatch(/last balance/i);
    expect(english).not.toMatch(/\d/);
    expect(english).toMatch(/may hold part of this coin/);
    expect(ukrainian).toMatch(/Баланс, показаний тут, узято з попередньої/);
    expect(ukrainian).not.toMatch(/останн\S* баланс/i);
    expect(ukrainian).not.toMatch(/\d/);
    expect(ukrainian).toMatch(/може тримати частину цієї монети/);
  });

  it('the refused-coin line fits every reason: it claims no import, no amount and no last balance', () => {
    const { bybitCoinRefused: english } = en.accountDetail;
    const { bybitCoinRefused: ukrainian } = uk.accountDetail;

    expect(english).toMatch(/could not read this coin's amounts from Bybit/);
    expect(english).toMatch(/A balance shown here is from an earlier sync/);
    expect(english).not.toMatch(/import|exactly|last balance|\d/i);
    expect(ukrainian).toMatch(/не зміг прочитати суми цієї монети з Bybit/);
    expect(ukrainian).toMatch(/Баланс, показаний тут, узято з попередньої/);
    expect(ukrainian).not.toMatch(/імпорт|точно|останн\S* баланс|\d/i);
  });

  it.each(['bybitCoinBorrowed', 'bybitCoinOpenOrder', 'bybitCoinRefused'] as const)(
    'the %s line says that a coin with no earlier sync is not in the balance',
    (key) => {
      expect(en.accountDetail[key]).toMatch(
        /With no earlier sync, this coin is not in your balance\.$/,
      );
      expect(uk.accountDetail[key]).toMatch(
        /Якщо попередньої синхронізації не було, цієї монети немає у вашому балансі\.$/,
      );
    },
  );

  it('names, in en and uk, every kind of log entry the walk leaves out, and no other', () => {
    const wordsAndStrays = [...BYBIT_LOG_TYPES, 'NOT_ON_THE_PAGE'];
    const leftOut = new Set([
      ...wordsAndStrays.map((word) => kindOfLogRow(word, 'spot')),
      kindOfLogRow('TRADE', 'linear'),
    ]);

    leftOut.delete('spotTrade');
    leftOut.delete('coveredElsewhere');

    expect(Object.keys(en.accountDetail.bybitLogKind).sort()).toEqual([...leftOut].sort());
    expect(Object.keys(uk.accountDetail.bybitLogKind).sort()).toEqual([...leftOut].sort());
  });

  it('the Add an Account help names Bybit among the connect options, en and uk', () => {
    const english = en.help.topics.addAccount.steps[4];
    const ukrainian = uk.help.topics.addAccount.steps[4];

    expect(english).toContain('Bybit');
    expect(english).toContain('Binance');
    expect(english).toBe(
      'Optional: connect Monobank with a token, Binance or Bybit with an API key, or Bitcoin with a wallet address.',
    );
    expect(ukrainian).toContain('Bybit');
    expect(ukrainian).toContain('Binance');
    expect(ukrainian).toBe(
      'За бажанням підключіть Monobank за токеном, Binance чи Bybit за API-ключем або гаманець Bitcoin за адресою.',
    );
  });

  it('the borrowed line does not say a last balance exists', () => {
    expect(en.accountDetail.bybitCoinBorrowed).not.toMatch(/last balance/i);
    expect(en.accountDetail.bybitCoinBorrowed).toMatch(
      /A balance shown here is from an earlier sync/,
    );
    expect(uk.accountDetail.bybitCoinBorrowed).not.toMatch(/останн\S* баланс/i);
    expect(uk.accountDetail.bybitCoinBorrowed).toMatch(
      /Баланс, показаний тут, узято з попередньої/,
    );
  });
});

const catalogues = { en, uk } as const;

type Language = keyof typeof catalogues;

const LANGUAGES = ['en', 'uk'] as const;

const surfacesOf = (language: Language) => {
  const catalogue = catalogues[language];

  return {
    connect: catalogue.accountDetail.bybitConnectLimits,
    dense: catalogue.accountDetail.bybitHistoryDense,
    footer: catalogue.holdingDetail.exchangeNotListed.bybit,
    help: catalogue.help.topics.connectCrypto.steps[4],
    kinds: catalogue.accountDetail.bybitKinds,
    rejected: catalogue.accountDetail.bybitKeyRejected,
    statistics: catalogue.statistics.bybitPastLimits,
  };
};

// One row per kind set. A literal here picks the row, never an app flag: only the row that ships
// has a place in the catalogue, and a mixed Earn result would add a row of its own.
const KIND_SETS = [
  {
    name: 'E2 and E4: no Earn category is read',
    en: {
      readSentence:
        "Kiko reads your balances (Unified, Funding), deposits, including those sent by another Bybit user, withdrawals, transfers between Funding and Unified, spot trades, converts and your Funding wallet's record.",
      unreadSentences:
        'It does not read P2P orders, derivatives or loans. Earn is not read, so money there is not in your balance.',
      footerUnread: [
        'Earn orders and yield',
        'P2P orders',
        'derivatives profit and loss',
        'loans',
        'sub-accounts',
        'records older than two years. Earn is not read, so money there is not in your balance.',
      ],
      gone: /Flexible Savings|On-Chain|other Earn products|Earn products/,
    },
    uk: {
      readSentence:
        'Кіко читає ваші баланси (Unified, Funding), поповнення, зокрема від іншого користувача Bybit, виведення, перекази між Funding і Unified, спотові угоди, конвертації й журнал вашого гаманця Funding.',
      unreadSentences:
        'Він не читає замовлення P2P, деривативи й позики. Він не читає Earn, тож кошти там не входять до вашого балансу.',
      footerUnread: [
        'замовлення й дохід Earn',
        'замовлення P2P',
        'прибуток і збитки деривативів',
        'позики',
        'субакаунти',
        'записи, старіші за два роки. Він не читає Earn, тож кошти там не входять до вашого балансу.',
      ],
      gone: /Flexible Savings|On-Chain|інші продукти Earn|продукти Earn/,
    },
  },
] as const;

describe('the Bybit kinds, footer and help step', () => {
  describe.each(KIND_SETS)('the kind set $name', (kindSet) => {
    it.each(LANGUAGES)(
      'each surface names each shipped kind and each unread kind, and none of the Earn products the row drops, in %s',
      (language) => {
        const { footer, help, kinds } = surfacesOf(language);
        const row = kindSet[language];

        for (const surface of [kinds, help]) {
          expect(surface).toContain(row.readSentence);
          expect(surface).toContain(row.unreadSentences);
        }

        for (const phrase of row.footerUnread) {
          expect(footer).toContain(phrase);
        }

        for (const surface of [kinds, footer, help]) {
          expect(surface).not.toMatch(row.gone);
        }
      },
    );
  });

  it.each(LANGUAGES)('the help step ends with the shipped kinds text, in %s', (language) => {
    const { help, kinds } = surfacesOf(language);

    expect(help.endsWith(` ${kinds}`)).toBe(true);
  });

  it.each([
    ['en', 'does not support Bybit EU accounts', /may not/],
    ['uk', 'не підтримує акаунти Bybit EU', /може не (спрацювати|підійти)/],
  ] as const)(
    'connect, rejected key, footer and help each say Kiko does not support Bybit EU accounts and keep may not for other regional sites, in %s',
    (language, unsupported, maybeNot) => {
      const { connect, footer, help, rejected } = surfacesOf(language);

      for (const surface of [connect, rejected, footer, help]) {
        expect(surface).toContain(unsupported);
        expect(surface).toMatch(maybeNot);
      }
    },
  );

  it.each([
    ['en', 'spot trades, converts', 'Earn yield and stakes, interest, bonuses, loans, stocks'],
    ['uk', 'спотові угоди, конвертації', 'дохід і вклади Earn, відсотки, бонуси, позики, акції'],
  ] as const)(
    'kinds and help name trades and converts as read, and the Statistics line lists the Earn stakes and the other gaps, in %s',
    (language, readPhrase, gapPhrase) => {
      const { help, kinds, statistics } = surfacesOf(language);

      expect(kinds).toContain(readPhrase);
      expect(help).toContain(readPhrase);
      expect(statistics).toContain(gapPhrase);
    },
  );

  it.each([
    [
      'en',
      'loans, stocks, card purchases and rewards, or moves to a sub-account',
      'card spending, sub-account moves',
      'rarely count a move twice',
    ],
    [
      'uk',
      'позики, акції, покупки й винагороди за карткою та перекази на субакаунт',
      'витрати карткою, перекази на субакаунт',
      'зрідка врахувати рух двічі',
    ],
  ] as const)(
    'kinds and the Statistics line state what the past cannot hold and that a move can rarely count twice, in %s',
    (language, kindsGaps, statisticsGaps, rarelyTwice) => {
      const { kinds, statistics } = surfacesOf(language);

      expect(kinds).toContain(kindsGaps);
      expect(statistics).toContain(statisticsGaps);
      expect(kinds).toContain(rarelyTwice);
      expect(statistics).toContain(rarelyTwice);
    },
  );

  it.each([
    [
      'en',
      'A coin Kiko could not read stays on this line at its last read balance, or stays off it with no earlier sync.',
      444,
    ],
    [
      'uk',
      'Монета, яку Кіко не зміг прочитати, лишається на цій лінії з останнім прочитаним балансом, а без попередньої синхронізації її на лінії немає.',
      499,
    ],
  ] as const)(
    'the Statistics line ends with the sentence on a coin not read, at the length of clause L1S, in %s',
    (language, sentence, length) => {
      const { statistics } = surfacesOf(language);

      expect(statistics.endsWith(sentence)).toBe(true);
      expect(statistics).toHaveLength(length);
    },
  );

  it.each([
    ['en', 'Not listed: interest, bonuses, airdrops and other Unified log entries'],
    ['uk', 'Не показано: відсотки, бонуси, аірдропи й інші записи журналу Unified'],
  ] as const)('the footer names what is not listed, in %s', (language, opening) => {
    expect(surfacesOf(language).footer.startsWith(opening)).toBe(true);
  });

  it.each([
    ['en', /can be off by those amounts\.$/, /\b(will|always|every|all|exact\w*)\b/i],
    ['uk', /може відрізнятися на ці суми\.$/, /завжди|усі|точн/i],
  ] as const)(
    'the dense line says the past can be off and makes no promise, in %s',
    (language, canBeOff, promise) => {
      const { dense } = surfacesOf(language);

      expect(dense).toMatch(canBeOff);
      expect(dense).not.toMatch(promise);
    },
  );

  it.each([
    [
      'en',
      "your Funding wallet's record",
      "On Funding, it reads such moves only as far as Bybit's Funding record lists them, and a move that looks like one it already has stays out.",
      'A Funding wallet move is one no other Bybit record explains; it does not count as spending, and one that looks like a record Kiko already has stays out.',
    ],
    [
      'uk',
      'журнал вашого гаманця Funding',
      'У Funding він читає такі рухи лише настільки, наскільки їх показує журнал Funding у Bybit, а рух, схожий на вже наявний запис, не показує.',
      'Рух коштів у гаманці Funding — це запис, якого не пояснює жоден інший запис Bybit; він не рахується як витрата, а рух, схожий на вже наявний запис, Кіко не показує.',
    ],
  ] as const)(
    'kinds, footer and help state the Funding record, what it leaves out and that a move is no spending, in %s',
    (language, record, leavesOut, noSpending) => {
      const { footer, help, kinds } = surfacesOf(language);

      for (const surface of [kinds, help]) {
        expect(surface).toContain(record);
        expect(surface).toContain(leavesOut);
      }

      expect(footer).toContain(noSpending);
    },
  );
});
