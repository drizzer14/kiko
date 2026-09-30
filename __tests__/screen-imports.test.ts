import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

// scripts/checks/screen-imports.sh mechanizes the pre-write-guard design
// spec's rule 12 ("No import from another screen's folder"): a file under
// `src/screens/<screen-a>/` must not import from `src/screens/<screen-b>/**`
// for any `screen-b !== screen-a`. This is a Node check, not a Semgrep
// rule — Semgrep has no way to resolve a RELATIVE specifier
// (`../../b/y`) against the importing file's own path, which is exactly
// what deciding "screen-a" vs "screen-b" requires.
const SCRIPT = join(__dirname, '../scripts/checks/screen-imports.sh');
const ANALYZER = join(__dirname, '../scripts/checks/screen-imports.js');

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'screen-imports-test-'));
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

function runCheck(file: string): SpawnSyncReturns<string> {
  return spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });
}

describe('scripts/checks/screen-imports.sh', () => {
  it("flags src/screens/a/forms/x.tsx importing '../../b/y'", () => {
    const file = writeFixture('src/screens/a/forms/x.tsx', "import { Thing } from '../../b/y';\n");

    const result = runCheck(file);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Cross-screen import');
  });

  it("flags an '@kiko/screens/b/...' alias import from screen a", () => {
    // Built via interpolation, not a single quoted literal, so this
    // fixture's own text never reads as a real cross-layer import to
    // kiko-no-import-screens-outside-ui (rules/semgrep-mobile.yml), which
    // pattern-matches raw source text and cannot tell a FIXTURE string
    // apart from real code.
    const aliasSpecifier = `@kiko/${'screens'}/b/thing`;
    const file = writeFixture(
      'src/screens/a/x.tsx',
      `import { Thing } from '${aliasSpecifier}';\n`,
    );

    const result = runCheck(file);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Cross-screen import');
  });

  it('allows imports within the same screen folder at any depth', () => {
    const file = writeFixture(
      'src/screens/a/sub/deep/x.tsx',
      "import { Thing } from '../../other/y';\n",
    );

    const result = runCheck(file);

    expect(result.status).toBe(0);
  });

  it('allows imports from outside src/screens', () => {
    const file = writeFixture(
      'src/screens/a/x.tsx',
      "import { Button } from '../../design-system/button';\n",
    );

    const result = runCheck(file);

    expect(result.status).toBe(0);
  });

  it('ignores import text inside comments and strings', () => {
    const file = writeFixture(
      'src/screens/a/forms/x.tsx',
      [
        "// import { Thing } from '../../b/y';",
        'const message = "import { Thing } from \'../../b/y\';";',
        'export const value = 1;',
        '',
      ].join('\n'),
    );

    const result = runCheck(file);

    expect(result.status).toBe(0);
  });

  it('flags a jest.mock(...) of a sibling screen module', () => {
    const file = writeFixture('src/screens/a/forms/x.test.tsx', "jest.mock('../../b/y');\n");

    const result = runCheck(file);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Cross-screen import');
  });

  it('exits 0 on a non-.ts/.tsx file', () => {
    const file = writeFixture('src/screens/a/notes.md', '# not typescript\n');

    const result = runCheck(file);

    expect(result.status).toBe(0);
  });

  describe('project-wide mode (no file argument)', () => {
    it('exits 0 when SCREEN_IMPORTS_SOURCE_ROOT holds no violation', () => {
      writeFixture('src/screens/a/x.tsx', "import { Button } from '../../design-system/button';\n");

      const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, SCREEN_IMPORTS_SOURCE_ROOT: directory },
      });

      expect(result.status).toBe(0);
    });

    it('exits 2 when SCREEN_IMPORTS_SOURCE_ROOT holds a violation', () => {
      writeFixture('src/screens/a/forms/x.tsx', "import { Thing } from '../../b/y';\n");

      const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, SCREEN_IMPORTS_SOURCE_ROOT: directory },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Cross-screen import');
    });
  });
});

describe('scripts/checks/screen-imports.js output shape', () => {
  it('prints <path>:<line>: <specifier>', () => {
    const file = writeFixture('src/screens/a/forms/x.tsx', "import { Thing } from '../../b/y';\n");

    const result = spawnSync('node', [ANALYZER, file], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${file}:1: ../../b/y\n`);
  });

  // A backtick that ends a comment is not a string before the regex on the
  // next line: reading it as one leaves the regex's own backtick to open a
  // template that swallows the rest of the file.
  it('sees a require after a regex whose comment line ends in a backtick', () => {
    const file = writeFixture(
      'src/screens/a/forms/x.tsx',
      [
        'const P = [',
        '  // a code span like `x`',
        '  /`/,',
        '];',
        "const m = require('../../b/y');",
        '',
      ].join('\n'),
    );

    const result = spawnSync('node', [ANALYZER, file], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${file}:5: ../../b/y\n`);
  });
});
