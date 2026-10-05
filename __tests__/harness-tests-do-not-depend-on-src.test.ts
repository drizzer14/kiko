import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';

// Stryker runs `jest --findRelatedTests` over the files it mutates. Jest reads every test file's
// text with a regex (not a parser), so a fixture string such as `import { x } from '@kiko/dates'`
// counts as a real import of src. A harness test that spawns Semgrep then joins the mutated run
// and its dry run times out. The fix is to build the specifier at runtime in the fixture; this
// invariant asks jest itself which harness tests it relates to src, so the answer cannot drift
// from what Stryker will do.
const ROOT = join(__dirname, '..');
const JEST_BIN = require.resolve('jest/bin/jest');
const ALIAS_MAPPER = { '^@kiko/(.*)$': '<rootDir>/src/$1' };

// These two render the real app and so import src logic on purpose. Add a file here only when
// it genuinely imports src; never for a fixture string.
const GENUINE_SRC_TESTS = ['__tests__/App.test.tsx', '__tests__/symbol-deployment-target.test.tsx'];

const isSourceFile = (path: string): boolean =>
  /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !/\.d\.ts$/.test(path);

const listSourceFiles = (rootDirectory: string): string[] =>
  readdirSync(join(rootDirectory, 'src'), { recursive: true, encoding: 'utf8' })
    .filter(isSourceFile)
    .map((path) => join(rootDirectory, 'src', path));

const harnessTestsRelatedTo = (
  rootDirectory: string,
  config: object,
  sourceFiles: string[],
): string[] => {
  const { FORCE_COLOR: _forcedColor, ...environment } = process.env;
  const result = spawnSync(
    process.execPath,
    [
      JEST_BIN,
      '--no-watchman',
      `--config=${JSON.stringify({ rootDir: rootDirectory, ...config })}`,
      '--listTests',
      '--findRelatedTests',
      ...sourceFiles,
    ],
    { cwd: rootDirectory, encoding: 'utf8', env: environment },
  );

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((path) => relative(rootDirectory, path))
    .filter((path) => path.startsWith('__tests__/'));
};

describe('harness tests that are not related to src', () => {
  it('no __tests__ file is related to a src file unless it genuinely imports src', () => {
    const related = harnessTestsRelatedTo(
      ROOT,
      { ...require('../jest.config.js') },
      listSourceFiles(ROOT),
    );

    expect(related.filter((path) => !GENUINE_SRC_TESTS.includes(path))).toEqual([]);
  });

  describe('the check itself, on a throwaway project', () => {
    let project: string;

    beforeEach(() => {
      project = realpathSync(mkdtempSync(join(tmpdir(), 'harness-src-dependency-')));
    });

    afterEach(() => {
      rmSync(project, { recursive: true, force: true });
    });

    const write = (relativePath: string, text: string): void => {
      mkdirSync(join(project, relativePath, '..'), { recursive: true });
      writeFileSync(join(project, relativePath), text);
    };

    const aliasSpecifier = ['@kiko', 'dates'].join('/');

    // The probe holds the fixture text the way a harness test would, as a plain string.
    const probeText = (fixture: string): string =>
      `export const fixture = ${JSON.stringify(fixture)};\n\nit('runs', () => undefined);\n`;

    const relatedInProject = (): string[] => {
      write('src/dates/format.ts', 'export const format = 1;\n');
      write('src/dates/index.ts', "export * from './format';\n");

      return harnessTestsRelatedTo(project, { moduleNameMapper: ALIAS_MAPPER }, [
        join(project, 'src/dates/format.ts'),
      ]);
    };

    it('lists a test whose fixture string reads as an import of a src barrel', () => {
      write(
        '__tests__/old-literal.test.ts',
        probeText(`import { DAY_MS } from '${aliasSpecifier}';\n`),
      );

      expect(relatedInProject()).toEqual(['__tests__/old-literal.test.ts']);
    });

    it('lists a test whose fixture string reads as a require of a src barrel', () => {
      write(
        '__tests__/require-literal.test.ts',
        probeText(`const dates = require('${aliasSpecifier}');\n`),
      );

      expect(relatedInProject()).toEqual(['__tests__/require-literal.test.ts']);
    });

    it('does not list a test that builds the specifier at runtime', () => {
      write(
        '__tests__/runtime-specifier.test.ts',
        [
          "const specifier = ['@kiko', 'dates'].join('/');",
          "export const fixture = ['import { DAY_MS } from', specifier].join(' ');",
          '',
          "it('runs', () => undefined);",
          '',
        ].join('\n'),
      );

      expect(relatedInProject()).toEqual([]);
    });
  });
});
