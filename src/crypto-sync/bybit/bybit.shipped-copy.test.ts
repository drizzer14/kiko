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
