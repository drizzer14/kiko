import { isRecord } from './is-record';

describe('isRecord', () => {
  it('accepts a plain object', () => {
    expect(isRecord({ lots: [] })).toBe(true);
    expect(isRecord({})).toBe(true);
  });

  it('rejects an array, whose keys are not named fields', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([{ day: 1 }])).toBe(false);
  });

  it('rejects null and every primitive', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('lots')).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });
});
