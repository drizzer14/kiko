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
  });
});
