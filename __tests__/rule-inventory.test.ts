import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// kiko-linter's "Every mechanized finding gets an inventory row": a rule that
// ships without a row leaves the inventory unable to answer "is this finding
// already mechanized?". This makes a missing row fail `make verify` instead of
// waiting for a by-hand audit to find it.
const REPOSITORY_ROOT = join(__dirname, '..');

const RULE_FILES = ['rules/semgrep-mobile.yml', 'rules/semgrep-prewrite.yml'];

const INVENTORY = 'docs/harness/review-to-biome-inventory.md';

const RULE_ID_PATTERN = /^ {2}- id: ([a-z0-9-]+)\s*$/gm;

// A looser count of every `- id:` line, so an id the strict pattern cannot
// read (a new indent, an uppercase letter) fails the count instead of being
// skipped.
const ANY_ID_LINE_PATTERN = /^\s*- id:/gm;

const FIRST_CELL_ID_PATTERN = /^\| `([a-z0-9-]+)` \|/gm;

const readRepositoryFile = (file: string): string =>
  readFileSync(join(REPOSITORY_ROOT, file), 'utf8');

const ruleFileTexts = RULE_FILES.map(readRepositoryFile);

const ruleIds = ruleFileTexts.flatMap((text) =>
  [...text.matchAll(RULE_ID_PATTERN)].map((match) => match[1]),
);

describe('rule inventory (kiko-linter › Every mechanized finding gets an inventory row)', () => {
  it('reads every rule id in the Semgrep rule files', () => {
    const idLineCount = ruleFileTexts.reduce(
      (count, text) => count + (text.match(ANY_ID_LINE_PATTERN)?.length ?? 0),
      0,
    );

    expect(ruleIds.length).toBeGreaterThan(0);
    expect(ruleIds.length).toBe(idLineCount);
  });

  it(`gives every Semgrep rule id a row in ${INVENTORY} whose first cell is the exact id`, () => {
    const firstCellIds = new Set(
      [...readRepositoryFile(INVENTORY).matchAll(FIRST_CELL_ID_PATTERN)].map((match) => match[1]),
    );

    const missing = ruleIds.filter((ruleId) => !firstCellIds.has(ruleId));

    expect(missing).toEqual([]);
  });
});
