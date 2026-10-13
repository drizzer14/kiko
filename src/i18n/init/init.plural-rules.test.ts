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
