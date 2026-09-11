const { PNG } = require('pngjs');

const { comparePng, DEFAULT_MAX_MISMATCH_RATIO, DEFAULT_THRESHOLD } = require('./compare-png');

// Hermetic: every PNG this test compares is generated in-memory with pngjs —
// no simulator, no Maestro, no filesystem baseline. Models the intent of
// __tests__/mutation-*.test.ts (drive the REAL wrapper logic through a fast
// seam) but here the "seam" is comparePng's pure buffer-in/result-out shape.

// A small solid-color PNG, fast to encode/decode and easy to reason about:
// every pixel is the same RGBA value, so an N-pixel edit produces an exact,
// predictable mismatch ratio (N / (width*height)).
const WIDTH = 10;
const HEIGHT = 10;

const solidPng = (r, g, b, a = 255) => {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = a;
  }
  return PNG.sync.write(png);
};

// Returns a solid-color PNG buffer with `count` pixels (starting at the top
// left) flipped to a strongly contrasting color, so pixelmatch's default
// threshold reliably counts them as mismatched.
const solidPngWithMismatches = (r, g, b, count) => {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  for (let p = 0; p < count; p++) {
    const offset = p * 4;
    png.data[offset] = 255 - r;
    png.data[offset + 1] = 255 - g;
    png.data[offset + 2] = 255 - b;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
};

const differentSizePng = (width, height, r, g, b) => {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
};

describe('comparePng', () => {
  it('passes on two identical PNG buffers, with zero mismatched pixels', () => {
    const buffer = solidPng(20, 30, 40);

    const result = comparePng(buffer, buffer);

    expect(result.pass).toBe(true);
    expect(result.mismatchedPixels).toBe(0);
    expect(result.mismatchRatio).toBe(0);
    expect(result.width).toBe(WIDTH);
    expect(result.height).toBe(HEIGHT);
    expect(result.dimensionMismatch).toBe(false);
  });

  it('fails when the mismatch ratio exceeds maxMismatchRatio', () => {
    const baseline = solidPng(10, 10, 10);
    // Flip every pixel (100% mismatch) — far over any reasonable tolerance.
    const current = solidPngWithMismatches(10, 10, 10, WIDTH * HEIGHT);

    const result = comparePng(baseline, current, { maxMismatchRatio: 0.005 });

    expect(result.pass).toBe(false);
    expect(result.mismatchedPixels).toBe(WIDTH * HEIGHT);
    expect(result.mismatchRatio).toBe(1);
  });

  it('passes when the mismatch ratio is within maxMismatchRatio', () => {
    const baseline = solidPng(200, 200, 200);
    // 1 pixel out of 100 = 1% ratio, under a 5% tolerance.
    const current = solidPngWithMismatches(200, 200, 200, 1);

    const result = comparePng(baseline, current, { maxMismatchRatio: 0.05 });

    expect(result.pass).toBe(true);
    expect(result.mismatchedPixels).toBe(1);
    expect(result.mismatchRatio).toBeCloseTo(1 / (WIDTH * HEIGHT));
  });

  it('treats a dimension mismatch as a hard fail, not a crash', () => {
    const baseline = solidPng(50, 60, 70);
    const current = differentSizePng(WIDTH + 4, HEIGHT, 50, 60, 70);

    expect(() => comparePng(baseline, current)).not.toThrow();

    const result = comparePng(baseline, current);

    expect(result.pass).toBe(false);
    expect(result.dimensionMismatch).toBe(true);
    expect(result.mismatchRatio).toBe(1);
  });

  it('exposes the documented default tolerances used when no options are passed', () => {
    // These are read back from the module's own exported constants (not
    // re-asserted as magic numbers here) so a future change to the chosen
    // tolerance is a deliberate one-line edit, not a silent drift — but the
    // module must actually apply them when comparePng is called with no
    // options, which the next assertion proves.
    expect(DEFAULT_THRESHOLD).toBe(0.1);
    expect(DEFAULT_MAX_MISMATCH_RATIO).toBe(0.005);

    const baseline = solidPng(80, 80, 80);
    // Mismatch ratio just over the default 0.5% tolerance (1 pixel = 1%).
    const current = solidPngWithMismatches(80, 80, 80, 1);

    const result = comparePng(baseline, current);

    expect(result.mismatchRatio).toBeGreaterThan(DEFAULT_MAX_MISMATCH_RATIO);
    expect(result.pass).toBe(false);
  });
});
