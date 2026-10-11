import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// A Node rule shipped (kiko-component-i18n-namespace) with no bullet in
// kiko-linter's "Node checkers" section, so the skill that lists every Node
// checker silently lacked one. This makes a NODE_RULES row whose ruleId the
// section never names fail `make verify`.
//
// `NODE_RULES` is not exported and `pre-write-guard.js` is a script, so the
// ids are read from the array's own text: bounded to the `const NODE_RULES`
// declaration, because `ruleId` also appears outside it as an object key.
// A looser count of every `ruleId:` key in that span fails the test when a
// row the strict pattern cannot read (double quotes, a folded line) would
// otherwise be skipped.
const REPOSITORY_ROOT = join(__dirname, '..');

const GUARD_FILE = 'scripts/checks/pre-write-guard.js';

const SKILL_FILE = '.claude/skills/kiko-linter/SKILL.md';

const SECTION_HEADING = '## Node checkers';

const NODE_RULES_START = 'const NODE_RULES = [';

const RULE_ID_PATTERN = /\bruleId:\s*'([^']+)'/g;

const ANY_RULE_ID_PATTERN = /\bruleId:/g;

const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

const HEADING_LEVEL_PATTERN = /^(#{1,6})\s/;

const nodeRulesTextOf = (guardText: string): string => {
  const start = guardText.indexOf(NODE_RULES_START);

  return guardText.slice(start, guardText.indexOf('\n];', start));
};

const ruleIdsOf = (nodeRulesText: string): string[] =>
  [...nodeRulesText.matchAll(RULE_ID_PATTERN)].map((match) => match[1]);

// From `heading` to the next heading of the same or a higher level. A `#`
// line inside a fenced block (a shell comment) is never read as a heading.
const sectionOf = (markdown: string, heading: string): string => {
  const level = (HEADING_LEVEL_PATTERN.exec(`${heading} `) as RegExpExecArray)[1].length;
  const lines = markdown.split('\n');
  const startIndex = lines.indexOf(heading);

  if (startIndex < 0) {
    return '';
  }

  const section = [heading];
  let insideFence = false;

  for (const lineText of lines.slice(startIndex + 1)) {
    if (FENCE_PATTERN.test(lineText)) {
      insideFence = !insideFence;
    }

    const headingMatch = insideFence ? null : HEADING_LEVEL_PATTERN.exec(lineText);

    if (headingMatch !== null && headingMatch[1].length <= level) {
      break;
    }

    section.push(lineText);
  }

  return section.join('\n');
};

const isNamedIn = (section: string, ruleId: string): boolean =>
  new RegExp(`(?<![\\w-])${ruleId}(?![\\w-])`).test(section);

const missingRuleIds = (ruleIds: string[], section: string): string[] =>
  ruleIds.filter((ruleId) => !isNamedIn(section, ruleId));

describe('sectionOf', () => {
  const markdown = [
    '# Skill',
    '## Node checkers',
    'kiko-a',
    '### Nested',
    'kiko-b',
    '```bash',
    '# a shell comment, not a heading',
    '## nor this',
    '```',
    'kiko-c',
    '## Next section',
    'kiko-d',
  ].join('\n');

  it('runs from the heading to the next heading of the same level (POSITIVE)', () => {
    const section = sectionOf(markdown, '## Node checkers');

    expect(missingRuleIds(['kiko-a', 'kiko-b', 'kiko-c'], section)).toEqual([]);
    expect(isNamedIn(section, 'kiko-d')).toBe(false);
  });

  it('runs to the end of the file when no later heading closes it', () => {
    expect(isNamedIn(sectionOf(markdown, '## Next section'), 'kiko-d')).toBe(true);
  });

  it('is empty when the heading is missing (NEGATIVE)', () => {
    expect(sectionOf(markdown, '## Gone')).toBe('');
  });
});

describe('missingRuleIds', () => {
  it('names a rule id the section lacks (NEGATIVE)', () => {
    expect(missingRuleIds(['kiko-a', 'kiko-b'], '- `kiko-a` enforces it')).toEqual(['kiko-b']);
  });

  it('does not take a longer id for a shorter one', () => {
    expect(missingRuleIds(['kiko-a'], '- `kiko-a-longer` enforces it')).toEqual(['kiko-a']);
    expect(missingRuleIds(['kiko-a'], '- `kiko-a` enforces it')).toEqual([]);
  });
});

describe('NODE_RULES coverage in kiko-linter "Node checkers"', () => {
  const nodeRulesText = nodeRulesTextOf(readFileSync(join(REPOSITORY_ROOT, GUARD_FILE), 'utf8'));

  const ruleIds = ruleIdsOf(nodeRulesText);

  const section = sectionOf(
    readFileSync(join(REPOSITORY_ROOT, SKILL_FILE), 'utf8'),
    SECTION_HEADING,
  );

  it('reads every NODE_RULES row and the whole section, so the check is not vacuous', () => {
    expect(ruleIds.length).toBeGreaterThan(0);
    expect(ruleIds.length).toBe(nodeRulesText.match(ANY_RULE_ID_PATTERN)?.length);
    expect(section).not.toBe('');
  });

  it('names every NODE_RULES ruleId in the section', () => {
    const missing = missingRuleIds(ruleIds, section);

    if (missing.length > 0) {
      throw new Error(
        `kiko-linter's "Node checkers" section (${SKILL_FILE}) names no bullet for: ` +
          `${missing.join(', ')}. Add one bullet per rule, as kiko-linter's ` +
          `"Adding a pre-write guard rule" says (the checker, its ruleId, what it enforces).`,
      );
    }
  });
});
