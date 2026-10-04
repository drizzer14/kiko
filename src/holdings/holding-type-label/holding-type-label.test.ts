import { i18n } from '@kiko/i18n/init';
import type { HoldingRow } from '@kiko/db';

import { holdingTypeLabel, holdingTypeName } from '.';

type LabelledRow = Pick<HoldingRow, 'type' | 'metadata'>;

const holding = (type: string, metadata: unknown = null) =>
  ({ type, metadata }) as unknown as LabelledRow;

const lots = [{ day: 0, quantityDelta: '1', costMinorUnits: 100 }];

const metalMetadata = (metal: string) => ({
  metal,
  form: 'bar',
  unit: 'g',
  purity: '0.999',
  lots,
});

// The label in English, then in Ukrainian, restoring English even when the
// assertion throws so a failure cannot leak the language into the next test.
const expectLabels = async (
  labelOf: (translate: typeof i18n.t) => string | undefined,
  english: string,
  ukrainian: string,
) => {
  expect(labelOf(i18n.t.bind(i18n))).toBe(english);

  await i18n.changeLanguage('uk');
  try {
    expect(labelOf(i18n.t.bind(i18n))).toBe(ukrainian);
  } finally {
    await i18n.changeLanguage('en');
  }
};

describe('holdingTypeName', () => {
  it.each([
    ['card', 'Card', 'Картка'],
    ['term_deposit', 'Deposit', 'Депозит'],
    ['bond', 'Bond', 'Облігація'],
    ['cash', 'Cash', 'Готівка'],
    ['crypto_asset', 'Crypto asset', 'Криптоактив'],
    ['jar', 'Jar', 'Банка'],
    ['property_item', 'Property', 'Майно'],
    ['metal', 'Precious metal', 'Дорогоцінний метал'],
    ['loan', 'Loan', 'Кредит'],
  ] as const)('names %s the way the holding form does', async (type, english, ukrainian) => {
    await expectLabels((translate) => holdingTypeName(type, translate), english, ukrainian);
  });
});

describe('holdingTypeLabel', () => {
  it.each([
    ['a card', holding('card'), 'Card', 'Картка'],
    ['a deposit', holding('term_deposit'), 'Deposit', 'Депозит'],
    ['a bond', holding('bond'), 'Bond', 'Облігація'],
    ['cash', holding('cash'), 'Cash', 'Готівка'],
    ['a crypto asset', holding('crypto_asset'), 'Crypto asset', 'Криптоактив'],
    ['a jar', holding('jar'), 'Jar', 'Банка'],
    [
      'a real estate property item',
      holding('property_item', { category: 'real_estate', lots }),
      'Real estate',
      'Нерухомість',
    ],
    [
      'a vehicle property item',
      holding('property_item', { category: 'vehicle', lots }),
      'Vehicle',
      'Транспорт',
    ],
    [
      'a valuable property item',
      holding('property_item', { category: 'valuable', lots }),
      'Valuable',
      'Цінність',
    ],
    [
      'a business share property item',
      holding('property_item', { category: 'business_share', lots }),
      'Business share',
      'Частка в бізнесі',
    ],
    [
      'a loan given property item',
      holding('property_item', { category: 'loan_given', lots }),
      'Loan given',
      'Позика',
    ],
    [
      'an other property item',
      holding('property_item', { category: 'other', lots }),
      'Other',
      'Інше',
    ],
    ['a property item with no category', holding('property_item'), 'Other', 'Інше'],
    ['a mortgage', holding('loan', { kind: 'mortgage' }), 'Mortgage', 'Іпотека'],
    ['a car loan', holding('loan', { kind: 'car_loan' }), 'Car loan', 'Автокредит'],
    [
      'a consumer loan',
      holding('loan', { kind: 'consumer_loan' }),
      'Consumer loan',
      'Споживчий кредит',
    ],
    [
      'a loan from a person',
      holding('loan', { kind: 'personal' }),
      'From a person',
      'Позика в особи',
    ],
    ['a loan with no kind', holding('loan'), 'Loan', 'Кредит'],
    ['a loan with an unknown kind', holding('loan', { kind: 'bogus' }), 'Loan', 'Кредит'],
    ['gold', holding('metal', metalMetadata('XAU')), 'Gold', 'Золото'],
    ['silver', holding('metal', metalMetadata('XAG')), 'Silver', 'Срібло'],
    ['platinum', holding('metal', metalMetadata('XPT')), 'Platinum', 'Платина'],
    ['palladium', holding('metal', metalMetadata('XPD')), 'Palladium', 'Паладій'],
    ['a metal with unparsable metadata', holding('metal'), 'Precious metal', 'Дорогоцінний метал'],
  ])('names %s the way the form Type field does', async (_description, row, english, ukrainian) => {
    await expectLabels((translate) => holdingTypeLabel(row, translate), english, ukrainian);
  });

  it('is undefined for a stored type this build has no descriptor for', () => {
    expect(holdingTypeLabel(holding('share'), i18n.t.bind(i18n))).toBeUndefined();
    expect(holdingTypeLabel(holding('constructor'), i18n.t.bind(i18n))).toBeUndefined();
  });
});
