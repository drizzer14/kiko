import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/import-order.sh mechanizes kiko-code-style's "Import
// ordering" rule (hand-enforced, not covered by Biome — see biome.json's
// organizeImports: "off"). Spawns the real wrapper against fixture files on
// disk (the __tests__/kill-guard.test.ts pattern), rather than importing
// scripts/checks/import-order.js's internals directly.
const SCRIPT = join(__dirname, '../scripts/checks/import-order.sh');
const ANALYZER = join(__dirname, '../scripts/checks/import-order.js');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'import-order-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const runCheck = (source: string): SpawnSyncReturns<string> => {
  const file = join(dir, 'fixture.ts');
  writeFileSync(file, source);

  return spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });
};

describe('scripts/checks/import-order.sh', () => {
  it('passes a group already sorted ascending by ending-line length', () => {
    const result = runCheck(
      "import { type FC, useEffect } from 'react';\n" +
        "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
        '\n' +
        'export const Foo = 1;\n',
    );

    expect(result.status).toBe(0);
  });

  it('fails a group sorted descending by ending-line length', () => {
    const result = runCheck(
      "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
        "import { type FC, useEffect } from 'react';\n" +
        '\n' +
        'export const Foo = 1;\n',
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Import ordering');
  });

  it('does not reorder across a bare side-effect import barrier', () => {
    const result = runCheck(
      "import { aVeryLongIdentifierName } from 'some-external-package-name';\n" +
        "import '../../design-system/unistyles';\n" +
        "import { x } from 'y';\n" +
        '\n' +
        'export const Foo = 1;\n',
    );

    expect(result.status).toBe(0);
  });

  // I3: a jest.mock prelude (a `let` the mock factory closes over, then the
  // mock call itself) sits before the real import block in real test files
  // (settings.repo.test.ts, holdings.repo.test.ts). The checker must look
  // PAST that prelude for the import header, not stop at the first
  // non-blank/comment/import line and conclude there is nothing to check.
  it('checks the import block even when a jest.mock prelude precedes it', () => {
    const result = runCheck(
      'let mockTransaction: unknown;\n' +
        "jest.mock('../db/client', () => {\n" +
        '  return { mockTransaction };\n' +
        '});\n' +
        '\n' +
        "import { aVeryLongIdentifierNameHere } from 'some-external-package-name';\n" +
        "import { x } from 'y';\n" +
        '\n' +
        'export const Foo = 1;\n',
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Import ordering');
  });

  it('passes a correctly-sorted import block behind a jest.mock prelude', () => {
    const result = runCheck(
      'let mockTransaction: unknown;\n' +
        "jest.mock('../db/client', () => {\n" +
        '  return { mockTransaction };\n' +
        '});\n' +
        '\n' +
        "import { x } from 'y';\n" +
        "import { aVeryLongIdentifierNameHere } from 'some-external-package-name';\n" +
        '\n' +
        'export const Foo = 1;\n',
    );

    expect(result.status).toBe(0);
  });

  it('exits 0 on a non-.ts/.tsx file', () => {
    const file = join(dir, 'fixture.md');
    writeFileSync(file, '# not typescript\n');

    const result = spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });

    expect(result.status).toBe(0);
  });

  describe('project-wide mode (no file argument)', () => {
    it('exits 0 when IMPORT_ORDER_SRC_ROOT holds no violation', () => {
      writeFileSync(
        join(dir, 'clean.ts'),
        "import { type FC, useEffect } from 'react';\n" +
          "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
          '\n' +
          'export const Foo = 1;\n',
      );

      const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, IMPORT_ORDER_SRC_ROOT: dir },
      });

      expect(result.status).toBe(0);
    });

    it('exits 2 when IMPORT_ORDER_SRC_ROOT holds a violation', () => {
      writeFileSync(
        join(dir, 'bad.ts'),
        "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
          "import { type FC, useEffect } from 'react';\n" +
          '\n' +
          'export const Foo = 1;\n',
      );

      const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, IMPORT_ORDER_SRC_ROOT: dir },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Import ordering');
    });
  });
});

