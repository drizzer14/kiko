import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';

const SCRIPT = join(__dirname, '../scripts/checks/feature-imports.sh');
const ANALYZER = join(__dirname, '../scripts/checks/feature-imports.js');

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'feature-imports-test-'));
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

function importFrom(specifier: string): string {
  return `import { thing } from '${specifier}';\n`;
}

function runAnalyzer(...parameters: string[]): SpawnSyncReturns<string> {
  return spawnSync('node', [ANALYZER, ...parameters], { encoding: 'utf8' });
}

// Built by interpolation so this file's own text never reads as a real
// screens import to kiko-no-import-screens-outside-ui, which matches raw
// source text and cannot tell a fixture string from real code.
const SCREENS = 'screens';

describe('scripts/checks/feature-imports.js per-file findings', () => {
  it.each([
    [
      'relative-leaves-feature',
      'src/holdings/lots/lots.ts',
      '../../currency/money/money',
      '@kiko/currency/money',
    ],
    [
      'alias-skips-barrel',
      'src/holdings/lots/lots.ts',
      '@kiko/currency/money/money',
      '@kiko/currency/money',
    ],
    [
      'relative-between-screens',
      `src/${SCREENS}/home/home.screen.tsx`,
      '../accounts',
      `@kiko/${SCREENS}/accounts`,
    ],
    [
      'alias-into-own-feature',
      'src/rates/conversion/conversion.ts',
      '@kiko/rates/conversion/helpers',
      './helpers',
    ],
    ['own-barrel', 'src/rates/conversion/nested/deep.ts', '..', '../conversion'],
    [
      'test-only-from-production',
      'src/holdings/repo/repo.ts',
      '@kiko/test-support/render',
      'move the import into a test file',
    ],
  ])('reports [%s]', (kind, importer, specifier, suggestion) => {
    const file = writeFixture(importer, importFrom(specifier));

    const result = runAnalyzer(file);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${file}:1: ${specifier} [${kind}] -> ${suggestion}\n`);
  });

  it.each([
    ['a file of its own feature', 'src/holdings/lots/lots.ts', './lots.helpers'],
    ['a nested file of its own feature', 'src/rates/conversion/nested/deep.ts', '../conversion'],
    ['a barrel through the alias', 'src/holdings/lots/lots.ts', '@kiko/currency/money'],
    ['a sibling barrel in the same container', 'src/rates/conversion/conversion.ts', '../history'],
    ['a plain feature barrel', 'src/holdings/repo/repo.ts', '@kiko/db'],
    ['a bare package', 'src/holdings/lots/lots.ts', 'react-native'],
    ['its own unit from its test', 'src/rates/conversion/conversion.test.ts', '.'],
    [
      'a test-only path from a test file',
      'src/holdings/repo/repo.test.ts',
      '@kiko/test-support/render',
    ],
    [
      'a screen barrel through the alias',
      `src/${SCREENS}/home/home.screen.tsx`,
      `@kiko/${SCREENS}/accounts`,
    ],
  ])('allows %s', (_label, importer, specifier) => {
    const file = writeFixture(importer, importFrom(specifier));

    const result = runAnalyzer(file);

    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });

  it.each([
    [
      'a sibling in a screens container',
      `src/${SCREENS}/forms/date-field/date-field.tsx`,
      '../time-field',
    ],
    ['a sibling from a nested file', 'src/rates/conversion/nested/deep.ts', '../../history'],
    ['an inner file of a sibling', 'src/rates/conversion/conversion.ts', '../history/history'],
    [
      'a unit of another container',
      'src/rates/conversion/conversion.ts',
      '../../prices/instrument',
    ],
  ])('denies %s', (_label, importer, specifier) => {
    const file = writeFixture(importer, importFrom(specifier));

    const result = runAnalyzer(file);

    expect(result.status).toBe(1);
  });

  it('gives top-level features no sibling exception', () => {
    const file = writeFixture('src/accounts/accounts.repo.ts', importFrom('../db'));

    const result = runAnalyzer(file);

    expect(result.stdout).toBe(`${file}:1: ../db [relative-leaves-feature] -> @kiko/db\n`);
  });

  it('suggests the same inner file for a relative jest call that leaves the feature', () => {
    const file = writeFixture(
      'src/holdings/repo/repo.test.ts',
      "jest.mock('../../db/client');\nconst actual = jest.requireActual('../../db/client');\n",
    );

    const result = runAnalyzer(file);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      `${file}:1: ../../db/client [relative-leaves-feature] -> @kiko/db/client\n` +
        `${file}:2: ../../db/client [relative-leaves-feature] -> @kiko/db/client\n`,
    );
  });

  it('allows a jest call that names an inner file through the alias', () => {
    const file = writeFixture(
      'src/holdings/repo/repo.test.ts',
      [
        "jest.mock('@kiko/db/client');",
        "jest.doMock('@kiko/db/client');",
        "jest.unmock('@kiko/db/client');",
        "const actual = jest.requireActual('@kiko/db/client');",
        "const mocked = jest.requireMock('@kiko/db/client');",
        '',
      ].join('\n'),
    );

    const result = runAnalyzer(file);

    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });

  it('reports a plain import of an inner file even in a test file', () => {
    const file = writeFixture('src/holdings/repo/repo.test.ts', importFrom('@kiko/db/client'));

    const result = runAnalyzer(file);

    expect(result.stdout).toContain('[alias-skips-barrel] -> @kiko/db');
  });

  it('reports a relative test-only path that leaves the feature with its full alias path', () => {
    const file = writeFixture(
      'src/holdings/repo/repo.test.ts',
      importFrom('../../test-support/render'),
    );

    const result = runAnalyzer(file);

    expect(result.stdout).toContain('[relative-leaves-feature] -> @kiko/test-support/render');
  });

  it('resolves a path through the guard mirror the same way', () => {
    const leaving = writeFixture(
      'after/src/holdings/lots/lots.ts',
      importFrom('../../currency/money/money'),
    );
    const sibling = writeFixture(
      'after/src/rates/conversion/conversion.ts',
      importFrom('../history'),
    );

    expect(runAnalyzer(leaving).stdout).toContain('[relative-leaves-feature]');
    expect(runAnalyzer(sibling).status).toBe(0);
  });

  it('anchors on its own checkout when the checkout path holds a src folder', () => {
    // Node resolves the copied script's __dirname through symlinks
    // (/var -> /private/var on macOS), so the file path must be real too.
    const checkout = join(realpathSync(directory), 'src/clone');
    const checks = join(checkout, 'scripts/checks');
    mkdirSync(checks, { recursive: true });

    for (const name of ['feature-imports.js', 'specifier-scanner.js']) {
      copyFileSync(join(__dirname, '../scripts/checks', name), join(checks, name));
    }

    const file = join(checkout, 'src/rates/a/a.ts');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, importFrom('../../db/client'));

    const result = spawnSync('node', [join(checks, 'feature-imports.js'), file], {
      encoding: 'utf8',
    });

    expect(result.stdout).toBe(
      `${file}:1: ../../db/client [relative-leaves-feature] -> @kiko/db\n`,
    );
    expect(result.status).toBe(1);
  });

  it('treats App.tsx and e2e files as feature-less importers', () => {
    const app = writeFixture('App.tsx', importFrom('./src/db/client'));
    const endToEnd = writeFixture('e2e/screenshot/flow.ts', importFrom('../../src/db'));
    const clean = writeFixture('e2e/screenshot/clean.ts', importFrom('@kiko/db'));

    expect(runAnalyzer(app).stdout).toContain('[relative-leaves-feature] -> @kiko/db');
    expect(runAnalyzer(endToEnd).stdout).toContain('[relative-leaves-feature] -> @kiko/db');
    expect(runAnalyzer(clean).status).toBe(0);
  });

  it('ignores import text inside comments and strings', () => {
    const file = writeFixture(
      'src/holdings/lots/lots.ts',
      [
        `// ${importFrom('../../currency/money/money').trim()}`,
        `const text = "${importFrom('../../currency/money/money').trim()}";`,
        '',
      ].join('\n'),
    );

    expect(runAnalyzer(file).status).toBe(0);
  });
});

