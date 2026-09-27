import { weekStartFor } from './week-start';

describe('weekStartFor', () => {
  it('starts the week on Sunday for a Sunday-first region', () => {
    expect(weekStartFor('US')).toBe(0);
  });

  it('starts the week on Monday for a Monday-first region', () => {
    expect(weekStartFor('UA')).toBe(1);
  });

  it('matches a region case-insensitively', () => {
    expect(weekStartFor('us')).toBe(0);
  });

  it('falls back to Monday when the region is unresolved', () => {
    expect(weekStartFor(undefined)).toBe(1);
  });

  it('falls back to Monday for a region outside the Sunday-first table', () => {
    expect(weekStartFor('DE')).toBe(1);
  });

  it('starts the week on Monday for Australia, per current CLDR', () => {
    expect(weekStartFor('AU')).toBe(1);
  });

  it('starts the week on Sunday for Portugal', () => {
    expect(weekStartFor('PT')).toBe(0);
  });

  it('falls back to Monday for Poland', () => {
    expect(weekStartFor('PL')).toBe(1);
  });

  it('falls back to Monday for the United Kingdom', () => {
    expect(weekStartFor('GB')).toBe(1);
  });

  it('starts the week on Sunday for Honduras', () => {
    expect(weekStartFor('HN')).toBe(0);
  });

  it('starts the week on Sunday for Iceland', () => {
    expect(weekStartFor('IS')).toBe(0);
  });
});
