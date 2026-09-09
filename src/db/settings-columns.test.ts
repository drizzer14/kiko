import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A removed feature can leave a live-but-unread schema column behind
 * (`settings.lockGraceSeconds` did — security finding S4). This test walks the
 * `settings` table's TypeScript column properties and asserts every one of them
 * is mentioned somewhere in `src/` outside `schema.ts` (the declaration site)
 * and this file itself (see `SELF_PATH` below).
 *
 * The exception list is EXACT, not a floor: a new reader-less column fails, and
 * so does re-wiring a listed one without removing it here. That makes the list
 * a deliberate decision gate rather than a place to hide dead schema.
 */
const DOCUMENTED_READERLESS_COLUMNS = [
  // Legacy: the abandoned background-grace design. The shipped lock is
  // cold-launch-only. Deliberately not dropped — see docs/security/README.md
  // and the comment on the column in schema.ts.
  'lockGraceSeconds',
  // Legacy: the removed light/dark color-scheme feature. The app is now
  // dark-only, so nothing reads or writes this column any more. Deliberately
  // not dropped (migrations here are additive-only — a removed feature's
  // harmless retained column stays) — see the comment on the column in
  // schema.ts.
  'appearance',
];

const SCHEMA_PATH = join(__dirname, 'schema.ts');
// This test file must name the documented exception (`lockGraceSeconds`) in
// its own comment and array literal above, which would otherwise register as
// a "reader" of the column purely from its own text — masking the exact
// column it exists to flag. Excluded from the scan for that reason, the same
// way schema.ts (the column's declaration site) is excluded.
const SELF_PATH = __filename;
const SRC_ROOT = join(__dirname, '..');

const settingsColumns = (): string[] => {
  const source = readFileSync(SCHEMA_PATH, 'utf8');
  const block = source
    .split("export const settings = sqliteTable('settings', {")[1]
    ?.split('});')[0];

  return [...(block ?? '').matchAll(/^ {2}(\w+):/gm)].map((match) => match[1] as string);
};

const sourceFiles = (directory: string): string[] => {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }

    if (!/\.tsx?$/.test(entry) || full === SCHEMA_PATH || full === SELF_PATH) {
      return [];
    }

    return [full];
  });
};

describe('settings schema columns', () => {
  it('has every column referenced outside schema.ts, except the documented legacy ones', () => {
    const columns = settingsColumns();
    expect(columns.length).toBeGreaterThan(0);

    const sources = sourceFiles(SRC_ROOT).map((file) => readFileSync(file, 'utf8'));
    const readerless = columns.filter(
      (column) => !sources.some((source) => new RegExp(`\\b${column}\\b`).test(source)),
    );

    expect(readerless.sort()).toEqual([...DOCUMENTED_READERLESS_COLUMNS].sort());
  });
});
