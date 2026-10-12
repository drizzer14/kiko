import { AMOUNT_OPERATORS, DIRECTIONS, MATCHER_TYPES, TIME_OPERATORS } from './matcher-options';

describe('matcher options', () => {
  it('lists every matcher type in the order the editor offers them', () => {
    expect(MATCHER_TYPES).toEqual(['nameIs', 'nameStartsWith', 'amount', 'direction', 'time']);
  });

  it('lists every amount operator from equal to at most', () => {
    expect(AMOUNT_OPERATORS).toEqual(['eq', 'gt', 'gte', 'lt', 'lte']);
  });

  it('lists both directions and both time operators', () => {
    expect(DIRECTIONS).toEqual(['expense', 'income']);
    expect(TIME_OPERATORS).toEqual(['before', 'after']);
  });
});