describe('scripts/checks/import-order.js --write', () => {
  const write = (source: string): string => {
    const file = join(dir, 'fixture.ts');
    writeFileSync(file, source);
    spawnSync('node', [ANALYZER, '--write', file], { encoding: 'utf8' });

    return readFileSync(file, 'utf8');
  };

  it('reorders a descending group ascending by ending-line length', () => {
    const fixed = write(
      "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
        "import { type FC, useEffect } from 'react';\n" +
        '\n' +
        'export const Foo = 1;\n',
    );

    expect(fixed).toBe(
      "import { type FC, useEffect } from 'react';\n" +
        "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
        '\n' +
        'export const Foo = 1;\n',
    );
  });

  it('pins a file-header comment above the first import, even when that import moves', () => {
    const fixed = write(
      '// A file header explaining this module.\n' +
        "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
        "import { type FC, useEffect } from 'react';\n" +
        '\n' +
        'export const Foo = 1;\n',
    );

    expect(fixed).toBe(
      '// A file header explaining this module.\n' +
        "import { type FC, useEffect } from 'react';\n" +
        "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
        '\n' +
        'export const Foo = 1;\n',
    );
  });

  it('leaves a group with a comment glued to a non-first import untouched', () => {
    const source =
      "import { type FC, useEffect } from 'react';\n" +
      '// explains the next import specifically\n' +
      "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
      '\n' +
      'export const Foo = 1;\n';

    expect(write(source)).toBe(source);
  });

  it('never reorders a bare side-effect import across the barrier it sits behind', () => {
    const source =
      "import { aVeryLongIdentifierName } from 'some-external-package-name';\n" +
      "import '../../design-system/unistyles';\n" +
      "import { x } from 'y';\n" +
      '\n' +
      'export const Foo = 1;\n';

    expect(write(source)).toBe(source);
  });

  // C1 regression: a group of comments with NO import in it (a header block
  // followed directly by another comment block, with no import between them —
  // src/navigation/types.d.ts is the live shape) must never be silently
  // dropped when an unrelated earlier group in the same file DOES need
  // reordering (which is what flips fixImportOrder's file-level `changed`
  // flag and triggers the rewrite).
  it('never drops a second comment block trailing an unsorted group', () => {
    const source =
      "import { Gesture, GestureDetector } from 'react-native-gesture-handler';\n" +
      "import a from 'a';\n" +
      '\n' +
      '// note about X\n' +
      '/** JSDoc for X */\n' +
      'export const X = 1;\n';

    const fixed = write(source);

    expect(fixed).toContain('// note about X');
    expect(fixed).toContain('/** JSDoc for X */');
  });

  // Property: for every fixture above, --write only ever reorders lines — it
  // never loses or invents one. Sorting a multiset-equal line array proves
  // nothing was dropped or duplicated, independent of what order they land in.
  describe('permutation property (no line lost or gained)', () => {
    const fixtures = [
      "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
        "import { type FC, useEffect } from 'react';\n" +
        '\n' +
        'export const Foo = 1;\n',
      '// A file header explaining this module.\n' +
        "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
        "import { type FC, useEffect } from 'react';\n" +
        '\n' +
        'export const Foo = 1;\n',
      "import { type FC, useEffect } from 'react';\n" +
        '// explains the next import specifically\n' +
        "import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';\n" +
        '\n' +
        'export const Foo = 1;\n',
      "import { aVeryLongIdentifierName } from 'some-external-package-name';\n" +
        "import '../../design-system/unistyles';\n" +
        "import { x } from 'y';\n" +
        '\n' +
        'export const Foo = 1;\n',
      "import { Gesture, GestureDetector } from 'react-native-gesture-handler';\n" +
        "import a from 'a';\n" +
        '\n' +
        '// note about X\n' +
        '/** JSDoc for X */\n' +
        'export const X = 1;\n',
      'let mockTransaction: unknown;\n' +
        "jest.mock('../db/client', () => {\n" +
        '  return { mockTransaction };\n' +
        '});\n' +
        '\n' +
        "import { aVeryLongIdentifierNameHere } from 'some-external-package-name';\n" +
        "import { x } from 'y';\n" +
        '\n' +
        'export const Foo = 1;\n',
      '// A file with no import at all.\nexport const Foo = 1;\n',
    ];

    it.each(fixtures.map((source, index) => [index, source] as const))(
      'fixture %i: output is a permutation of the input lines',
      (_index, source) => {
        const fixed = write(source);

        expect(fixed.split('\n').sort()).toEqual(source.split('\n').sort());
      },
    );
  });
});
