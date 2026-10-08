import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/override-guard.sh (`npm run check:overrides`) fails any
// suppression comment that names no justification: an unexplained Biome
// ignore comment, a bare nosemgrep comment, or a bare kiko-override comment
// — the last two are the project-wide half of the same override protocol
// pre-write-guard.js enforces at write time (see its own `overrideState`).
// OVERRIDE(...) on the same line is what makes any of the three forms
// justified; a scan takes explicit paths as argv, mirroring the medium
// tier's changed-files scope.
const SCRIPT = join(__dirname, '../scripts/checks/override-guard.sh');

const createdPaths: string[] = [];

function writeTempFile(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'kiko-override-guard-'));
  createdPaths.push(directory);
  const filePath = join(directory, 'example.ts');
  writeFileSync(filePath, content);

  return filePath;
}

function runGuard(paths: string[]): SpawnSyncReturns<string> {
  return spawnSync('bash', [SCRIPT, ...paths], { encoding: 'utf8' });
}

afterEach(() => {
  while (createdPaths.length > 0) {
    const directory = createdPaths.pop();

    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('scripts/checks/override-guard.sh (npm run check:overrides)', () => {
  it('fails a bare nosemgrep comment with no OVERRIDE(...)', () => {
    // Split across `+` so this fixture's own bare comment never appears
    // contiguous in THIS file's source text — that exact shape is what
    // override-guard.sh itself flags as unjustified.
    const bareOverrideComment = `${'// nosem'}grep: kiko-no-switch`;
    const filePath = writeTempFile(`${bareOverrideComment}\nswitch (x) {\n};\n`);

    const result = runGuard([filePath]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('nosem');
  });

  it('fails a bare kiko-override comment with no OVERRIDE(...)', () => {
    const bareOverrideComment = `${'// kiko-over'}ride: kiko-import-order`;
    const filePath = writeTempFile(`${bareOverrideComment}\nimport { local } from './local';\n`);

    const result = runGuard([filePath]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('kiko-override');
  });

  it('fails a bare nosemgrep line comment with no colon (a blanket suppression)', () => {
    // Split across `+`, same reason as bareOverrideComment above. No rule id
    // and no colon at all — real Semgrep still honours this as "suppress
    // every finding on this line", so it is exactly as unjustified as the
    // rule-specific form above.
    const bareBlanketComment = `${'// nosem'}grep`;
    const filePath = writeTempFile(`switch (x) {\n};${bareBlanketComment}\n`);

    const result = runGuard([filePath]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('nosem');
  });

  it('fails a bare nosemgrep block comment with no OVERRIDE(...)', () => {
    // The only comment form JSX allows (`{/* ... */}`) — a `//` line
    // comment cannot appear inside a JSX expression container. Split across
    // `+`, same reason as bareOverrideComment above.
    const bareOverrideComment = `${'/* nosem'}grep: kiko-no-switch */`;
    const filePath = writeTempFile(`${bareOverrideComment}\nswitch (x) {\n};\n`);

    const result = runGuard([filePath]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('nosem');
  });

  it('passes a justified nosemgrep block comment carrying OVERRIDE(...)', () => {
    const justifiedBlockComment = `${'/* nosem'}grep: kiko-no-switch OVERRIDE(reason) legacy fallthrough kept intentionally */`;
    const filePath = writeTempFile(`${justifiedBlockComment}\nswitch (x) {\n};\n`);

    const result = runGuard([filePath]);

    expect(result.status).toBe(0);
  });

  it('passes both forms when OVERRIDE(...) is present', () => {
    const nosemgrepOverride = `${'// nosem'}grep: kiko-no-switch OVERRIDE(reason) legacy fallthrough kept intentionally`;
    const kikoOverride = `${'// kiko-over'}ride: kiko-import-order OVERRIDE(reason) legacy ordering kept intentionally`;
    const filePath = writeTempFile(
      [
        nosemgrepOverride,
        'switch (x) {',
        '};',
        kikoOverride,
        "import { local } from './local';",
        '',
      ].join('\n'),
    );

    const result = runGuard([filePath]);

    expect(result.status).toBe(0);
  });

  it('still fails an unexplained Biome ignore comment', () => {
    // Split across `+`, same reason as bareOverrideComment above.
    const bareIgnoreComment = `${'// biome-ig'}nore lint/suspicious/noExplicitAny: no reason`;
    const filePath = writeTempFile(`${bareIgnoreComment}\nconst value: any = 1;\n`);

    const result = runGuard([filePath]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${'biome-ig'}nore`);
  });

  it.each([
    ['a next-line line comment', `${'// Stryker dis'}able next-line all: not worth killing`],
    ['a whole-file line comment', `${'// Stryker dis'}able all`],
    ['a block comment', `${'/* Stryker dis'}able StringLiteral: not worth killing */`],
  ])('fails a bare Stryker disable comment (%s) with no OVERRIDE(...)', (_form, comment) => {
    // Split across `+`, same reason as bareOverrideComment above. A disabled
    // mutant becomes Ignored, which the mutation gate leaves out of the score,
    // so an unjustified one would lift a file past the gate unseen.
    const filePath = writeTempFile(`${comment}\nexport const value = 1;\n`);

    const result = runGuard([filePath]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Stryker');
  });

  it('passes a Stryker disable comment carrying OVERRIDE(...)', () => {
    const justifiedComment = `${'// Stryker dis'}able next-line StringLiteral: OVERRIDE(reason) the label is display-only`;
    const filePath = writeTempFile(`${justifiedComment}\nexport const value = 'label';\n`);

    const result = runGuard([filePath]);

    expect(result.status).toBe(0);
  });

  it('does not flag a Stryker restore comment or the word in prose', () => {
    const filePath = writeTempFile(
      '// Stryker restore all\n// the Stryker runner disables nothing here\nexport const value = 1;\n',
    );

    const result = runGuard([filePath]);

    expect(result.status).toBe(0);
  });

  it('passes scripts/checks/pre-write-guard.js itself', () => {
    const result = runGuard([join(__dirname, '../scripts/checks/pre-write-guard.js')]);

    expect(result.status).toBe(0);
  });
});
