import { holdingTypes } from './holding-type';
import { holdingTypeIcon } from './holding-icon';

describe('holdingTypeIcon', () => {
  it('maps each holding type to a default SF Symbol glyph', () => {
    expect(holdingTypeIcon).toEqual({
      card: 'creditcard',
      term_deposit: 'banknote',
      bond: 'doc.text',
      cash: 'banknote',
      crypto_asset: 'bitcoinsign.circle',
      jar: 'cup.and.saucer',
    });
  });

  it('provides a default for every holding type', () => {
    for (const type of holdingTypes) {
      expect(typeof holdingTypeIcon[type]).toBe('string');
    }
  });
});
