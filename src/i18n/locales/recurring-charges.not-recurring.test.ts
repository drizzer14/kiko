import { en } from './en';
import { uk } from './uk';
import { TITLE_KEYS } from './title-keys';
import { flattenCatalog } from './flatten-catalog';

const textsOf = (catalogue: object): Map<string, string> =>
  new Map(flattenCatalog(catalogue).map(({ path, value }) => [path, value]));

const CATALOGUES = [
  { language: 'en', texts: textsOf(en) },
  { language: 'uk', texts: textsOf(uk) },
] as const;

const TITLE_KEY = 'recurringCharges.notRecurringConfirmTitle';
const MESSAGE_KEY = 'recurringCharges.notRecurringConfirmMessage';
const HELP_STEP_KEY = 'help.topics.viewRecurringCharges.steps.4';

const APPROVED: Record<'en' | 'uk', Record<string, string>> = {
  en: {
    'recurringCharges.notRecurring': 'Not a recurring charge',
    [TITLE_KEY]: 'Not a Recurring Charge?',
    [MESSAGE_KEY]:
      '"{{name}}" leaves recurring charges and their totals in every currency, and new charges won\'t bring it back. To bring it back, mark one of its transactions as recurring.',
    [HELP_STEP_KEY]:
      'If a name doesn\'t really repeat, touch and hold it or open it, then tap "Not a recurring charge". It leaves the list and the totals in every currency, and new charges won\'t bring it back. Only a mark on one of its transactions brings it back.',
  },
  uk: {
    'recurringCharges.notRecurring': 'Це не регулярний платіж',
    [TITLE_KEY]: 'Це не регулярний платіж?',
    [MESSAGE_KEY]:
      '«{{name}}» зникне з регулярних платежів і їхніх сум у всіх валютах, і нові списання його не повернуть. Щоб повернути його, позначте одну з його транзакцій як регулярну.',
    [HELP_STEP_KEY]:
      'Якщо назва насправді не повторюється, утримуйте її або відкрийте, а потім натисніть «Це не регулярний платіж». Вона зникне зі списку й сум у всіх валютах, і нові списання її не повернуть. Повернути її можна лише позначкою на одній з її транзакцій.',
  },
};

describe.each(CATALOGUES)(
  'the "Not a recurring charge" texts, in $language',
  ({ language, texts }) => {
    it.each(Object.entries(APPROVED[language]))('reads %s as approved', (key, approved) => {
      expect(texts.get(key)).toBe(approved);
    });

    it.each(['recurringCharges.hiddenHeading', 'recurringCharges.showAgain'])(
      'has no %s: there is no Hidden section and no Show again',
      (key) => {
        expect(texts.has(key)).toBe(false);
      },
    );

    it('still has the keys a removed key sat beside, so the absence above is about the key', () => {
      expect(texts.has('recurringCharges.markedEmptyHeading')).toBe(true);
      expect(texts.has('recurringCharges.removeMark')).toBe(true);
    });
  },
);

describe('the title keys of the recurring screens', () => {
  it('names the confirm title, a sheet title, and no longer the removed Hidden heading', () => {
    expect(TITLE_KEYS.has(TITLE_KEY)).toBe(true);
    expect(TITLE_KEYS.has('recurringCharges.hiddenHeading')).toBe(false);
  });

  it('keeps the other recurring headings in the set', () => {
    expect(TITLE_KEYS.has('recurringCharges.markedEmptyHeading')).toBe(true);
    expect(TITLE_KEYS.has('recurringCharges.title')).toBe(true);
  });
});
