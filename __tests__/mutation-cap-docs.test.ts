import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// The mutation cap is copied into every doc that tells an agent how to size a
// change set for `make deep`. A cap change that misses one of them leaves that
// doc naming a limit mutation.sh no longer enforces, so every copy must match
// MUTATION_FILE_CAP.
const REPOSITORY_ROOT = join(__dirname, '..');

const CAP_ASSIGNMENT = /^MUTATION_FILE_CAP=(\d+)$/m;

// Each phrasing the docs use for the cap. They run on whitespace-collapsed
// text, so a line wrap inside a phrase still matches.
const CAP_STATEMENTS = [
  /more than (\d+) (?:source )?files/gi,
  /> (\d+) files/g,
  /`MUTATION_FILE_CAP` \((\d+)/g,
  /(\d+)-file cap/g,
];

// Each must state the number at least once, so a rewording no pattern
// matches fails here instead of going unchecked.
const DOCS_STATING_THE_CAP = [
  'CLAUDE.md',
  'Makefile',
  '.claude/skills/kiko-linter/SKILL.md',
  'harness/kiko/skills/ops/SKILL.md',
  'harness/kiko/skills/harness-workflow/SKILL.md',
  'harness/kiko/agents/planner.md',
  'docs/harness/checks-internals.md',
  'docs/plans/shares-property-metals-debts.md',
];

// Names the cap without its number today; a number added later is checked.
const DOCS_ABOUT_THE_CAP = [...DOCS_STATING_THE_CAP, 'docs/harness/documented-exceptions.md'];

const readRepositoryFile = (file: string): string =>
  readFileSync(join(REPOSITORY_ROOT, file), 'utf8');

const statedCaps = (file: string): number[] => {
  const text = readRepositoryFile(file).replace(/\s+/g, ' ');

  return CAP_STATEMENTS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => Number(match[1])),
  );
};

const mutationFileCap = (): number => {
  const assignment = CAP_ASSIGNMENT.exec(readRepositoryFile('scripts/checks/mutation.sh'));

  if (assignment === null) {
    throw new Error('scripts/checks/mutation.sh has no MUTATION_FILE_CAP=<number> line');
  }

  return Number(assignment[1]);
};

describe('mutation cap in the docs', () => {
  it.each(DOCS_ABOUT_THE_CAP)('%s states only MUTATION_FILE_CAP as the cap', (file) => {
    const cap = mutationFileCap();

    expect(statedCaps(file).filter((stated) => stated !== cap)).toEqual([]);
  });

  it.each(DOCS_STATING_THE_CAP)('%s states the cap', (file) => {
    expect(statedCaps(file).length).toBeGreaterThan(0);
  });
});
