// Semgrep fixture (POSITIVE, NESTED): kiko-no-source-text-read-in-test
// carries a path-prefixed `paths.include` entry (`src/test-support/**`), which
// draws NOTHING against a fixture placed directly in rules/fixtures/
// (kiko-linter's "Semgrep facts" gotcha), so this fixture mirrors a real
// src/test-support/ path instead.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const SOURCE_ROOT = join(__dirname, '..');
const SCHEMA_PATH = join(__dirname, 'schema.ts');

// EXPECT-FINDING
export const schemaText = (): string => readFileSync(SCHEMA_PATH, 'utf8');

export const sourceTexts = (): string[] =>
  readdirSync(SOURCE_ROOT)
    .filter((entry) => entry.endsWith('.ts'))
    // EXPECT-FINDING
    .map((entry) => readFileSync(join(SOURCE_ROOT, entry), 'utf8'));

// EXPECT-FINDING
export const screenText = (): string => fs.readFileSync(join(__dirname, 'home.screen.tsx'), 'utf8');

export const helperText = (): Promise<string> =>
  // EXPECT-FINDING
  fs.promises.readFile(join(__dirname, 'local-day.ts'), 'utf8');
