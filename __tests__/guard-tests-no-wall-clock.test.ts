import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

// A pre-write-guard test that asserts on elapsed time fails under machine load (Stryker, a second
// jest worker, a busy laptop) with no real regression, five times so far. A test must prove
// concurrency or speed by counting work or by a rendezvous between stubs, never by a clock delta.
// A `Date.now()` that only names something (a unique suffix, or text a rule under test reads) is
// not a measurement; one that is stored or subtracted is.
const TESTS_DIRECTORY = __dirname;

const CLOCK_READINGS = [
  { reading: 'Date.now() delta', pattern: /(?:[=-]\s*Date\.now\(\)|Date\.now\(\)\s*-)/g },
  { reading: 'shell date +%s', pattern: /date \+%s/g },
  { reading: 'performance.now()', pattern: /performance\.now\(/g },
  { reading: 'process.hrtime', pattern: /hrtime/g },
  { reading: '.getTime()', pattern: /\.getTime\(\)/g },
];

const clockReadingsIn = (source: string): string[] =>
  CLOCK_READINGS.filter(({ pattern }) => source.match(pattern) !== null).map(
    ({ reading }) => reading,
  );

const guardTestFiles = (): string[] =>
  readdirSync(TESTS_DIRECTORY).filter((file) => /^pre-write-guard.*\.test\.ts$/.test(file));

describe('pre-write-guard tests assert on no clock delta', () => {
  it('scans the guard test files it is meant to', () => {
    expect(guardTestFiles()).toContain('pre-write-guard.test.ts');
  });

  it.each([
    ['a stored Date.now()', 'const startTime = Date.now();', ['Date.now() delta']],
    ['a subtracted Date.now()', 'expect(Date.now() - startTime)', ['Date.now() delta']],
    ['a shell clock read', 'start=$(date +%s)', ['shell date +%s']],
    ['a performance.now() delta', 'const t = performance.now();', ['performance.now()']],
    ['an hrtime delta', 'const t = process.hrtime.bigint();', ['process.hrtime']],
    ['a Date getTime() delta', 'const t = new Date().getTime();', ['.getTime()']],
    ['a Date.now() used as a unique name', 'join(tmpdir(), `link-${Date.now()}`)', []],
    ['a Date.now() in text a rule reads', "'const tomorrow = () => Date.now() + DAY;'", []],
  ])('finds the clock readings of %s', (_label, source, expected) => {
    expect(clockReadingsIn(source)).toEqual(expected);
  });

  it.each(guardTestFiles())('%s reads no clock', (file) => {
    expect(clockReadingsIn(readFileSync(join(TESTS_DIRECTORY, file), 'utf8'))).toEqual([]);
  });
});
