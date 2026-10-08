import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

// scripts/checks/plural-count.js mechanizes kiko-translator's "A plural key is
// always called with `count`": i18next picks the _one/_few/_many/_other form
// from `count`, so a plural key called without it renders the bare base key.
// A Node check, not Semgrep: the plural key set lives in en.ts, which a
// Semgrep rule cannot read. An options argument the checker cannot see into
// (a variable, a spread) is unknown and never flagged.
const ROOT = join(__dirname, '..');
const CHECKER = join(ROOT, 'scripts/checks/plural-count.js');

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'plural-count-test-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function writeProbe(relativePath: string, source: string): string {
  const file = join(directory, relativePath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, source);

  return file;
}

function runChecker(files: string[]): SpawnSyncReturns<string> {
  return spawnSync('node', [CHECKER, ...files], { encoding: 'utf8', cwd: ROOT });
}

describe('scripts/checks/plural-count.js', () => {
  it.each([
    ["t('forms.units.days')", "t('forms.units.days')"],
    ["i18n.t('columnMapping.rowsSkipped', {})", "t('columnMapping.rowsSkipped')"],
    [
      "t('statistics.trendFilter.button.manual', { total: 2 })",
      "t('statistics.trendFilter.button.manual')",
    ],
  ])('flags %s', (call, matchedText) => {
    const file = writeProbe('src/probe.ts', `export const label = ${call};\n`);

    const result = runChecker([file]);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${file}:1: ${matchedText} has no count\n`);
  });

  // A blanked string before `/>` must not read as a regex start, and a JSX
  // text apostrophe must not read as a string: either one hides the call.
  it.each([
    '<Row icon={<Icon name="x" />} label={t(\'forms.units.days\')} />',
    "<Text>'{t('forms.units.days')}'</Text>",
    "t('forms.units.days', { el: <Icon name=\"x\" />, ns: 'x' })",
  ])('flags %s beside JSX', (call) => {
    const file = writeProbe('src/probe.tsx', `export const label = ${call};\n`);

    const result = runChecker([file]);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${file}:1: t('forms.units.days') has no count\n`);
  });

  // A quote or backtick that ends a comment is not a string before the regex
  // on the next line: reading it as one leaves the regex unblanked.
  it('flags a call after a regex whose comment line ends in a backtick', () => {
    const file = writeProbe(
      'src/probe.ts',
      [
        'const P = [',
        '  // a code span like `x`',
        '  /`/,',
        '];',
        "export const s = t('forms.units.days');",
        '',
      ].join('\n'),
    );

    const result = runChecker([file]);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${file}:5: t('forms.units.days') has no count\n`);
  });

  it('reads the options object past a regex whose comment line ends in a quote', () => {
    const file = writeProbe(
      'src/probe.ts',
      ["t('forms.units.days', { pattern: [", '  // a quoted "}"', '  /[}]/,', '] })', ''].join(
        '\n',
      ),
    );

    const result = runChecker([file]);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${file}:1: t('forms.units.days') has no count\n`);
  });

  it.each([
    "t('forms.units.days', { count })",
    "t('forms.units.days', { count: days })",
    "i18n.t('columnMapping.rowsSkipped', { count: days })",
    "t('forms.units.days', options)",
    "t('forms.units.days', { ...rest })",
    "t('statistics.trendFilter.manual')",
    't(`forms.units.days`)',
    "format('forms.units.days')",
  ])('leaves %s alone', (call) => {
    const file = writeProbe(
      'src/probe.ts',
      [
        'const count = 1;',
        'const days = 2;',
        'const options = { count };',
        'const rest = { count };',
        `export const label = ${call};`,
        '',
      ].join('\n'),
    );

    const result = runChecker([file]);

    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });

  it('reports each finding on its own line, in file order', () => {
    const file = writeProbe(
      'src/probe.tsx',
      [
        "export const first = t('forms.units.days', { count: 1 });",
        "export const second = t('forms.units.days');",
        '',
        "export const third = <Text>{i18n.t('columnMapping.rowsSkipped')}</Text>;",
        '',
      ].join('\n'),
    );

    const result = runChecker([file]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      [
        `${file}:2: t('forms.units.days') has no count`,
        `${file}:4: t('columnMapping.rowsSkipped') has no count`,
        '',
      ].join('\n'),
    );
  });

  it.each(['src/i18n/locales/en.ts', 'src/i18n/locales/uk.ts'])(
    'skips the catalogue %s',
    (path) => {
      const file = writeProbe(path, "export const label = t('forms.units.days');\n");

      const result = runChecker([file]);

      expect(result.stdout).toBe('');
      expect(result.status).toBe(0);
    },
  );

  // The guard-replay scratch checkout has no node_modules, so a checker that
  // requires an npm package fails closed on every replayed file there.
  it('runs from a checkout with no node_modules', () => {
    const checkout = join(directory, 'checkout');
    mkdirSync(join(checkout, 'scripts/checks'), { recursive: true });
    mkdirSync(join(checkout, 'src/i18n/locales'), { recursive: true });

    for (const script of readdirSync(join(ROOT, 'scripts/checks'))) {
      if (script.endsWith('.js')) {
        copyFileSync(
          join(ROOT, 'scripts/checks', script),
          join(checkout, 'scripts/checks', script),
        );
      }
    }

    copyFileSync(join(ROOT, 'src/i18n/locales/en.ts'), join(checkout, 'src/i18n/locales/en.ts'));

    const file = writeProbe('src/probe.ts', "export const label = t('forms.units.days');\n");

    const result = spawnSync('node', [join(checkout, 'scripts/checks/plural-count.js'), file], {
      encoding: 'utf8',
      cwd: directory,
    });

    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${file}:1: t('forms.units.days') has no count\n`);
    expect(result.status).toBe(1);
  });

  it('exits 2 with a usage line when no file is given', () => {
    const result = runChecker([]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: plural-count.js <file...>');
  });

  it('finds no plural key called without count anywhere in src/', () => {
    const files = execFileSync('git', ['ls-files', 'src/**/*.ts', 'src/**/*.tsx'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((file) => file !== '')
      .map((file) => join(ROOT, file));

    const result = runChecker(files);

    expect(files.length).toBeGreaterThan(100);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });
});
