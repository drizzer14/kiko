import {
  resolveHeaderShift,
  resolveStatusBandOpacity,
  STATUS_BAND_FADE_END,
  STATUS_BAND_FADE_START,
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
  const SAFE_TOP = 24;

  it('is clear while the header rests, however far the bar is minimized', () => {
    expect(resolveStatusBandOpacity(0, SAFE_TOP, SAFE_TOP)).toBe(0);
  });

  it('is clear for a negative shift', () => {
    expect(resolveStatusBandOpacity(-5, SAFE_TOP, SAFE_TOP)).toBe(0);
  });

  it('is half drawn half-way onto the stick point', () => {
    expect(resolveStatusBandOpacity(0.5, SAFE_TOP, SAFE_TOP)).toBe(0.5);
  });

  it('is fully drawn from a shift of one on, with the bar minimized', () => {
    expect(resolveStatusBandOpacity(1, SAFE_TOP, SAFE_TOP)).toBe(1);
    expect(resolveStatusBandOpacity(60, SAFE_TOP, SAFE_TOP)).toBe(1);
  });

  it('is fully drawn for the first point the bar grows past the safe-area top', () => {
    expect(resolveStatusBandOpacity(60, SAFE_TOP + STATUS_BAND_FADE_START, SAFE_TOP)).toBe(1);
  });

  it('is half drawn in the middle of the ramp', () => {
    expect(resolveStatusBandOpacity(60, 30.5, SAFE_TOP)).toBe(0.5);
  });

  it('is clear at the end of the ramp and beyond it, up to the full bar', () => {
    expect(resolveStatusBandOpacity(60, SAFE_TOP + STATUS_BAND_FADE_END, SAFE_TOP)).toBe(0);
    expect(resolveStatusBandOpacity(60, 82, SAFE_TOP)).toBe(0);
  });

  it('multiplies the two halves', () => {
    expect(resolveStatusBandOpacity(0.5, 30.5, SAFE_TOP)).toBe(0.25);
  });

  it('is fully drawn under a minimized bar whose inset is below the safe-area top', () => {
    expect(resolveStatusBandOpacity(60, 54, 59)).toBe(1);
  });

  it('is clear under a full bar that reaches past the status zone', () => {
    expect(resolveStatusBandOpacity(60, 103, 62)).toBe(0);
  });

  it('is fully drawn under a minimized bar on a notched phone', () => {
    expect(resolveStatusBandOpacity(60, 62, 62)).toBe(1);
  });
});