describe('scripts/checks/feature-imports.js --tree', () => {
  function runTree(): SpawnSyncReturns<string> {
    return runAnalyzer('--tree', join(directory, 'src'));
  }

  it('is clean on a well-formed tree', () => {
    writeFixture('src/env.d.ts', 'declare module "@env" {}\n');
    writeFixture('src/rates/conversion/index.ts', "export * from './conversion';\n");
    writeFixture('src/rates/conversion/conversion.ts', importFrom('../history'));
    writeFixture('src/rates/history/index.ts', "export * from './history';\n");
    writeFixture('src/rates/history/history.ts', 'export const thing = 1;\n');
    writeFixture('src/rates/monobank-feed-test-helper.ts', 'export const feed = 1;\n');
    writeFixture('src/monobank/__fixtures__/payload.ts', 'export const payload = 1;\n');
    writeFixture('src/test-support/render.ts', 'export const render = 1;\n');

    const result = runTree();

    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });

  it.each([
    ['loose-file', 'src/rates/loose.ts', 'src/rates/loose.ts', 'export const loose = 1;\n'],
    [
      'missing-barrel',
      'src/rates/no-barrel/no-barrel.ts',
      'src/rates/no-barrel',
      'export const thing = 1;\n',
    ],
    [
      'barrel-leak',
      'src/rates/leaky/index.ts',
      'src/rates/leaky/index.ts',
      "export * from './leaky.test';\n",
    ],
    [
      'barrel-leak',
      'src/rates/foreign/index.ts',
      'src/rates/foreign/index.ts',
      "export * from '../history';\n",
    ],
    [
      'barrel-leak',
      'src/rates/runs-foreign/index.ts',
      'src/rates/runs-foreign/index.ts',
      "import '../history';\n",
    ],
    [
      'barrel-leak',
      'src/rates/named-binding/index.ts',
      'src/rates/named-binding/index.ts',
      "import { thing } from '@kiko/rates/history';\nexport { thing };\n",
    ],
    [
      'barrel-leak',
      'src/rates/renamed-binding/index.ts',
      'src/rates/renamed-binding/index.ts',
      "import { thing as other } from '../history';\nexport { other as renamed };\n",
    ],
    [
      'barrel-leak',
      'src/rates/default-binding/index.ts',
      'src/rates/default-binding/index.ts',
      "import thing from '@kiko/rates/history';\nexport default thing;\n",
    ],
    [
      'barrel-leak',
      'src/rates/namespace-binding/index.ts',
      'src/rates/namespace-binding/index.ts',
      "import * as history from '../history';\nexport type { history };\n",
    ],
    [
      'barrel-leak',
      'src/rates/commented-binding/index.ts',
      'src/rates/commented-binding/index.ts',
      "import {\n  // the rate history\n  thing,\n} from '@kiko/rates/history';\nexport { thing };\n",
    ],
    [
      'barrel-leak',
      'src/rates/aliased-binding/index.ts',
      'src/rates/aliased-binding/index.ts',
      "import { thing } from '@kiko/rates/history';\nexport const alias = thing;\n",
    ],
  ])('reports [%s] for %s', (kind, relativePath, reportedPath, source) => {
    writeFixture('src/rates/history/index.ts', "export * from './history';\n");
    writeFixture('src/rates/history/history.ts', 'export const thing = 1;\n');
    writeFixture(relativePath, source);

    const result = runTree();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`${join(directory, reportedPath)}: [${kind}]`);
  });

  it('allows a barrel that exports only its own bindings', () => {
    writeFixture('src/rates/history/index.ts', "export * from './history';\n");
    writeFixture('src/rates/history/history.ts', 'export const thing = 1;\n');
    writeFixture(
      'src/rates/own/index.ts',
      [
        "import { own } from './own';",
        "import { thing } from '../history';",
        '',
        '// export { thing };',
        'export const doubled = thing * 2;',
        'export { own };',
        '',
      ].join('\n'),
    );
    writeFixture('src/rates/own/own.ts', 'export const own = 1;\n');

    const result = runTree();

    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });

  it('reports [undeclared-container] for a folder of barrelled units', () => {
    writeFixture('src/widgets/first/index.ts', 'export const first = 1;\n');
    writeFixture('src/widgets/second/index.ts', 'export const second = 1;\n');

    const result = runTree();

    expect(result.stdout).toContain(`${join(directory, 'src/widgets')}: [undeclared-container]`);
  });

  it('reports [feature-cycle] for a value cycle between features', () => {
    writeFixture('src/rates/first/index.ts', "export * from './first';\n");
    writeFixture('src/rates/first/first.ts', importFrom('../second'));
    writeFixture('src/rates/second/index.ts', "export * from './second';\n");
    writeFixture('src/rates/second/second.ts', importFrom('../first'));

    const result = runTree();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[feature-cycle] rates/first -> rates/second -> rates/first');
  });

  it('ignores a cycle closed only by a type import or a test file', () => {
    writeFixture('src/rates/first/index.ts', "export * from './first';\n");
    writeFixture('src/rates/first/first.ts', importFrom('../second'));
    writeFixture('src/rates/first/first.test.ts', importFrom('../second'));
    writeFixture('src/rates/second/index.ts', "export * from './second';\n");
    writeFixture('src/rates/second/second.ts', "import type { Thing } from '../first';\n");
    writeFixture('src/rates/second/second.test.ts', importFrom('../first'));

    const result = runTree();

    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('scripts/checks/feature-imports.sh', () => {
  it('exits 2 with the structured block on a per-file violation', () => {
    const file = writeFixture(
      'src/holdings/lots/lots.ts',
      importFrom('../../currency/money/money'),
    );

    const result = spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Feature import');
  });

  it('exits 0 on a non-.ts/.tsx file', () => {
    const file = writeFixture('src/holdings/notes.md', '# not typescript\n');

    expect(spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' }).status).toBe(0);
  });

  describe('project-wide mode (no file argument)', () => {
    function runProjectWide(): SpawnSyncReturns<string> {
      return spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, FEATURE_IMPORTS_SOURCE_ROOT: directory },
      });
    }

    it('exits 0 when FEATURE_IMPORTS_SOURCE_ROOT is clean', () => {
      writeFixture('src/rates/history/index.ts', "export * from './history';\n");
      writeFixture('src/rates/history/history.ts', 'export const thing = 1;\n');
      writeFixture('App.tsx', importFrom('@kiko/rates/history'));

      expect(runProjectWide().status).toBe(0);
    });

    it('exits 2 on an import violation', () => {
      writeFixture('App.tsx', importFrom('./src/rates/history/history'));

      const result = runProjectWide();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('[relative-leaves-feature]');
    });

    it('exits 2 on a tree violation', () => {
      writeFixture('src/rates/loose.ts', 'export const loose = 1;\n');

      const result = runProjectWide();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('[loose-file]');
    });
  });
});
