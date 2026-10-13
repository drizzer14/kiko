import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

// A pre-write-guard test that asserts on elapsed time fails under machine load (Stryker, a second
// jest worker, a busy laptop), because load skews timing with no real regression. A test must
// prove concurrency or speed by counting work or by a rendezvous between stubs, never by a clock.
// The one clock use left is a unique name, `${Date.now()}` directly inside a template literal.
const TESTS_DIRECTORY = __dirname;

// The text of a rule fixture, not a measurement: the rule under test reads it as code.
const RULE_FIXTURE_LINES = ["'export const tomorrow = (): number => Date.now() + DAY_MS;',"];

const CLOCK_READINGS = [
  { reading: 'Date.now()', pattern: /(?<!\$\{)Date\.now\(/g },
  { reading: 'new Date()', pattern: /new Date\(\s*\)/g },
  { reading: '.getTime()', pattern: /\.getTime\(/g },
  { reading: 'performance.now()', pattern: /performance\.now\(/g },
  { reading: 'process.hrtime', pattern: /hrtime/g },
  { reading: 'console.time()', pattern: /console\.time\(/g },
  { reading: 'a shell clock', pattern: /\$SECONDS|EPOCHREALTIME|date ["']?\+%s/g },
];

const clockReadingsIn = (source: string): string[] => {
  const measured = RULE_FIXTURE_LINES.reduce((text, line) => text.replace(line, ''), source);

  return CLOCK_READINGS.filter(({ pattern }) => measured.match(pattern) !== null).map(
    ({ reading }) => reading,
  );
};

const guardTestFiles = (): string[] =>
  readdirSync(TESTS_DIRECTORY).filter((file) => /^pre-write-guard.*\.test\.ts$/.test(file));

describe('pre-write-guard tests assert on no clock delta', () => {
  it('scans the guard test files it is meant to', () => {
    expect(guardTestFiles()).toContain('pre-write-guard.test.ts');
  });

  it.each([
    ['a stored Date.now()', 'const startTime = Date.now();', ['Date.now()']],
    ['a subtracted Date.now()', 'expect(Date.now() - startTime)', ['Date.now()']],
    ['a stamp text written by a stub', "String(Date.now())', '", ['Date.now()']],
    ['a pushed stamp', 'stamps.push(Date.now());', ['Date.now()']],
    ['a stamp in an object', 'const span = { start: Date.now() };', ['Date.now()']],
    ['a Date.now() under expect', 'expect(Date.now()).toBeLessThan(limit);', ['Date.now()']],
    ['a no-argument Date subtracted', 'const elapsed = new Date() - start;', ['new Date()']],
    ['a Date getTime() delta', 'const t = new Date(0).getTime();', ['.getTime()']],
    ['a performance.now() delta', 'const t = performance.now();', ['performance.now()']],
    ['an hrtime delta', 'const t = process.hrtime.bigint();', ['process.hrtime']],
    ['a console.time()', "console.time('guard');", ['console.time()']],
    ['a shell $SECONDS', 'echo "$SECONDS" >> "$FILE"', ['a shell clock']],
    ['a shell $EPOCHREALTIME', 'echo "$EPOCHREALTIME" >> "$FILE"', ['a shell clock']],
    ['a shell date +%s', 'start=$(date +%s)', ['a shell clock']],
    ['a shell date "+%s"', 'start=$(date "+%s")', ['a shell clock']],
    ['a Date.now() used as a unique name', 'join(tmpdir(), `link-${Date.now()}`)', []],
    ['a Date.now() after another interpolation', '`x-${process.pid}-${Date.now()}`', []],
    ['a Date.now() in a rule fixture', RULE_FIXTURE_LINES[0], []],
  ])('finds the clock readings of %s', (_label, source, expected) => {
    expect(clockReadingsIn(source)).toEqual(expected);
  });

  it.each(guardTestFiles())('%s reads no clock', (file) => {
    expect(clockReadingsIn(readFileSync(join(TESTS_DIRECTORY, file), 'utf8'))).toEqual([]);
  });
});
