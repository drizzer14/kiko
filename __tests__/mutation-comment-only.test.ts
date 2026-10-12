import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

import {
  mutatedFiles,
  mutateEntries,
  REAL_NODE_MODULES,
  runWithArgumentStub,
  buildMutationRepository,
} from './test-support/mutation-repository';

// scripts/checks/mutation.sh leaves out a changed file whose diff against the base touches only
// comments or whitespace (scripts/checks/comment-only-changes.js decides, from the TypeScript
// parse, failing closed). The filter runs ONCE on the changed list, so Stryker's --mutate, the
// scorer, the cap, the dedup fingerprint and --list all see the same list. The parse cases are
// in comment-only-changes.test.ts; these prove the wrapper's use of the verdict, against a stub
// Stryker. The throwaway repository has no node_modules, so NODE_PATH points the script at the
// worktree's typescript.
const WITH_TYPESCRIPT = { KIKO_MUTATION_BASE: 'main', NODE_PATH: REAL_NODE_MODULES };

const BASE = 'export const a = 1;\n';
const COMMENTED = '// why a is one\nexport const a = 1;\n';
const REAL_CHANGE = 'export const a = 2;\n';

const build = (
  featureFiles: Record<string, string | null>,
  baseFiles: Record<string, string> = {},
): string =>
  buildMutationRepository(
    mkdtempSync(join(tmpdir(), 'kiko-mutation-comment-only-')),
    featureFiles,
    baseFiles,
  ).script;

// Assembled so check:overrides does not read this fixture text as a real directive.
const DIRECTIVE = `// Stryker ${'disable'} next-line all`;

const SKIPPED_LINE = (path: string): string => `skipped (comment-only): ${path}`;

