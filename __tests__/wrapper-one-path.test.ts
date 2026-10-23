import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

// A per-file wrapper reads only its first path argument. A second path would be skipped and its
// findings never reported, so the wrapper must refuse the call instead of passing on half of it.
const CHECKS = join(__dirname, '../scripts/checks');

type Run = { status: number | null; stderr: string };

type WrapperCase = {
  wrapper: string;
  title: string;
  relativePath: string;
  goodSource: string;
  badSource: string;
};

// Joined from parts so this file's own text is never a secret-shaped literal.
const SECRET_SHAPED_TOKEN = ['AKIA', 'QYLPMN5HHHFP', 'ZAM2'].join('');

const LONG_COMMENT = `// ${'wrapping '.repeat(16)}end\n`;

const WRAPPER_CASES: WrapperCase[] = [
  {
    wrapper: 'import-order.sh',
    title: 'Import ordering',
    relativePath: 'src/sample.ts',
    goodSource: "import { b } from './b';\nimport { a } from './aaaaaaaa';\n\nexport { a, b };\n",
    badSource: "import { a } from './aaaaaaaa';\nimport { b } from './b';\n\nexport { a, b };\n",
  },
  {
    wrapper: 'full-word-identifiers.sh',
    title: 'Full words in identifiers',
    relativePath: 'src/sample.ts',
    goodSource: 'const transaction = 1;\nexport { transaction };\n',
    badSource: 'const tx = 1;\nexport { tx };\n',
  },
  {
    wrapper: 'comment-line-width.sh',
    title: 'Comment line width',
    relativePath: 'src/sample.ts',
    goodSource: '// short\nexport const value = 1;\n',
    badSource: `${LONG_COMMENT}export const value = 1;\n`,
  },
  {
    wrapper: 'blank-line-separation.sh',
    title: 'Blank line separation',
    relativePath: 'src/sample.ts',
    goodSource: 'export const f = () => {\n  const a = 1;\n\n  return a;\n};\n',
    badSource: 'export const f = () => {\n  const a = 1;\n  return a;\n};\n',
  },
  {
    wrapper: 'feature-imports.sh',
    title: 'Feature import',
    relativePath: 'src/holdings/lots/lots.ts',
    goodSource: "import { thing } from './helpers';\nexport { thing };\n",
    badSource: "import { thing } from '../../currency/money/money';\nexport { thing };\n",
  },
  {
    wrapper: 'screen-imports.sh',
    title: 'Cross-screen import',
    relativePath: `src/${'screens'}/a/forms/x.tsx`,
    goodSource: "import { thing } from './helpers';\nexport { thing };\n",
    badSource: "import { thing } from '../../b/y';\nexport { thing };\n",
  },
  {
    wrapper: 'lint.sh',
    title: 'Biome (lint + format)',
    relativePath: 'src/sample.ts',
    goodSource: 'export const value = 1;\n',
    badSource: 'export const   value  =   1\n',
  },
  {
    wrapper: 'secrets.sh',
    title: 'gitleaks (secret scanning)',
    relativePath: 'src/sample.ts',
    goodSource: 'export const value = 1;\n',
    badSource: `export const accessKey = '${SECRET_SHAPED_TOKEN}';\n`,
  },
];

const writeFixture = (directory: string, relativePath: string, source: string): string => {
  const file = join(directory, relativePath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, source);

  return file;
};

const runWrapper = (wrapper: string, paths: string[]): Run => {
  const result = spawnSync('bash', [join(CHECKS, wrapper), ...paths], {
    cwd: createTemporaryDirectory('wrapper-one-path-cwd-'),
    env: { ...process.env, TMPDIR: createTemporaryDirectory('wrapper-one-path-state-') },
    encoding: 'utf8',
  });

  return { status: result.status, stderr: result.stderr };
};

// Each writer creates its file when called, so a test writes only the files it passes.
const fixtureWriters = (
  wrapperCase: WrapperCase,
): { good: () => string; otherGood: () => string; bad: () => string } => {
  const directory = createTemporaryDirectory('wrapper-one-path-files-');

  return {
    good: () =>
      writeFixture(directory, `first/${wrapperCase.relativePath}`, wrapperCase.goodSource),
    otherGood: () =>
      writeFixture(directory, `second/${wrapperCase.relativePath}`, wrapperCase.goodSource),
    bad: () => writeFixture(directory, `third/${wrapperCase.relativePath}`, wrapperCase.badSource),
  };
};

afterEach(removeTemporaryDirectories);

describe.each(WRAPPER_CASES)('$wrapper', (wrapperCase) => {
  it('refuses a second path, even when the first is clean and only the second is bad', () => {
    const { good, bad } = fixtureWriters(wrapperCase);

    const run = runWrapper(wrapperCase.wrapper, [good(), bad()]);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('CHECK FAILED');
    expect(run.stderr).toContain(wrapperCase.title);
    expect(run.stderr).toMatch(/one path/i);
  });

  it('refuses two clean paths as well, the count is the fault', () => {
    const { good, otherGood } = fixtureWriters(wrapperCase);

    const run = runWrapper(wrapperCase.wrapper, [good(), otherGood()]);

    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/one path/i);
  });

  it('still passes one clean path', () => {
    const { good } = fixtureWriters(wrapperCase);

    expect(runWrapper(wrapperCase.wrapper, [good()]).status).toBe(0);
  });

  it('still fails one bad path on its finding, not on the path count', () => {
    const { bad } = fixtureWriters(wrapperCase);

    const run = runWrapper(wrapperCase.wrapper, [bad()]);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain(wrapperCase.title);
    expect(run.stderr).not.toMatch(/one path/i);
  });
});
