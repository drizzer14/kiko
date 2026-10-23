import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

// Only the coordinator batch writes the global memory dir. A role agent that reads a skill or agent
// text saying otherwise records its lessons straight into memory, so the rule and every file that
// cites it are pinned, and the retired wording that told agents to write memory must not return.
const REPOSITORY_ROOT = join(__dirname, '..');

const RULE_FILE = 'harness/kiko/skills/harness-workflow/SKILL.md';

const RULE_HEADING = '## Memory writes';

const RULE_SENTENCE = 'NEVER writes the global memory dir';

const CITATION = '"Memory writes"';

// The files that cite the rule today, measured with `git grep -l 'Memory writes' harness/kiko
// .claude`; the rule file itself is not a citation.
const CITING_FILES = [
  'harness/kiko/agents/scribe.md',
  'harness/kiko/agents/retrospect.md',
  'harness/kiko/agents/researcher.md',
  'harness/kiko/skills/retrospect/SKILL.md',
];

const RETIRED_PHRASES = [
  'Records durable facts and lessons into memory',
  'Persists durable knowledge (memory',
  'Record a fact in the right place: the memory dir',
];

const SCANNED_TREES = ['harness/kiko', '.claude/skills', 'docs/harness'];

const readRepositoryFile = (path: string): string =>
  readFileSync(join(REPOSITORY_ROOT, path), 'utf8');

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ');

const markdownFilesUnder = (directory: string): string[] =>
  readdirSync(join(REPOSITORY_ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') {
      return [];
    }

    const path = `${directory}/${entry.name}`;

    if (entry.isDirectory()) {
      return markdownFilesUnder(path);
    }

    return entry.name.endsWith('.md') ? [path] : [];
  });

const scannedFiles = SCANNED_TREES.flatMap(markdownFilesUnder);

describe('the memory-write rule', () => {
  it('keeps its heading and its never-write sentence in harness-workflow', () => {
    const rule = collapseWhitespace(readRepositoryFile(RULE_FILE));

    expect(rule).toContain(RULE_HEADING);
    expect(rule).toContain(RULE_SENTENCE);
  });

  it.each(CITING_FILES)('%s keeps citing "Memory writes"', (file) => {
    expect(collapseWhitespace(readRepositoryFile(file))).toContain(CITATION);
  });

  it('scans the agent, skill and harness doc files it is meant to guard', () => {
    expect(scannedFiles).toEqual(expect.arrayContaining([RULE_FILE, ...CITING_FILES]));
    expect(scannedFiles).toContain('docs/harness/agents.md');
  });

  it.each(RETIRED_PHRASES)('no skill, agent or harness doc holds "%s"', (phrase) => {
    const holders = scannedFiles.filter((file) =>
      collapseWhitespace(readRepositoryFile(file)).includes(phrase),
    );

    expect(holders).toEqual([]);
  });
});
