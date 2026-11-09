import type { i18n as I18nInstance } from 'i18next';

type InitModule = { i18n: I18nInstance };

const nodePluralRules = Intl.PluralRules;

// Each case needs its own i18next: a warmed-up one has already cached the
// plural rules it built while Node's Intl.PluralRules still existed.
const freshI18n = async (language: string): Promise<I18nInstance> => {
  let init!: InitModule;

  jest.isolateModules(() => {
    init = require('./init');
  });

  await init.i18n.changeLanguage(language);

  return init.i18n;
};

// Hermes on iOS has no Intl.PluralRules. Node has one, so it is removed here
// to resolve plurals the way the device does.
beforeEach(() => {
  Reflect.deleteProperty(Intl, 'PluralRules');
});

afterEach(() => {
  Object.defineProperty(Intl, 'PluralRules', {
    value: nodePluralRules,
    writable: true,
    configurable: true,
  });
});

describe('i18n plurals without Intl.PluralRules', () => {
  it.each([
    [0, 'днів'],
    [1, 'день'],
    [2, 'дні'],
    [4, 'дні'],
    [5, 'днів'],
    [11, 'днів'],
    [14, 'днів'],
    [21, 'день'],
    [22, 'дні'],
    [25, 'днів'],
    [31, 'день'],
    [1.5, 'дня'],
  ])('reads %p in Ukrainian as %p', async (count, days) => {
    const i18n = await freshI18n('uk');

    expect(i18n.t('forms.units.days', { count })).toBe(days);
  });

  it('declines a whole Ukrainian sentence by its count', async () => {
    const i18n = await freshI18n('uk');

    expect(i18n.t('reminders.notification.statementImportBody', { count: 5 })).toBe(
      '5 днів від останнього імпорту виписки.',
    );
  });

  it.each([
    [1, 'Також його буде очищено в 1 шаблоні.'],
    [2, 'Також його буде очищено в 2 шаблонах.'],
    [5, 'Також його буде очищено в 5 шаблонах.'],
    [21, 'Також його буде очищено в 21 шаблоні.'],
    [1.5, 'Також його буде очищено в 1.5 шаблону.'],
  ])('declines the cleared-in-templates sentence for %p', async (count, sentence) => {
    const i18n = await freshI18n('uk');

    expect(i18n.t('holdings.deleteLinked.templates', { count })).toBe(sentence);
  });

  it.each([
    [1, 'Також її буде очищено в 1 шаблоні.'],
    [2, 'Також її буде очищено в 2 шаблонах.'],
    [5, 'Також її буде очищено в 5 шаблонах.'],
    [21, 'Також її буде очищено в 21 шаблоні.'],
    [1.5, 'Також її буде очищено в 1.5 шаблону.'],
  ])('declines the category delete confirm sentence for %p', async (count, sentence) => {
    const i18n = await freshI18n('uk');

    expect(i18n.t('categories.deleteTemplates', { count })).toBe(sentence);
  });

  it.each([
    [0, 'У цій валюті не більше 0 знаків після коми.'],
    [1, 'У цій валюті не більше 1 знака після коми.'],
    [2, 'У цій валюті не більше 2 знаків після коми.'],
    [3, 'У цій валюті не більше 3 знаків після коми.'],
    [5, 'У цій валюті не більше 5 знаків після коми.'],
    [8, 'У цій валюті не більше 8 знаків після коми.'],
    [21, 'У цій валюті не більше 21 знака після коми.'],
  ])('reads the decimals a currency allows, %p, in Ukrainian as %p', async (count, message) => {
    const i18n = await freshI18n('uk');

    expect(i18n.t('ruleForm.errorAmountDecimals', { count })).toBe(message);
  });

  it.each([
    [0, 'This currency allows up to 0 decimal places.'],
    [1, 'This currency allows up to 1 decimal place.'],
    [2, 'This currency allows up to 2 decimal places.'],
    [5, 'This currency allows up to 5 decimal places.'],
  ])('reads the decimals a currency allows, %p, in English as %p', async (count, message) => {
    const i18n = await freshI18n('en');

    expect(i18n.t('ruleForm.errorAmountDecimals', { count })).toBe(message);
  });

  it.each([
    [1, 'Ключ Bybit діє ще 1 день. Подовжте його на Bybit; ключ лишається той самий.'],
    [2, 'Ключ Bybit діє ще 2 дні. Подовжте його на Bybit; ключ лишається той самий.'],
    [5, 'Ключ Bybit діє ще 5 днів. Подовжте його на Bybit; ключ лишається той самий.'],
    [11, 'Ключ Bybit діє ще 11 днів. Подовжте його на Bybit; ключ лишається той самий.'],
    [21, 'Ключ Bybit діє ще 21 день. Подовжте його на Bybit; ключ лишається той самий.'],
    [22, 'Ключ Bybit діє ще 22 дні. Подовжте його на Bybit; ключ лишається той самий.'],
    [25, 'Ключ Bybit діє ще 25 днів. Подовжте його на Bybit; ключ лишається той самий.'],
  ])('declines the Bybit key ends soon sentence for %p', async (count, sentence) => {
    const i18n = await freshI18n('uk');

    expect(i18n.t('accountDetail.bybitKeyEndsSoon', { count })).toBe(sentence);
  });

  it.each([
    [
      1,
      'Кіко не показав 1 рух коштів у Funding, бо він схожий на вже наявний запис, але не збігається з ним точно.',
    ],
    [
      2,
      'Кіко не показав 2 рухи коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно.',
    ],
    [
      5,
      'Кіко не показав 5 рухів коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно.',
    ],
    [
      11,
      'Кіко не показав 11 рухів коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно.',
    ],
    [
      21,
      'Кіко не показав 21 рух коштів у Funding, бо він схожий на вже наявний запис, але не збігається з ним точно.',
    ],
    [
      22,
      'Кіко не показав 22 рухи коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно.',
    ],
    [
      25,
      'Кіко не показав 25 рухів коштів у Funding, бо вони схожі на вже наявні записи, але не збігаються з ними точно.',
    ],
  ])('declines the Bybit Funding moves held sentence for %p', async (count, sentence) => {
    const i18n = await freshI18n('uk');

    expect(i18n.t('accountDetail.bybitFundingHeld', { count })).toBe(sentence);
  });

  it.each([
    [1, 'Bybit key ends in 1 day. Renew it on Bybit; the key stays the same.'],
    [2, 'Bybit key ends in 2 days. Renew it on Bybit; the key stays the same.'],
  ])('reads the Bybit key ends soon sentence for %p in English', async (count, sentence) => {
    const i18n = await freshI18n('en');

    expect(i18n.t('accountDetail.bybitKeyEndsSoon', { count })).toBe(sentence);
  });

  it.each([
    [
      1,
      'Kiko did not list 1 Funding move, because it looks like a move Kiko already has but does not match it exactly.',
    ],
    [
      2,
      'Kiko did not list 2 Funding moves, because they look like moves Kiko already has but do not match them exactly.',
    ],
  ])('reads the Bybit Funding moves held sentence for %p in English', async (count, sentence) => {
    const i18n = await freshI18n('en');

    expect(i18n.t('accountDetail.bybitFundingHeld', { count })).toBe(sentence);
  });

  it.each([
    ['errorAmountNegative', 'Введіть суму від 0.'],
    ['errorAmountWholeOnly', 'Для цієї валюти можна ввести лише цілу суму.'],
    ['errorAmountTooLarge', 'Ця сума завелика.'],
  ] as const)('reads the amount refusal %s in Ukrainian', async (key, message) => {
    const i18n = await freshI18n('uk');

    expect(i18n.t(`ruleForm.${key}`)).toBe(message);
  });

  it.each([
    [0, 'days'],
    [1, 'day'],
    [2, 'days'],
    [21, 'days'],
  ])('reads %p in English as %p', async (count, days) => {
    const i18n = await freshI18n('en');

    expect(i18n.t('forms.units.days', { count })).toBe(days);
  });
});
