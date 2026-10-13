import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

// scripts/checks/full-word-identifiers.sh mechanizes kiko-code-style's "Full
// words in identifiers" rule. Spawns the real wrapper against fixture files
// on disk (the __tests__/import-order.test.ts pattern), rather than
// importing scripts/checks/full-word-identifiers.js's internals directly.
const SCRIPT = join(__dirname, '../scripts/checks/full-word-identifiers.sh');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'full-word-identifiers-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const runCheck = (source: string, filename = 'fixture.ts'): SpawnSyncReturns<string> => {
  const file = join(dir, filename);
  writeFileSync(file, source);

  return spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });
};

describe('scripts/checks/full-word-identifiers.sh', () => {
  it('passes a file whose identifiers spell every word in full', () => {
    const result = runCheck(
      'const makeTransaction = (options: { previous: number }): number => {\n' +
        '  const index = options.previous;\n' +
        '  const callback = (): void => {};\n' +
        '  callback();\n' +
        '  return index;\n' +
        '};\n' +
        'export { makeTransaction };\n',
    );

    expect(result.status).toBe(0);
  });

  it('fails a bare abbreviated identifier', () => {
    const result = runCheck('const tx = 1;\nexport { tx };\n');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Full words in identifiers');
    expect(result.stderr).toContain('tx');
  });

  it('fails an abbreviated word used as one part of a camelCase identifier', () => {
    const result = runCheck('const accountIdx = 1;\nexport { accountIdx };\n');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('accountIdx');
  });

  it('fails an abbreviated word used as one part of a PascalCase type name', () => {
    const result = runCheck(
      'type ImportTxOpts = { count: number };\nexport type { ImportTxOpts };\n',
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('ImportTxOpts');
  });

  it('fails a snake_case identifier with a denylisted part', () => {
    const result = runCheck('const err_code = 1;\nexport { err_code };\n');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('err_code');
  });

  it('fails temp as a bare name and as one part of a camelCase identifier', () => {
    const result = runCheck(
      'const temp = 1;\nconst tempDirectory = 2;\nexport { temp, tempDirectory };\n',
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('temp');
    expect(result.stderr).toContain('tempDirectory');
  });

  it('does not flag temporary, template, or mkdtempSync, which only contain temp', () => {
    const result = runCheck(
      'const temporary = 1;\nconst template = 2;\nconst mkdtempSync = 3;\n' +
        'export { temporary, template, mkdtempSync };\n',
    );

    expect(result.status).toBe(0);
  });

  it('does not flag a whole word that only contains a denylisted word as a substring', () => {
    const result = runCheck(
      'const cube = 1;\nconst value = 2;\nconst context = 3;\nexport { cube, value, context };\n',
    );

    expect(result.status).toBe(0);
  });

  it('does not flag the established short forms id/i18n/ISIN or an acronym', () => {
    const result = runCheck(
      'const id = 1;\nconst i18n = 2;\nconst ISIN = 3;\nconst apiURL = 4;\n' +
        'export { id, i18n, ISIN, apiURL };\n',
    );

    expect(result.status).toBe(0);
  });

  it('does not flag content inside a string literal or a comment', () => {
    const result = runCheck(
      "// tx idx opts err\nconst message = 'tx idx opts err';\nexport { message };\n",
    );

    expect(result.status).toBe(0);
  });

  it('does not flag a letter inside a regex literal', () => {
    const result = runCheck(
      'const pattern = /^(\\d+)(?:\\.(\\d+))?e([+-]\\d+)$/i;\nexport { pattern };\n',
    );

    expect(result.status).toBe(0);
  });

  it('exits 0 on a non-.ts/.tsx file', () => {
    const result = runCheck('const tx = 1;\n', 'fixture.md');

    expect(result.status).toBe(0);
  });

  const DOLLAR_BRACE = '$' + '{';

  describe('checker gaps (R1d-round1-brief.md Minor item)', () => {
    it('does not blank the rest of the file on an apostrophe inside JSX text', () => {
      const result = runCheck(
        'export const First = () => {\n' +
          "  return <Text>Don't do that</Text>;\n" +
          '};\n' +
          'const tx = 1;\n' +
          'export { First, tx };\n',
        'fixture.tsx',
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('`tx`');
    });

    it('scans identifiers inside a template literal substitution', () => {
      const result = runCheck(`const s = \`hello ${DOLLAR_BRACE}tx}\`;\nexport { s };\n`);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('`tx`');
    });

    it('does not blank a template literal expression holding a nested string', () => {
      const result = runCheck(
        `const s = \`hello ${DOLLAR_BRACE}cond ? 'a' : 'b'}\`;\nexport { s };\n`,
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('`cond`');
    });

    it('does not flag a regex literal immediately after a return keyword', () => {
      const result = runCheck(
        'function f(value: string): boolean {\n' +
          '  return /e/.test(value);\n' +
          '}\n' +
          'export { f };\n',
      );

      expect(result.status).toBe(0);
    });

    it('does not split an uppercase-digit-uppercase acronym run (isE2E)', () => {
      const result = runCheck('const isE2E = true;\nexport { isE2E };\n');

      expect(result.status).toBe(0);
    });

    it('still flags a denylisted word behind a $ prefix (the leading $ is not a word char, so \\b already skips it)', () => {
      const result = runCheck('const $tx = 1;\nexport { $tx };\n');

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('`tx`');
    });

    it('does not flag Math.E as the denylisted word e', () => {
      const result = runCheck('const value = Math.E;\nexport { value };\n');

      expect(result.status).toBe(0);
    });
  });

  describe('.js/.mjs/.cjs under a scripts/ directory (fast-tier, per-file mode)', () => {
    it('fails a bare abbreviated identifier in a .js file under scripts/', () => {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      const file = join(dir, 'scripts', 'fixture.js');
      writeFileSync(file, 'const ctx = 1;\nmodule.exports = { ctx };\n');

      const result = spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('ctx');
    });

    it('fails a bare abbreviated identifier in a .mjs file under scripts/', () => {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      const file = join(dir, 'scripts', 'fixture.mjs');
      writeFileSync(file, 'export const tmp = 1;\n');

      const result = spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('tmp');
    });

    it('fails a bare abbreviated identifier in a .cjs file under scripts/', () => {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      const file = join(dir, 'scripts', 'fixture.cjs');
      writeFileSync(file, 'const opts = 1;\nmodule.exports = { opts };\n');

      const result = spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('opts');
    });

    it('exits 0 on a .js file outside any scripts/ directory', () => {
      const result = runCheck('const ctx = 1;\nmodule.exports = { ctx };\n', 'fixture.js');

      expect(result.status).toBe(0);
    });
  });

  describe('the exact-path exemption allowlist', () => {
    it('exempts a denylisted word at its documented exempt path', () => {
      mkdirSync(join(dir, 'src', 'db'), { recursive: true });
      const file = join(dir, 'src', 'db', 'run-migrations.ts');
      writeFileSync(
        file,
        'type MigrationJournalEntry = { idx: number };\nexport type { MigrationJournalEntry };\n',
      );

      const result = spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });

      expect(result.status).toBe(0);
    });

    it('still flags the same word at an unrelated path', () => {
      mkdirSync(join(dir, 'src', 'other'), { recursive: true });
      const file = join(dir, 'src', 'other', 'run-migrations.ts');
      writeFileSync(
        file,
        'type MigrationJournalEntry = { idx: number };\nexport type { MigrationJournalEntry };\n',
      );

      const result = spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });

      expect(result.status).toBe(2);
    });

    it('exempts only the exact identifier NAME, not every identifier holding the same word at the same path', () => {
      mkdirSync(join(dir, 'src', 'crypto-sync', 'binance'), { recursive: true });
      const file = join(dir, 'src', 'crypto-sync', 'binance', 'binance.transactions.ts');
      writeFileSync(
        file,
        'const recordKey = (record: { id: string; txId: string }): string =>\n' +
          "  record.id || record.txId || '';\n" +
          'type BinanceTxSyncDeps = { readClient: string };\n' +
          'export { recordKey };\nexport type { BinanceTxSyncDeps };\n',
      );

      const result = spawnSync('bash', [SCRIPT, file], { encoding: 'utf8' });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('BinanceTxSyncDeps');
      expect(result.stderr).not.toContain('txId');
    });
  });

  describe('project-wide mode (no file argument)', () => {
    it('exits 0 when FULL_WORD_IDENTIFIERS_SRC_ROOT holds no violation', () => {
      writeFileSync(join(dir, 'clean.ts'), 'const index = 1;\nexport { index };\n');

      const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, FULL_WORD_IDENTIFIERS_SRC_ROOT: dir },
      });

      expect(result.status).toBe(0);
    });

    it('exits 2 when FULL_WORD_IDENTIFIERS_SRC_ROOT holds a violation', () => {
      writeFileSync(join(dir, 'bad.ts'), 'const tmp = 1;\nexport { tmp };\n');

      const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, FULL_WORD_IDENTIFIERS_SRC_ROOT: dir },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Full words in identifiers');
    });

    it('scans .js/.mjs/.cjs under a scripts/ subdirectory of the scan root', () => {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(join(dir, 'scripts', 'bad.js'), 'const ctx = 1;\nmodule.exports = { ctx };\n');

      const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, FULL_WORD_IDENTIFIERS_SRC_ROOT: dir },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Full words in identifiers');
    });

    it('does not scan a .js file outside a scripts/ subdirectory of the scan root', () => {
      writeFileSync(join(dir, 'bad.js'), 'const ctx = 1;\nmodule.exports = { ctx };\n');

      const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, FULL_WORD_IDENTIFIERS_SRC_ROOT: dir },
      });

      expect(result.status).toBe(0);
    });
  });
});
