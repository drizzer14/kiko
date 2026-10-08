import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// scripts/checks/blank-line-separation.sh mechanizes kiko-code-style's
// "Blank lines before statement blocks" and "Blank line between adjacent
// JSX sibling nodes" sections — a hand-applied rule until now, not covered
// by Biome (whitespace-insensitive inside JSX, and no rule for a bare
// statement blank line either). Spawns the real wrapper against fixture
// files on disk, the __tests__/import-order.test.ts pattern this file is
// modeled on. Guard mode only (the pre-write-guard.js wiring below) — this
// checker is not yet part of check:all, so it never sweeps the existing
// tree.
const SCRIPT = join(__dirname, '../scripts/checks/blank-line-separation.sh');
const ANALYZER = join(__dirname, '../scripts/checks/blank-line-separation.js');

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'blank-line-separation-test-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const runCheck = (source: string): SpawnSyncReturns<string> => {
  const file = join(directory, 'fixture.ts');
  writeFileSync(file, source);

  return spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });
};

describe('scripts/checks/blank-line-separation.sh', () => {
  it('flags return/if/for/while preceded by a non-blank line', () => {
    const result = runCheck(
      'function foo() {\n' + '  const value = 1;\n' + '  return value;\n' + '}\n',
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Blank line separation');
  });

  it('does not flag the first statement of a block', () => {
    const result = runCheck('function foo() {\n' + '  return 1;\n' + '}\n');

    expect(result.status).toBe(0);
  });

  it('does not flag a statement preceded by a comment line', () => {
    const result = runCheck(
      'function foo() {\n' +
        '  const value = 1;\n' +
        '  // explains the return\n' +
        '  return value;\n' +
        '}\n',
    );

    expect(result.status).toBe(0);
  });

  it('ignores return/if text inside strings, templates, comments, regex', () => {
    const result = runCheck(
      '/*\n' +
        'if (x) {\n' +
        '  return y;\n' +
        '}\n' +
        '*/\n' +
        'const message = `\n' +
        '  return early\n' +
        '`;\n' +
        'const pattern = /return/;\n' +
        '\n' +
        'function foo() {\n' +
        '  const value = 1;\n' +
        '\n' +
        '  return value;\n' +
        '}\n',
    );

    expect(result.status).toBe(0);
  });

  it('flags two adjacent JSX siblings with no blank line', () => {
    const result = runCheck(
      'function Component() {\n' +
        '  return (\n' +
        '    <View>\n' +
        '      <Text>A</Text>\n' +
        '      <Text>B</Text>\n' +
        '      <Text>C</Text>\n' +
        '    </View>\n' +
        '  );\n' +
        '}\n',
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Blank line separation');
  });

  it('does not flag an only-two-children pair or a comment-separated pair', () => {
    const twoChildren = runCheck(
      'function Component() {\n' +
        '  return (\n' +
        '    <View>\n' +
        '      <Text>A</Text>\n' +
        '      <Text>B</Text>\n' +
        '    </View>\n' +
        '  );\n' +
        '}\n',
    );

    expect(twoChildren.status).toBe(0);

    const commentSeparated = runCheck(
      'function Component() {\n' +
        '  return (\n' +
        '    <View>\n' +
        '      <Text>A</Text>\n' +
        '      {/* separates A and B */}\n' +
        '      <Text>B</Text>\n' +
        '      {/* separates B and C */}\n' +
        '      <Text>C</Text>\n' +
        '    </View>\n' +
        '  );\n' +
        '}\n',
    );

    expect(commentSeparated.status).toBe(0);
  });

  it('flags an if preceded by a non-blank line even when an earlier regex literal contains a quote', () => {
    // src/db/schema.category-overrides.test.ts's real shape: a regex literal
    // holding `'`s (matched against `'([^']+)'` groups) must not flip the
    // scanner's string-quote parity: a flipped parity swallows this `if`
    // clean out of the scan, so the missing blank line above it is never
    // reported.
    const result = runCheck(
      'function applyGuardedIconUpdate(sql) {\n' +
        '  const match = sql.match(\n' +
        "    /UPDATE `[a-z_]+` SET `icon` = '([^']+)' WHERE `([a-z_]+)` = '([^']+)' AND `icon` = '([^']+)'/,\n" +
        '  );\n' +
        '  if (match === null) {\n' +
        "    throw new Error('none');\n" +
        '  }\n' +
        '}\n',
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Blank line separation');
  });

  it('never inserts a blank line inside a template literal when an earlier regex literal contains a quote', () => {
    // A `/'/g` that flips the scanner's quote parity runs a fake "string"
    // across the following template literal until it hits the apostrophe in
    // "it's" — leaving "return window.x;" read as ordinary code and
    // (mis)flagged, which --write would then corrupt by inserting a blank
    // line INSIDE the template.
    const file = join(directory, 'fixture.ts');
    const source =
      "const cleaned = value.replace(/'/g, '');\n" +
      'const message = `\n' +
      "  it's a template\n" +
      '  return window.x;\n' +
      '`;\n';
    writeFileSync(file, source);

    const writeResult = spawnSync('node', [ANALYZER, '--write', file], { encoding: 'utf8' });

    expect(writeResult.status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });

  it('does not flag the first statement of a block when a regex literal above it contains `//`', () => {
    const result = runCheck(
      'function foo(url) {\n' +
        '  if (/^https?:\\/\\//.test(url)) {\n' +
        '    return true;\n' +
        '  }\n' +
        '}\n',
    );

    expect(result.status).toBe(0);
  });

  it('exits 0 on a non-.ts/.tsx file', () => {
    const file = join(directory, 'fixture.md');
    writeFileSync(file, '# not typescript\n');

    const result = spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });

    expect(result.status).toBe(0);
  });

  it('obeys its own rule — the checker cannot enforce a standard its own source breaks', () => {
    const result = spawnSync('node', [ANALYZER, ANALYZER], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  describe('project-wide mode (no file argument)', () => {
    it('exits 0 when BLANK_LINE_SOURCE_ROOT holds no violation', () => {
      writeFileSync(join(directory, 'clean.ts'), 'function foo() {\n' + '  return 1;\n' + '}\n');

      const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, BLANK_LINE_SOURCE_ROOT: directory },
      });

      expect(result.status).toBe(0);
    });

    it('exits 2 when BLANK_LINE_SOURCE_ROOT holds a violation', () => {
      writeFileSync(
        join(directory, 'bad.ts'),
        'function foo() {\n' + '  const value = 1;\n' + '  return value;\n' + '}\n',
      );

      const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, BLANK_LINE_SOURCE_ROOT: directory },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Blank line separation');
    });
  });
});

describe('scripts/checks/blank-line-separation.js output shape', () => {
  it('prints <path>:<line>: <kind>: <trimmed statement>', () => {
    const file = join(directory, 'fixture.ts');
    writeFileSync(
      file,
      'function foo() {\n' + '  const value = 1;\n' + '  return value;\n' + '}\n',
    );

    const result = spawnSync('node', [ANALYZER, file], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${file}:3: return: return value;\n`);
  });
});

describe('scripts/checks/blank-line-separation.js --write', () => {
  it('inserts the blank lines and re-checks to zero', () => {
    const file = join(directory, 'fixture.ts');
    const source = 'function foo() {\n' + '  const value = 1;\n' + '  return value;\n' + '}\n';
    writeFileSync(file, source);

    const writeResult = spawnSync('node', [ANALYZER, '--write', file], { encoding: 'utf8' });

    expect(writeResult.status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(
      'function foo() {\n' + '  const value = 1;\n' + '\n' + '  return value;\n' + '}\n',
    );

    const recheck = spawnSync('node', [ANALYZER, file], { encoding: 'utf8' });
    expect(recheck.status).toBe(0);
    expect(recheck.stdout).toBe('');
  });

  it('is safe to re-run on already-fixed output', () => {
    const file = join(directory, 'fixture.ts');
    writeFileSync(
      file,
      'function foo() {\n' + '  const value = 1;\n' + '\n' + '  return value;\n' + '}\n',
    );

    const result = spawnSync('node', [ANALYZER, '--write', file], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('inserts a blank line above every violating JSX sibling, in order', () => {
    const file = join(directory, 'fixture.ts');
    const source =
      'function Component() {\n' +
      '  return (\n' +
      '    <View>\n' +
      '      <Text>A</Text>\n' +
      '      <Text>B</Text>\n' +
      '      <Text>C</Text>\n' +
      '    </View>\n' +
      '  );\n' +
      '}\n';
    writeFileSync(file, source);

    const writeResult = spawnSync('node', [ANALYZER, '--write', file], { encoding: 'utf8' });

    expect(writeResult.status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(
      'function Component() {\n' +
        '  return (\n' +
        '    <View>\n' +
        '      <Text>A</Text>\n' +
        '\n' +
        '      <Text>B</Text>\n' +
        '\n' +
        '      <Text>C</Text>\n' +
        '    </View>\n' +
        '  );\n' +
        '}\n',
    );

    const recheck = spawnSync('node', [ANALYZER, file], { encoding: 'utf8' });
    expect(recheck.status).toBe(0);
  });
});