describe('scripts/checks/mutation.sh comment-only filter', () => {
  it.each([
    ['a comment', COMMENTED],
    ['whitespace', 'export   const a =    1;\n\n\n'],
  ])('skips a .ts file that changed only in %s: nothing to mutate, exit 0', (_name, head) => {
    const script = build({ 'src/a.ts': head }, { 'src/a.ts': BASE });

    const result = runWithArgumentStub(script, WITH_TYPESCRIPT);

    expect(result.code).toBe(0);
    expect(result.stubArguments).toBeNull();
    expect(result.stdout).toContain(SKIPPED_LINE('src/a.ts'));
  });

  it.each([
    ['a comment and a code change', BASE, '// now two\nexport const a = 2;\n'],
    ['a Stryker directive', BASE, `${DIRECTIVE}\nexport const a = 1;\n`],
    ['a string literal space', "export const a = 'a b';\n", "export const a = 'a  b';\n"],
    ['a template literal space', 'export const a = `a b`;\n', 'export const a = `a  b`;\n'],
    ['a base that does not parse', 'export const a = ;\n', COMMENTED],
    ['a head that does not parse', BASE, '// broken\nexport const a = ;\n'],
  ])('keeps a .ts file that changed in %s', (_name, base, head) => {
    const script = build({ 'src/a.ts': head }, { 'src/a.ts': base });

    const result = runWithArgumentStub(script, WITH_TYPESCRIPT);

    expect(result.code).toBe(0);
    expect(mutatedFiles(result.stubArguments)).toEqual(['src/a.ts']);
    expect(result.stdout).not.toContain('skipped (comment-only)');
  });

  it.each([
    [
      'a JSX pragma comment',
      'export const A = () => <b />;\n',
      '/** @jsxImportSource other */\nexport const A = () => <b />;\n',
    ],
    [
      'JSX text whitespace',
      'export const A = () => <b>a b</b>;\n',
      'export const A = () => <b>a  b</b>;\n',
    ],
  ])('keeps a .tsx file that changed in %s', (_name, base, head) => {
    const script = build({ 'src/A.tsx': head }, { 'src/A.tsx': base });

    const result = runWithArgumentStub(script, WITH_TYPESCRIPT);

    expect(mutatedFiles(result.stubArguments)).toEqual(['src/A.tsx']);
  });

  it('keeps a new file, even one holding only a comment', () => {
    const script = build({ 'src/new.ts': '// nothing but a comment\n' });

    const result = runWithArgumentStub(script, WITH_TYPESCRIPT);

    expect(mutatedFiles(result.stubArguments)).toEqual(['src/new.ts']);
  });

  it('keeps every file when typescript cannot be loaded', () => {
    const script = build({ 'src/a.ts': COMMENTED }, { 'src/a.ts': BASE });

    // The throwaway repository has no node_modules; an empty NODE_PATH adds none.
    const result = runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main', NODE_PATH: '' });

    expect(mutatedFiles(result.stubArguments)).toEqual(['src/a.ts']);
  });

  describe('a colocated test file that changed in the same change set', () => {
    const TEST_BASE = 'export const t = 1;\n';
    const TEST_COMMENTED = '// what t checks\nexport const t = 1;\n';
    const TEST_REAL_CHANGE = 'export const t = 2;\n';
    const KEPT_LINE = (path: string): string => `kept (colocated test changed): ${path}`;

    const runBeside = (testPath: string, testHead: string | null, testExistsAtBase = true) =>
      runWithArgumentStub(
        build(
          { 'src/foo.ts': COMMENTED, [testPath]: testHead },
          { 'src/foo.ts': BASE, ...(testExistsAtBase ? { [testPath]: TEST_BASE } : {}) },
        ),
        WITH_TYPESCRIPT,
      );

    it.each([
      ['foo.test.ts', 'src/foo.test.ts'],
      ['foo.test.tsx', 'src/foo.test.tsx'],
      ['foo.<anything>.test.tsx', 'src/foo.extra.test.tsx'],
      ['foo.<anything>.test.ts', 'src/foo.ledgerless-guard.test.ts'],
    ])('keeps the source file when %s has a code change', (_name, testPath) => {
      const result = runBeside(testPath, TEST_REAL_CHANGE);

      expect(mutatedFiles(result.stubArguments)).toEqual(['src/foo.ts']);
      expect(result.stdout).toContain(KEPT_LINE('src/foo.ts'));
      expect(result.stdout).not.toContain('skipped (comment-only)');
    });

    it('hands Stryker the kept file as its plain path and never as a range too', () => {
      const result = runBeside('src/foo.test.ts', TEST_REAL_CHANGE);

      // Stryker reads a plain path beside a range of the same file as "do not mutate" it, and the
      // comment lines of this file hold no mutant, so a range would also lose the rule.
      expect(mutateEntries(result.stubArguments)).toEqual(['src/foo.ts']);
    });

    it('skips the source file when the colocated test changed only in a comment', () => {
      const result = runBeside('src/foo.test.ts', TEST_COMMENTED);

      expect(result.stubArguments).toBeNull();
      expect(result.stdout).toContain(SKIPPED_LINE('src/foo.ts'));
      expect(result.stdout).not.toContain('kept (colocated test changed)');
    });

    it('keeps the source file when the colocated test is new', () => {
      const result = runBeside('src/foo.test.ts', TEST_COMMENTED, false);

      expect(mutatedFiles(result.stubArguments)).toEqual(['src/foo.ts']);
    });

    it('keeps the source file when the colocated test was deleted', () => {
      const result = runBeside('src/foo.test.ts', null);

      expect(mutatedFiles(result.stubArguments)).toEqual(['src/foo.ts']);
    });

    it('keeps the source file when the colocated test no longer parses', () => {
      const result = runBeside('src/foo.test.ts', '// broken\nexport const t = ;\n');

      expect(mutatedFiles(result.stubArguments)).toEqual(['src/foo.ts']);
    });

    it('keeps the source file when one of two colocated tests has a code change', () => {
      const result = runWithArgumentStub(
        build(
          {
            'src/foo.ts': COMMENTED,
            'src/foo.test.ts': TEST_COMMENTED,
            'src/foo.extra.test.ts': TEST_REAL_CHANGE,
          },
          { 'src/foo.ts': BASE, 'src/foo.test.ts': TEST_BASE, 'src/foo.extra.test.ts': TEST_BASE },
        ),
        WITH_TYPESCRIPT,
      );

      expect(mutatedFiles(result.stubArguments)).toEqual(['src/foo.ts']);
    });

    it.each([
      ['a test file of the same base name in another folder', 'src/other/foo.test.ts'],
      ['a test file in __tests__', '__tests__/foo.test.ts'],
      ['a test file of a longer base name', 'src/foobar.test.ts'],
      ['a test file of a folder named like the source', 'src/foo.d/bar.test.ts'],
    ])('skips the source file for %s', (_name, testPath) => {
      const result = runBeside(testPath, TEST_REAL_CHANGE);

      expect(result.stubArguments).toBeNull();
      expect(result.stdout).toContain(SKIPPED_LINE('src/foo.ts'));
    });

    it('--list names the kept file and says why', () => {
      const listed = runWithArgumentStub(
        build(
          { 'src/foo.ts': COMMENTED, 'src/foo.test.ts': TEST_REAL_CHANGE },
          { 'src/foo.ts': BASE, 'src/foo.test.ts': TEST_BASE },
        ),
        WITH_TYPESCRIPT,
        ['--list'],
      );

      expect(listed.code).toBe(0);
      expect(listed.stdout.split('\n').filter(Boolean)).toEqual([
        'src/foo.ts',
        KEPT_LINE('src/foo.ts'),
        'mutable files: 1 (cap 30)',
      ]);
    });
  });

  it('keeps a comment-only file whose colocated test has a non-ASCII name and a code change', () => {
    const listed = runWithArgumentStub(
      build(
        { 'src/nonascii/foo.ts': COMMENTED, 'src/nonascii/foo.тест.test.ts': REAL_CHANGE },
        { 'src/nonascii/foo.ts': BASE, 'src/nonascii/foo.тест.test.ts': BASE },
      ),
      WITH_TYPESCRIPT,
      ['--list'],
    );

    expect(listed.code).toBe(0);
    expect(listed.stdout.split('\n').filter(Boolean)).toEqual([
      'src/nonascii/foo.ts',
      'kept (colocated test changed): src/nonascii/foo.ts',
      'mutable files: 1 (cap 30)',
    ]);
  });

  describe('a mixed change set: two comment-only files and one real change', () => {
    const files = {
      'src/commented-one.ts': COMMENTED,
      'src/commented-two.ts': '/* two */\nexport const a = 1;\n',
      'src/real.ts': REAL_CHANGE,
    };
    const baseFiles = {
      'src/commented-one.ts': BASE,
      'src/commented-two.ts': BASE,
      'src/real.ts': BASE,
    };

    it('hands Stryker exactly the real file, and the scorer exactly the same one', () => {
      const result = runWithArgumentStub(build(files, baseFiles), WITH_TYPESCRIPT);

      expect(result.code).toBe(0);
      expect(mutatedFiles(result.stubArguments)).toEqual(['src/real.ts']);
      // The scorer's own scope check fails the run on any difference from the report's scope,
      // which the stub writes from the --mutate list; its table has one row per file it graded.
      expect(result.stdout).toMatch(/^src\/real\.ts: 100\.00 /m);
      expect(result.stdout).not.toMatch(/^src\/commented-/m);
      expect(
        mutateEntries(result.stubArguments).some((entry) => entry.startsWith('src/commented-')),
      ).toBe(false);
      expect(result.stdout).toContain(SKIPPED_LINE('src/commented-one.ts'));
      expect(result.stdout).toContain(SKIPPED_LINE('src/commented-two.ts'));
    });

    it('--list prints the kept file, the skipped lines, and a count of mutated files only', () => {
      const result = runWithArgumentStub(build(files, baseFiles), WITH_TYPESCRIPT, ['--list']);

      expect(result.code).toBe(0);
      expect(result.stdout.split('\n').filter(Boolean)).toEqual([
        'src/real.ts',
        SKIPPED_LINE('src/commented-one.ts'),
        SKIPPED_LINE('src/commented-two.ts'),
        'mutable files: 1 (cap 30)',
      ]);
      expect(result.stubArguments).toBeNull();
    });
  });

  it('--list says so when every changed file is comment-only', () => {
    const script = build({ 'src/a.ts': COMMENTED }, { 'src/a.ts': BASE });

    const result = runWithArgumentStub(script, WITH_TYPESCRIPT, ['--list']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(SKIPPED_LINE('src/a.ts'));
    expect(result.stdout).toContain('mutable files: 0 (cap 30)');
    expect(result.stdout).toContain('every changed source file is comment-only');
  });

  it('counts the cap on the filtered list: 33 changed files, 3 comment-only, run', () => {
    const baseFiles = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`src/file-${index}.ts`, BASE]),
    );
    const featureFiles = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [
        `src/file-${index}.ts`,
        index < 3 ? COMMENTED : `export const a = ${index + 2};\n`,
      ]),
    );

    const result = runWithArgumentStub(build(featureFiles, baseFiles), WITH_TYPESCRIPT);

    expect(result.code).toBe(0);
    expect(mutatedFiles(result.stubArguments)).toHaveLength(30);
  });

  it('still refuses above the cap when the comment-only files do not bring it down', () => {
    const baseFiles = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [`src/file-${index}.ts`, BASE]),
    );
    const featureFiles = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [
        `src/file-${index}.ts`,
        index < 1 ? COMMENTED : `export const a = ${index + 2};\n`,
      ]),
    );

    const result = runWithArgumentStub(build(featureFiles, baseFiles), WITH_TYPESCRIPT);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('31 files would be mutated (> 30).');
    expect(result.stubArguments).toBeNull();
  });
});
