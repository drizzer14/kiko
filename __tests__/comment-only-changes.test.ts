import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { buildMutationRepository } from './test-support/mutation-repository';

// scripts/checks/comment-only-changes.js decides, from the TypeScript compiler's own
// parse, which changed files differ from the base ONLY in comments or whitespace, so the
// mutation gate leaves them out. It prints a path only when it PROVED the file comment-only:
// every doubt keeps the file. These spawn the real script in a throwaway git repository,
// one spawn for the whole table, because loading the compiler dominates the cost.
const SCRIPT = join(__dirname, '../scripts/checks/comment-only-changes.js');

type Change = { base: string; head: string | null; skipped: boolean };

// Assembled so check:overrides does not read this fixture text as a real directive.
const DIRECTIVE = `// Stryker ${'disable'} next-line all`;

const CHANGES: Record<string, Change> = {
  'src/line-comment-added.ts': {
    base: 'export const a = 1;\n',
    head: '// why a is one\nexport const a = 1;\n',
    skipped: true,
  },
  'src/block-comment-added.ts': {
    base: 'export const a = 1;\n',
    head: '/* why a is one */\nexport const a = 1;\n',
    skipped: true,
  },
  'src/jsdoc-added.ts': {
    base: 'export function f(x: number) {\n  return x;\n}\n',
    head: '/**\n * Returns x.\n * @param x the value\n */\nexport function f(x: number) {\n  return x;\n}\n',
    skipped: true,
  },
  'src/comment-removed.ts': {
    base: 'export const a = 1; // trailing\n/* gone */\n',
    head: 'export const a = 1;\n',
    skipped: true,
  },
  'src/comment-reworded.ts': {
    base: '// the old wording\nexport const a = 1;\n',
    head: '// the new wording\nexport const a = 1;\n',
    skipped: true,
  },
  'src/comment-inside-expression.ts': {
    base: 'export const a = 1 + 2;\n',
    head: 'export const a = 1 /* one */ + /* two */ 2;\n',
    skipped: true,
  },
  'src/indentation.ts': {
    base: 'export function f() {\nreturn 1;\n}\n',
    head: 'export function f() {\n    return 1;\n}\n',
    skipped: true,
  },
  'src/blank-lines.ts': {
    base: 'export const a = 1;\nexport const b = 2;\n',
    head: 'export const a = 1;\n\n\nexport const b = 2;\n\n',
    skipped: true,
  },
  'src/operator-spacing.ts': {
    base: 'export const a = 1+2;\n',
    head: 'export const a = 1  +   2;\n',
    skipped: true,
  },
  'src/object-reflow.ts': {
    base: 'export const a = { x: 1, y: [1, 2] };\n',
    head: 'export const a = {\n  x: 1,\n  y: [\n    1,\n    2\n  ]\n};\n',
    skipped: true,
  },
  'src/screen.tsx': {
    base: 'export const A = () => <b a="1">text</b>;\n',
    head: '// the screen\nexport const A = () =>\n  <b\n    // the attribute\n    a="1"\n  >text</b>;\n',
    skipped: true,
  },
  // A formatter's trailing comma or parentheses are a token and a node: kept, never guessed.
  'src/trailing-comma.ts': {
    base: 'export const a = [1, 2];\n',
    head: 'export const a = [1, 2,];\n',
    skipped: false,
  },
  'src/parentheses.ts': {
    base: 'export const a = 1 + 2;\n',
    head: 'export const a = (1 + 2);\n',
    skipped: false,
  },
  'src/comment-and-code.ts': {
    base: 'export const a = 1;\n',
    head: '// now two\nexport const a = 2;\n',
    skipped: false,
  },
  'src/stryker-directive.ts': {
    base: 'export const a = 1 + 2;\n',
    head: `${DIRECTIVE}\nexport const a = 1 + 2;\n`,
    skipped: false,
  },
  'src/stryker-directive-moved.ts': {
    base: `${DIRECTIVE}\nexport const a = 1 + 2;\n`,
    head: `${DIRECTIVE}\n\nexport const a = 1 + 2;\n`,
    skipped: false,
  },
  'src/jsx-pragma.tsx': {
    base: 'export const A = () => <b />;\n',
    head: '/** @jsxImportSource other */\nexport const A = () => <b />;\n',
    skipped: false,
  },
  'src/jsx-pragma-removed.tsx': {
    base: '/** @jsx h */\nexport const A = () => <b />;\n',
    head: 'export const A = () => <b />;\n',
    skipped: false,
  },
  'src/string-space.ts': {
    base: "export const a = 'a b';\n",
    head: "export const a = 'a  b';\n",
    skipped: false,
  },
  'src/string-quotes.ts': {
    base: "export const a = 'ab';\n",
    head: 'export const a = "ab";\n',
    skipped: false,
  },
  'src/template-space.ts': {
    base: 'export const a = `a b`;\n',
    head: 'export const a = `a  b`;\n',
    skipped: false,
  },
  'src/template-substitution-space.ts': {
    base: `export const f = (x: number) => \`a \${x} b\`;\n`,
    head: `export const f = (x: number) => \`a \${x}  b\`;\n`,
    skipped: false,
  },
  'src/template-newline.ts': {
    base: 'export const a = `a\nb`;\n',
    head: 'export const a = `a\n\nb`;\n',
    skipped: false,
  },
  'src/regex-space.ts': {
    base: 'export const a = /a b/;\n',
    head: 'export const a = /a  b/;\n',
    skipped: false,
  },
  'src/jsx-text-inner.tsx': {
    base: 'export const A = () => <b>a b</b>;\n',
    head: 'export const A = () => <b>a  b</b>;\n',
    skipped: false,
  },
  'src/jsx-text-leading.tsx': {
    base: 'export const A = () => <b> a</b>;\n',
    head: 'export const A = () => <b>a</b>;\n',
    skipped: false,
  },
  'src/jsx-text-trailing.tsx': {
    base: 'export const A = () => <b>a</b>;\n',
    head: 'export const A = () => <b>a </b>;\n',
    skipped: false,
  },
  'src/jsx-text-line-break.tsx': {
    base: 'export const A = () => <b>a</b>;\n',
    head: 'export const A = () => (\n  <b>\n    a\n  </b>\n);\n',
    skipped: false,
  },
  'src/jsx-attribute-string.tsx': {
    base: 'export const A = () => <b a="x y" />;\n',
    head: 'export const A = () => <b a="x  y" />;\n',
    skipped: false,
  },
  'src/numeric-respelling.ts': {
    base: 'export const a = 1000;\n',
    head: 'export const a = 1e3;\n',
    skipped: false,
  },
  'src/numeric-separator.ts': {
    base: 'export const a = 1000;\n',
    head: 'export const a = 1_000;\n',
    skipped: false,
  },
  'src/semicolon-added.ts': {
    base: 'export const a = 1\n',
    head: 'export const a = 1;\n',
    skipped: false,
  },
  'src/unary-operator.ts': {
    base: 'export const f = (x: number) => -x;\n',
    head: 'export const f = (x: number) => +x;\n',
    skipped: false,
  },
  // A line break before the operand ends the `return`: same tokens, different program.
  'src/return-line-break.ts': {
    base: 'export function f(x: number) {\n  return x;\n}\n',
    head: 'export function f(x: number) {\n  return\n  x;\n}\n',
    skipped: false,
  },
  'src/postfix-line-break.ts': {
    base: 'let a = 1;\nlet b = 1;\na++;\n',
    head: 'let a = 1;\nlet b = 1;\na\n++\nb;\n',
    skipped: false,
  },
  'src/base-does-not-parse.ts': {
    base: 'export const a = ;\n',
    head: '// fixed\nexport const a = 1;\n',
    skipped: false,
  },
  'src/head-does-not-parse.ts': {
    base: 'export const a = 1;\n',
    head: '// broken\nexport const a = ;\n',
    skipped: false,
  },
  'src/new-file.ts': { base: '', head: '// only a comment\n', skipped: false },
  'src/deleted-file.ts': { base: 'export const a = 1;\n', head: null, skipped: false },
  'src/identical.ts': {
    base: 'export const a = 1;\n',
    head: 'export const a = 1;\n',
    skipped: false,
  },
  'src/not-typescript.js': {
    base: 'export const a = 1;\n',
    head: '// a comment\nexport const a = 1;\n',
    skipped: false,
  },
  'src/not-source.json': { base: '{"a":1}\n', head: '{"a": 1}\n', skipped: false },
};

