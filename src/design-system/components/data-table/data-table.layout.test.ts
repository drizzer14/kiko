import { resolveHeaderShift } from './data-table.layout';

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
