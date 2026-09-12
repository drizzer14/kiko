// Pixel-diff core for the App Store screenshot regression check
// (scripts/checks/screenshots.sh). This module is required in TWO ways:
//   1. By its colocated Jest test (compare-png.test.js), which is how
//      `comparePng` gets hermetic, assertion-real unit coverage with no
//      simulator involved — see that file for the two identical-buffer /
//      differing-buffer / dimension-mismatch cases, plus a CLI-level
//      (spawned subprocess) exclude-list coverage.
//   2. As a CLI, invoked ONLY by scripts/checks/screenshots.sh
//      (`node scripts/checks/screenshot-diff/compare-png.js <baselineDir>
//      <captureDir> <threshold> <maxMismatchRatio> [excludeCsv]`), under the
//      `require.main === module` guard below. Keeping the CLI in the same
//      file that the test already imports keeps the file reachable from a
//      Knip entry point (the auto-detected Jest test), instead of adding a
//      second, test-less file that only a shell script ever calls.
//
//   `excludeCsv` (5th, optional arg) is a comma-separated list of shot names
//   WITHOUT the `.png` extension (matching SCREENSHOT_NAMES' own convention)
//   to SKIP from the pixel-diff entirely — see screenshots.sh's own
//   EXCLUDE_FROM_DIFF for which shots and why (scrollUntilVisible landing at
//   a momentum-variable mid-content offset, not a glass or animation issue).
//   A skipped name is still read from the baseline dir (so a genuinely
//   missing/renamed baseline file is a silent no-op here, not a failure —
//   deliberate: an EXCLUDED shot is not part of what this check regresses),
//   printed as its own `SKIP` line for visibility, and never affects the
//   pass/fail exit code.
//
// Plain CommonJS `.js`, not TypeScript: scripts/checks/screenshots.sh invokes
// this directly with the plain `node` on PATH — there is no ts-node/tsx/babel-
// node in this project's toolchain to execute a `.ts` file outside Jest, and
// adding one only for this would be a second execution path to maintain.
// `tsc --noEmit` still project-wide-typechecks every `.ts`/`.tsx` file (see
// tsconfig.json's `include`); this file is deliberately outside that surface
// the same way every other `scripts/checks/*.sh`-adjacent tool is.

const fs = require('node:fs');
const path = require('node:path');
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

// Chosen tolerances (also recorded in CLAUDE.md's checks table entry for
// check:screenshots — keep both in sync):
//   - DEFAULT_THRESHOLD (0.1): pixelmatch's own per-pixel color-distance
//     threshold (0..1). pixelmatch's default is already 0.1; stated here
//     explicitly so the value is a deliberate, documented choice, not an
//     inherited default that could silently drift on a pixelmatch upgrade.
//   - DEFAULT_MAX_MISMATCH_RATIO (0.005 = 0.5%): the fraction of an image's
//     pixels allowed to differ before the WHOLE image fails. Non-zero on
//     purpose: @callstack/liquid-glass's blur material and any residual
//     sub-pixel animation settling (reduced motion lowers this but does not
//     guarantee bit-for-bit stills) both produce a small amount of harmless
//     per-run pixel noise that a threshold of exactly 0 would flag forever.
const DEFAULT_THRESHOLD = 0.1;
const DEFAULT_MAX_MISMATCH_RATIO = 0.005;

/**
 * Compare two PNG buffers pixel-by-pixel. Pure: no filesystem access, no
 * console output, deterministic on identical inputs.
 *
 * @param {Buffer} baselineBuffer raw bytes of the committed baseline PNG.
 * @param {Buffer} currentBuffer raw bytes of a freshly captured PNG.
 * @param {{ threshold?: number, maxMismatchRatio?: number }} [options]
 * @returns {{
 *   width: number,
 *   height: number,
 *   mismatchedPixels: number,
 *   mismatchRatio: number,
 *   pass: boolean,
 *   dimensionMismatch: boolean,
 * }}
 */
