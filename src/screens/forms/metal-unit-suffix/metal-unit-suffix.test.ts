import { i18n } from '@kiko/i18n/init';

import { metalUnitSuffix } from './metal-unit-suffix';

describe('metalUnitSuffix', () => {
  it('names grams and troy ounces by their short unit', () => {
    expect(metalUnitSuffix(i18n.t, 'g')).toBe('g');
    expect(metalUnitSuffix(i18n.t, 'oz')).toBe('oz');
  });
});
