import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

import {
  mutatedFiles,
  REAL_TYPESCRIPT,
  runWithArgumentStub,
  buildMutationRepository,
} from './test-support/mutation-repository';

// scripts/checks/mutation.sh leaves out a changed file whose diff against the base touches only
// comments or whitespace (scripts/checks/comment-only-changes.js decides, from the TypeScript
// parse, failing closed). The filter runs ONCE on the changed list, so Stryker's --mutate, the
// scorer, the cap, the dedup fingerprint and --list all see the same list. The parse cases are
// in comment-only-changes.test.ts; these prove the wrapper's use of the verdict, against a stub
// Stryker. The throwaway repository has no node_modules, so the seam points the script at the
// worktree's typescript.
const WITH_TYPESCRIPT = { KIKO_MUTATION_BASE: 'main', KIKO_TYPESCRIPT_MODULE: REAL_TYPESCRIPT };

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

    const result = runWithArgumentStub(script, {
      ...WITH_TYPESCRIPT,
      KIKO_TYPESCRIPT_MODULE: '/nonexistent/typescript',
    });

    expect(mutatedFiles(result.stubArguments)).toEqual(['src/a.ts']);
  });

  it('keeps every file when the throwaway repository has no typescript of its own', () => {
    const script = build({ 'src/a.ts': COMMENTED }, { 'src/a.ts': BASE });

    const result = runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' });

    expect(mutatedFiles(result.stubArguments)).toEqual(['src/a.ts']);
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