function comparePng(baselineBuffer, currentBuffer, options) {
  const opts = options || {};
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : DEFAULT_THRESHOLD;
  const maxMismatchRatio =
    typeof opts.maxMismatchRatio === 'number' ? opts.maxMismatchRatio : DEFAULT_MAX_MISMATCH_RATIO;

  const baseline = PNG.sync.read(baselineBuffer);
  const current = PNG.sync.read(currentBuffer);

  // A dimension mismatch is a HARD fail, never a crash: pixelmatch itself
  // throws when the two images differ in size, and a captured screenshot at
  // the wrong simulator/orientation is exactly the kind of regression this
  // check exists to catch, not to blow up on.
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      width: baseline.width,
      height: baseline.height,
      mismatchedPixels: baseline.width * baseline.height,
      mismatchRatio: 1,
      pass: false,
      dimensionMismatch: true,
    };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, {
    threshold,
  });
  const totalPixels = width * height;
  const mismatchRatio = totalPixels === 0 ? 0 : mismatchedPixels / totalPixels;

  return {
    width,
    height,
    mismatchedPixels,
    mismatchRatio,
    pass: mismatchRatio <= maxMismatchRatio,
    dimensionMismatch: false,
  };
}

/**
 * Parse a comma-separated CLI exclude-list argument into a Set of bare shot
 * names (no `.png` extension). Pure: no filesystem access. Tolerant of
 * `undefined`/empty input (returns an empty Set — "diff everything", the
 * pre-exclude-list behavior), extra whitespace around a name, and a trailing
 * comma/empty segment (all filtered out rather than producing a bogus empty
 * "name" that could never match a real file).
 *
 * @param {string | undefined} raw
 * @returns {Set<string>}
 */
function parseExcludeList(raw) {
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
}

module.exports = { comparePng, parseExcludeList, DEFAULT_THRESHOLD, DEFAULT_MAX_MISMATCH_RATIO };

// --- CLI: invoked only by scripts/checks/screenshots.sh, never imported ----
if (require.main === module) {
  const [, , baselineDir, captureDir, thresholdArg, maxMismatchRatioArg, excludeArg] = process.argv;

  if (!baselineDir || !captureDir) {
    process.stderr.write(
      'usage: compare-png.js <baselineDir> <captureDir> [threshold] [maxMismatchRatio] [excludeCsv]\n',
    );
    process.exit(2);
  }

  const threshold = thresholdArg ? Number(thresholdArg) : DEFAULT_THRESHOLD;
  const maxMismatchRatio = maxMismatchRatioArg
    ? Number(maxMismatchRatioArg)
    : DEFAULT_MAX_MISMATCH_RATIO;
  const excludeNames = parseExcludeList(excludeArg);

  const baselineNames = fs
    .readdirSync(baselineDir)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort();

  if (baselineNames.length === 0) {
    process.stderr.write(`MISSING\t(none)\tno .png baseline files found in ${baselineDir}\n`);
    process.exit(2);
  }

  let anyFailed = false;

  for (const name of baselineNames) {
    const bareName = name.replace(/\.png$/i, '');

    // An excluded shot is skipped ENTIRELY — not diffed, not required to
    // exist in the capture dir, and never contributes to anyFailed. See this
    // file's header comment and screenshots.sh's EXCLUDE_FROM_DIFF for why.
    if (excludeNames.has(bareName)) {
      process.stdout.write(`SKIP\t${name}\texcluded from pixel-diff (see EXCLUDE_FROM_DIFF)\n`);
      continue;
    }

    const baselinePath = path.join(baselineDir, name);
    const capturePath = path.join(captureDir, name);

    if (!fs.existsSync(capturePath)) {
      anyFailed = true;
      process.stdout.write(`MISSING\t${name}\t1\tno captured file at ${capturePath}\n`);
      continue;
    }

    const result = comparePng(fs.readFileSync(baselinePath), fs.readFileSync(capturePath), {
      threshold,
      maxMismatchRatio,
    });

    if (result.dimensionMismatch) {
      anyFailed = true;
      process.stdout.write(
        `DIMENSION\t${name}\t${result.mismatchRatio}\tbaseline ${result.width}x${result.height} vs capture dimension mismatch\n`,
      );
      continue;
    }

    if (!result.pass) {
      anyFailed = true;
    }
    process.stdout.write(
      `${result.pass ? 'PASS' : 'FAIL'}\t${name}\t${result.mismatchRatio}\t${result.mismatchedPixels}/${result.width * result.height} px\n`,
    );
  }

  process.exit(anyFailed ? 1 : 0);
}
