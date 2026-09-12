const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');

const {
  comparePng,
  parseExcludeList,
  DEFAULT_MAX_MISMATCH_RATIO,
  DEFAULT_THRESHOLD,
} = require('./compare-png');

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

describe('parseExcludeList', () => {
  it('returns an empty set for undefined or empty input (diff everything)', () => {
    expect(parseExcludeList(undefined)).toEqual(new Set());
    expect(parseExcludeList('')).toEqual(new Set());
  });

  it('splits a comma-separated list into a set of trimmed names', () => {
    const result = parseExcludeList(
      '02-home-transactions-scrolled, 07-statistics-account-contribution',
    );

    expect(result).toEqual(
      new Set(['02-home-transactions-scrolled', '07-statistics-account-contribution']),
    );
  });

  it('drops empty segments from a trailing comma or double comma', () => {
    const result = parseExcludeList('01-home-networth,,02-home-transactions-scrolled,');

    expect(result).toEqual(new Set(['01-home-networth', '02-home-transactions-scrolled']));
  });
});

// CLI-level (spawned subprocess) coverage of the exclude-list WIRING: unlike
// `parseExcludeList` above (pure parsing only), this proves the CLI loop
// ACTUALLY skips a listed name's diff — including when that name's own
// mismatch is enormous — while still failing on a real, non-excluded
// mismatch. Models __tests__/mutation-*.test.ts's "drive the real wrapper
// through a fast seam", but the seam here is the whole CLI's stdout+exit
// code rather than an in-process function call, because the skip behavior
// lives in the `require.main === module` block, which only runs when this
// file is invoked directly (the way scripts/checks/screenshots.sh actually
// calls it), not when required as a module.
describe('compare-png.js CLI exclude behavior', () => {
  const CLI = path.join(__dirname, 'compare-png.js');

  const writePng = (dir, name, buffer) => {
    fs.writeFileSync(path.join(dir, name), buffer);
  };

  const runCli = (baselineDir, captureDir, excludeCsv) => {
    try {
      const stdout = execFileSync(
        process.execPath,
        [CLI, baselineDir, captureDir, '0.1', '0.005', excludeCsv ?? ''],
        { encoding: 'utf8' },
      );
      return { code: 0, stdout };
    } catch (error) {
      return { code: error.status, stdout: error.stdout };
    }
  };

  it('skips a listed name even when it mismatches heavily, and exits 0 when nothing else fails', () => {
    const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-cmp-baseline-'));
    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-cmp-capture-'));

    const baseline = solidPng(10, 10, 10);
    // Every pixel flipped — a 100% mismatch that would fail the diff on its own.
    const currentMismatched = solidPngWithMismatches(10, 10, 10, WIDTH * HEIGHT);

    writePng(baselineDir, 'excluded-shot.png', baseline);
    writePng(captureDir, 'excluded-shot.png', currentMismatched);

    const { code, stdout } = runCli(baselineDir, captureDir, 'excluded-shot');

    expect(code).toBe(0);
    expect(stdout).toContain('SKIP\texcluded-shot.png');
    expect(stdout).not.toContain('FAIL\texcluded-shot.png');
  });

  it('still fails on a non-excluded mismatch while a different name is excluded', () => {
    const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-cmp-baseline-'));
    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-cmp-capture-'));

    const baseline = solidPng(10, 10, 10);
    const currentMismatched = solidPngWithMismatches(10, 10, 10, WIDTH * HEIGHT);
    const currentIdentical = solidPng(10, 10, 10);

    // "excluded-shot" mismatches heavily but is excluded; "regressed-shot"
    // mismatches heavily and is NOT excluded, so the run must still fail.
    writePng(baselineDir, 'excluded-shot.png', baseline);
    writePng(captureDir, 'excluded-shot.png', currentMismatched);
    writePng(baselineDir, 'regressed-shot.png', baseline);
    writePng(captureDir, 'regressed-shot.png', currentMismatched);
    writePng(baselineDir, 'stable-shot.png', baseline);
    writePng(captureDir, 'stable-shot.png', currentIdentical);

    const { code, stdout } = runCli(baselineDir, captureDir, 'excluded-shot');

    expect(code).toBe(1);
    expect(stdout).toContain('SKIP\texcluded-shot.png');
    expect(stdout).toContain('FAIL\tregressed-shot.png');
    expect(stdout).toContain('PASS\tstable-shot.png');
  });

  it('does not require an excluded name to exist in the capture dir at all', () => {
    const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-cmp-baseline-'));
    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-cmp-capture-'));

    // "excluded-shot" has a baseline but was never captured this run (e.g. a
    // flaky Maestro step); since it is excluded, this must NOT read as a
    // MISSING failure the way an un-excluded missing capture would.
    writePng(baselineDir, 'excluded-shot.png', solidPng(1, 2, 3));
    writePng(baselineDir, 'stable-shot.png', solidPng(4, 5, 6));
    writePng(captureDir, 'stable-shot.png', solidPng(4, 5, 6));

    const { code, stdout } = runCli(baselineDir, captureDir, 'excluded-shot');

    expect(code).toBe(0);
    expect(stdout).toContain('SKIP\texcluded-shot.png');
    expect(stdout).not.toContain('MISSING\texcluded-shot.png');
  });
});
