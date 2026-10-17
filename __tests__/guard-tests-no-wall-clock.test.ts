import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

// A pre-write-guard test that asserts on elapsed time fails under machine load (Stryker, a second
// jest worker, a busy laptop), because load skews timing with no real regression. A test must
// prove concurrency or speed by counting work or by a rendezvous between stubs, never by a clock.
// A unique name comes from createTemporaryDirectory, never from a clock reading.
const TESTS_DIRECTORY = __dirname;

// The text of a rule fixture, not a measurement: the rule under test reads it as code.
const RULE_FIXTURE_LINES = ["'export const tomorrow = (): number => Date.now() + DAY_MS;',"];

const CLOCK_READINGS = [
  { reading: 'Date.now()', pattern: /Date\.now\b/g },
  { reading: 'new Date()', pattern: /\bnew Date\b(?!\s*\(\s*[^)\s])|(?<![.\w])Date\(\s*\)/g },
  { reading: '.getTime()', pattern: /\.getTime\(/g },
  { reading: 'performance.now()', pattern: /performance\.now\(/g },
  { reading: 'process.hrtime', pattern: /hrtime/g },
  { reading: 'console.time()', pattern: /console\.time\(/g },
  { reading: 'a shell clock', pattern: /\$SECONDS|EPOCHREALTIME|\bdate(\s+-u)?\s+["']?\+["']?%s/g },
];

const clockReadingsIn = (source: string): string[] => {
  const measured = RULE_FIXTURE_LINES.reduce((text, line) => text.replaceAll(line, ''), source);

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
    ['a Date.now() delta inside an interpolation', 'log(`${Date.now() - start}`);', ['Date.now()']],
    ['a Date.now() stored without a call', 'const clock = Date.now;', ['Date.now()']],
    ['a Date coerced by a unary plus', 'const start = +new Date;', ['new Date()']],
    ['a Date called as a function', 'const stamp = Date();', ['new Date()']],
    ['a Date built from an argument', 'const day = new Date(2026, 9, 13);', []],
    ['a Date built from a name that ends in Date', 'const day = toDate();', []],
    ['a shell date -u +%s', 'start=$(date -u +%s)', ['a shell clock']],
    ['a shell date +"%s"', 'start=$(date +"%s")', ['a shell clock']],
    ['a shell date with a calendar format', 'stamp=$(date +%Y-%m-%d)', []],
    ['a Date.now() in a rule fixture', RULE_FIXTURE_LINES[0], []],
    [
      'a stub string stamping a Date.now() per run',
      'const stub = `echo ${Date.now()} >> "$STAMP_FILE"`;',
      ['Date.now()'],
    ],
  ])('finds the clock readings of %s', (_label, source, expected) => {
    expect(clockReadingsIn(source)).toEqual(expected);
  });

  it.each(guardTestFiles())('%s reads no clock', (file) => {
    expect(clockReadingsIn(readFileSync(join(TESTS_DIRECTORY, file), 'utf8'))).toEqual([]);
  });
});

// A fixed sleep that the test then treats as "nothing more will happen" is a clock proof: under
// load the sleep ends before the late work does. A sleep is allowed only as the pause of a bounded
// poll loop, which fails the test when the awaited state never appears.
const QUEUE_TEST_FILES = ['job-queue.test.ts', 'ff-main.test.ts'];

const SLEEP_CALL = /(?<!jest\.)\bsetTimeout\(|\bspawnSync\(\s*['"]sleep['"]/;

const settleSleepsIn = (source: string): string[] => {
  const lines = source.split('\n');

  return lines.filter(
    (line, index) =>
      SLEEP_CALL.test(line) && !lines.slice(Math.max(0, index - 6), index).some(isPollBound),
  );
};

const isPollBound = (line: string): boolean => /\bpoll\s*>=\s*\w+/.test(line);

describe('queue tests settle by a rendezvous or a pass count, never by a fixed sleep', () => {
  it.each([
    ['a 600 ms settle wait', 'await new Promise((settle) => setTimeout(settle, 600));', 1],
    [
      'a settle wait after a poll',
      'await waitFor(() => !isPresent(ticket));\n  await new Promise((settle) => setTimeout(settle, 600));',
      1,
    ],
    [
      'the pause of a bounded poll loop',
      [
        'for (let poll = 0; !condition(); poll += 1) {',
        '  if (poll >= POLL_LIMIT) {',
        "    throw new Error('never');",
        '  }',
        '',
        '  await new Promise((settle) => setTimeout(settle, 20));',
        '}',
      ].join('\n'),
      0,
    ],
    ['a jest timeout', 'jest.setTimeout(120_000);', 0],
    ['a named delay', 'await new Promise((settle) => setTimeout(settle, SETTLE_MS));', 1],
    ['an arrow callback', 'await new Promise((settle) => setTimeout(() => settle(), 600));', 1],
    ['an awaited timers/promises sleep', 'await setTimeout(600);', 1],
    [
      'a call split over lines',
      'await new Promise((settle) =>\n  setTimeout(settle,\n    600),\n);',
      1,
    ],
    ['a spawned sleep', "spawnSync('sleep', ['0.6']);", 1],
    [
      'a named delay in a bounded poll loop',
      [
        'for (let poll = 0; !condition(); poll += 1) {',
        '  if (poll >= POLL_LIMIT) {',
        "    throw new Error('never');",
        '  }',
        '',
        '  await new Promise((settle) => setTimeout(settle, POLL_MS));',
        '}',
      ].join('\n'),
      0,
    ],
  ])('finds the settle sleeps of %s', (_label, source, expected) => {
    expect(settleSleepsIn(source)).toHaveLength(expected);
  });

  it.each(QUEUE_TEST_FILES)('%s has no settle sleep', (file) => {
    expect(settleSleepsIn(readFileSync(join(TESTS_DIRECTORY, file), 'utf8'))).toEqual([]);
  });
});
