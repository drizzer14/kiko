import { metalInstrument, holdingInstrument } from './instrument';

describe('metalInstrument', () => {
  it('prefixes a metal with "metal:"', () => {
    expect(metalInstrument('gold')).toBe('metal:gold');
  });
});

describe('holdingInstrument', () => {
  it('prefixes a holding id with "holding:"', () => {
    expect(holdingInstrument('h1')).toBe('holding:h1');
  });
});
