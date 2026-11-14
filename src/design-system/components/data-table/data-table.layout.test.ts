import {
  resolveHeaderShift,
  resolveStatusBandOpacity,
  STATUS_BAND_HEIGHT,
} from './data-table.layout';

describe('resolveHeaderShift', () => {
  const BAR = 100;
  const HEADER_Y = 300;

  it('does not shift the header at rest', () => {
    expect(resolveHeaderShift(0, BAR, HEADER_Y)).toBe(0);
  });

  it('does not shift it before the header reaches the bar', () => {
    expect(resolveHeaderShift(150, BAR, HEADER_Y)).toBe(0);
  });

  it('does not shift it at the moment the header reaches the bar', () => {
    expect(resolveHeaderShift(200, BAR, HEADER_Y)).toBe(0);
  });

  it('shifts it by the distance scrolled past the bar', () => {
    expect(resolveHeaderShift(260, BAR, HEADER_Y)).toBe(60);
  });

  it('does not shift it for a rubber-band offset above the top', () => {
    expect(resolveHeaderShift(-40, BAR, HEADER_Y)).toBe(0);
  });

  it('moves the point the header sticks at when the bar grows or shrinks', () => {
    expect(resolveHeaderShift(260, 60, HEADER_Y)).toBe(20);
    expect(resolveHeaderShift(260, 140, HEADER_Y)).toBe(100);
  });
});

describe('resolveStatusBandOpacity', () => {
  it.each([
    ['the bar minimized and the header stuck', 60, 1, 1],
    ['the header at rest under a minimized bar', 0, 1, 0],
    ['half-way onto the stick point under a minimized bar', 0.5, 1, 0.5],
    ['the header stuck with the bar half revealed', 60, 0.5, 0.5],
    ['the header half stuck with the bar half revealed', 0.5, 0.5, 0.25],
    ['the header stuck while the native stack reports the bar as not minimized', 60, 0, 0],
    ['a stretch past the top under a minimized bar', -5, 1, 0],
    ['a shift of exactly one under a fully minimized bar', 1, 1, 1],
    ['a fraction above one', 60, 1.2, 1],
    ['a fraction below zero', 60, -0.1, 0],
  ])('is as the rule has it for %s', (_name, shift, minimizedFraction, expected) => {
    expect(resolveStatusBandOpacity(shift, minimizedFraction)).toBeCloseTo(expected, 10);
  });
});

describe('STATUS_BAND_HEIGHT', () => {
  it('reaches at least the height of an inline bar on a phone in portrait', () => {
    expect(STATUS_BAND_HEIGHT).toBeGreaterThanOrEqual(116);
  });
});
