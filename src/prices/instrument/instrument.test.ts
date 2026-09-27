import { shareInstrument, metalInstrument, holdingInstrument } from './instrument';

describe('shareInstrument', () => {
  it('prefixes a symbol with "share:"', () => {
    expect(shareInstrument('AAPL')).toBe('share:AAPL');
  });
});

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