// A file with no base body exists only on the feature branch.
const baseFiles = Object.fromEntries(
  Object.entries(CHANGES)
    .filter(([, change]) => change.base !== '')
    .map(([path, change]) => [path, change.base]),
);
const featureFiles = Object.fromEntries(
  Object.entries(CHANGES).map(([path, change]) => [path, change.head]),
);

type ScriptRun = { code: number | null; stdout: string; stderr: string };

const run = (
  root: string,
  scriptArguments: string[],
  environment: Record<string, string> = {},
): ScriptRun => {
  const result = spawnSync('node', [SCRIPT, ...scriptArguments], {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
  });

  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const lines = (text: string): string[] => text.split('\n').filter(Boolean);

describe('scripts/checks/comment-only-changes.js', () => {
  const { root } = buildMutationRepository(
    mkdtempSync(join(tmpdir(), 'kiko-comment-only-')),
    // The renamed file is passed under its new name, which the base does not have.
    {
      ...featureFiles,
      'src/renamed-new.ts': '// moved\nexport const a = 1;\n',
      'src/renamed-old.ts': null,
    },
    { ...baseFiles, 'src/renamed-old.ts': 'export const a = 1;\n' },
  );
  const paths = [...Object.keys(CHANGES), 'src/renamed-new.ts'];
  const { code, stdout } = run(root, ['main', ...paths]);
  const printed = new Set(lines(stdout));

  it('exits 0 after a run over every change', () => {
    expect(code).toBe(0);
  });

  it.each(Object.entries(CHANGES))('%s: decides the change', (path, change) => {
    expect(printed.has(path)).toBe(change.skipped);
  });

  it('keeps a renamed file: its new path is absent at the base', () => {
    expect(printed.has('src/renamed-new.ts')).toBe(false);
  });

  it('prints only paths it was given, once each, one per line', () => {
    expect([...printed].every((path) => paths.includes(path))).toBe(true);
    expect(lines(stdout)).toHaveLength(printed.size);
  });

  it('prints nothing when typescript cannot be loaded', () => {
    const result = run(root, ['main', ...paths], { KIKO_TYPESCRIPT_MODULE: '/nonexistent/ts' });

    expect(result.stdout).toBe('');
  });

  it('prints nothing when the base does not resolve', () => {
    const result = run(root, ['no-such-base', ...paths]);

    expect(result.stdout).toBe('');
  });

  it('exits 2 with a usage line when it is given no base', () => {
    const result = run(root, []);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('usage');
  });
});
