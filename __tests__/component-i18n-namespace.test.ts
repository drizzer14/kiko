import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

// scripts/checks/component-i18n-namespace.sh mechanizes kiko-translator's "A string moved into a
// shared component changes namespace": a file under `src/design-system/components/<name>/` reads
// only `components.<camelCase(name)>.*`. Deciding that needs the file's own folder name, which a
// Semgrep rule cannot compare against a string, so it is a Node check.
const SCRIPT = join(__dirname, '../scripts/checks/component-i18n-namespace.sh');
const ANALYZER = join(__dirname, '../scripts/checks/component-i18n-namespace.js');

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'component-i18n-namespace-test-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function writeFixture(relativePath: string, source: string): string {
  const file = join(directory, relativePath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, source);

  return file;
}

function runAnalyzer(file: string): SpawnSyncReturns<string> {
  return spawnSync('node', [ANALYZER, file], { encoding: 'utf8' });
}

function runProjectCheck(): SpawnSyncReturns<string> {
  return spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, COMPONENT_I18N_NAMESPACE_SOURCE_ROOT: directory },
  });
}

describe('scripts/checks/component-i18n-namespace.js', () => {
  it('flags a component reading another component namespace, naming the expected one', () => {
    const file = writeFixture(
      'src/design-system/components/expand-toggle/expand-toggle.component.tsx',
      "const label = t('components.pieChart.showAll');\n",
    );

    const result = runAnalyzer(file);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      `${file}:1: components.pieChart.showAll (expected components.expandToggle)\n`,
    );
  });

  it('allows the component own camelCase namespace, for a multi-word folder name', () => {
    const file = writeFixture(
      'src/design-system/components/expand-toggle/expand-toggle.component.tsx',
      "const label = t('components.expandToggle.showAll');\n",
    );

    const result = runAnalyzer(file);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('flags a single-word folder reading a namespace other than its own', () => {
    const file = writeFixture(
      'src/design-system/components/button/button.component.tsx',
      "const label = t('components.card.title');\n",
    );

    const result = runAnalyzer(file);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('(expected components.button)');
  });

  it('checks a file nested below the component folder and a test file alike', () => {
    const nested = writeFixture(
      'src/design-system/components/summary-table/row/row.component.tsx',
      'const label = t("components.pieChart.showAll");\n',
    );
    const test = writeFixture(
      'src/design-system/components/summary-table/summary-table.component.test.tsx',
      "expect(i18n.t('components.pieChart.showLess')).toBe('Show less');\n",
    );

    expect(runAnalyzer(nested).status).toBe(1);
    expect(runAnalyzer(test).status).toBe(1);
  });

  it('reports every offending literal with its own line', () => {
    const file = writeFixture(
      'src/design-system/components/expand-toggle/expand-toggle.component.tsx',
      [
        "const first = t('components.pieChart.showLess');",
        '',
        "const second = t('components.pieChart.showAll');",
        '',
      ].join('\n'),
    );

    const result = runAnalyzer(file);

    expect(result.stdout.split('\n').filter((line) => line !== '')).toEqual([
      `${file}:1: components.pieChart.showLess (expected components.expandToggle)`,
      `${file}:3: components.pieChart.showAll (expected components.expandToggle)`,
    ]);
  });

  it('ignores a key mentioned inside a comment', () => {
    const file = writeFixture(
      'src/design-system/components/expand-toggle/expand-toggle.component.tsx',
      [
        "// Once read t('components.pieChart.showAll') from the chart.",
        '/* components.pieChart.showAll */',
        'export const value = 1;',
        '',
      ].join('\n'),
    );

    expect(runAnalyzer(file).status).toBe(0);
  });

  it('ignores a key outside the components namespace', () => {
    const file = writeFixture(
      'src/design-system/components/expand-toggle/expand-toggle.component.tsx',
      "const label = t('common.cancel');\n",
    );

    expect(runAnalyzer(file).status).toBe(0);
  });

  it('is silent on a file outside src/design-system/components/<name>/', () => {
    const screen = writeFixture(
      'src/screens/statistics/pie-chart/pie-chart.component.tsx',
      "const label = t('components.pieChart.emptyDefault');\n",
    );
    const componentsRoot = writeFixture(
      'src/design-system/components/index.ts',
      "export const label = 'components.pieChart.showAll';\n",
    );

    expect(runAnalyzer(screen).status).toBe(0);
    expect(runAnalyzer(componentsRoot).status).toBe(0);
  });
});

describe('scripts/checks/component-i18n-namespace.sh', () => {
  it('exits 0 when the scanned root holds no foreign namespace read', () => {
    writeFixture(
      'src/design-system/components/expand-toggle/expand-toggle.component.tsx',
      "const label = t('components.expandToggle.showAll');\n",
    );

    expect(runProjectCheck().status).toBe(0);
  });

  it('exits 2 with the structured block when the scanned root holds one', () => {
    writeFixture(
      'src/design-system/components/expand-toggle/expand-toggle.component.tsx',
      "const label = t('components.pieChart.showAll');\n",
    );

    const result = runProjectCheck();

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Component i18n namespace');
    expect(result.stderr).toContain('components.pieChart.showAll');
  });
});
