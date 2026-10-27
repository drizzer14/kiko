import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

// A guard deny points the agent at `metadata.skill` ("<skill> › <heading>").
// A heading renamed or cited from memory leaves the deny pointing nowhere, and
// two NODE_RULES rows cited a prefix of their heading unnoticed. This makes a
// citation that names no real heading fail `make verify`.
//
// Resolution: the skill's SKILL.md under `.claude/skills/`, else under
// `harness/kiko/skills/`. The heading matches any `#`-`######` heading outside
// a fenced block, backticks stripped from both sides: exactly; else with a
// trailing ` (Qualifier)` cut off the citation; else split on ` / ` with every
// part resolving. A prefix of a heading never counts.
const REPOSITORY_ROOT = join(__dirname, '..');

const SKILL_ROOTS = ['.claude/skills', 'harness/kiko/skills'];

const RULE_FILES = ['rules/semgrep-mobile.yml', 'rules/semgrep-prewrite.yml'];

const GUARD_FILE = 'scripts/checks/pre-write-guard.js';

const CITATION_SEPARATOR = ' › ';

const YAML_SKILL_PATTERN = /^\s+skill:\s*"([^"]*)"\s*$/gm;

// A looser count of every `skill:` key, so a citation the strict pattern
// cannot read (single quotes, a folded line) fails the count instead of being
// skipped.
const ANY_YAML_SKILL_PATTERN = /^\s+skill:/gm;

const GUARD_SKILL_PATTERN = /\bskill:\s*(['"])((?:(?!\1)[^\n])*)\1/g;

const ANY_GUARD_SKILL_PATTERN = /\bskill:/g;

const HEADING_PATTERN = /^#{1,6}\s+(.+?)\s*#*\s*$/;

const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

const QUALIFIER_PATTERN = /\s+\([^()]*\)$/;

const withoutBackticks = (text: string): string => text.replace(/`/g, '').trim();

const headingsOf = (markdown: string): Set<string> => {
  const headings = new Set<string>();
  let fence: string | undefined;

  markdown.split('\n').forEach((lineText) => {
    const fenceMatch = FENCE_PATTERN.exec(lineText);

    if (fenceMatch !== null) {
      if (fence === undefined) {
        fence = fenceMatch[1];
      } else if (fenceMatch[1].startsWith(fence)) {
        fence = undefined;
      }

      return;
    }

    const headingMatch = fence === undefined ? HEADING_PATTERN.exec(lineText) : null;

    if (headingMatch !== null) {
      headings.add(withoutBackticks(headingMatch[1]));
    }
  });

  return headings;
};

const headingResolves = (heading: string, headings: Set<string>): boolean => {
  const cited = withoutBackticks(heading);

  if (headings.has(cited)) {
    return true;
  }

  if (QUALIFIER_PATTERN.test(cited)) {
    return headings.has(cited.replace(QUALIFIER_PATTERN, ''));
  }

  const parts = cited.split(' / ');

  return parts.length > 1 && parts.every((part) => headingResolves(part, headings));
};

const citationResolves = (citation: string, readSkill: (skill: string) => string | undefined) => {
  const separatorIndex = citation.indexOf(CITATION_SEPARATOR);

  if (separatorIndex < 0) {
    return false;
  }

  const markdown = readSkill(citation.slice(0, separatorIndex));

  return (
    markdown !== undefined &&
    headingResolves(
      citation.slice(separatorIndex + CITATION_SEPARATOR.length),
      headingsOf(markdown),
    )
  );
};

const readRepositoryFile = (file: string): string =>
  readFileSync(join(REPOSITORY_ROOT, file), 'utf8');

const readSkillIn = (repositoryRoot: string, skill: string): string | undefined =>
  SKILL_ROOTS.map((root) => join(repositoryRoot, `${root}/${skill}/SKILL.md`))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))[0];

const readRepositorySkill = (skill: string): string | undefined =>
  readSkillIn(REPOSITORY_ROOT, skill);

const yamlCitations = RULE_FILES.map(readRepositoryFile).flatMap((text) =>
  [...text.matchAll(YAML_SKILL_PATTERN)].map((match) => match[1]),
);

const guardText = readRepositoryFile(GUARD_FILE);

const nodeRulesText = guardText.slice(
  guardText.indexOf('const NODE_RULES = ['),
  guardText.indexOf('\n];', guardText.indexOf('const NODE_RULES = [')),
);

const guardCitations = [...nodeRulesText.matchAll(GUARD_SKILL_PATTERN)].map((match) => match[2]);

describe('headingResolves', () => {
  const headings = headingsOf(
    [
      '# Skill',
      '## Import ordering and `import type`',
      '### Component set',
      '## `fnts` FIRST',
      '## Blank lines before statement blocks',
      '## Blank line between adjacent JSX sibling nodes',
      '```bash',
      '# Fenced comment',
      '```',
    ].join('\n'),
  );

  it('resolves an exact heading with its backticks stripped from both sides (POSITIVE)', () => {
    expect(headingResolves('Import ordering and import type', headings)).toBe(true);
    expect(headingResolves('`fnts` FIRST', headings)).toBe(true);
  });

  it('resolves a heading cited with a trailing qualifier', () => {
    expect(headingResolves('Component set (Button)', headings)).toBe(true);
  });

  it('resolves a citation whose every ` / ` part is a heading', () => {
    expect(
      headingResolves(
        'Blank lines before statement blocks / Blank line between adjacent JSX sibling nodes',
        headings,
      ),
    ).toBe(true);
  });

  it('does not resolve a prefix of a heading (NEGATIVE)', () => {
    expect(headingResolves('Import ordering', headings)).toBe(false);
  });

  it('does not resolve a ` / ` citation with one missing part', () => {
    expect(headingResolves('Blank lines before statement blocks / Gone', headings)).toBe(false);
  });

  it('does not read a `#` line inside a fenced block as a heading', () => {
    expect(headingResolves('Fenced comment', headings)).toBe(false);
  });

  it('does not resolve a citation of a missing skill or one without the separator', () => {
    expect(citationResolves('kiko-gone › Component set', () => undefined)).toBe(false);
    expect(citationResolves('Component set', () => '## Component set')).toBe(false);
  });
});

describe('a citation into a skill reference file', () => {
  afterEach(removeTemporaryDirectories);

  const skillWithReference = (skillText: string, referenceText: string): string => {
    const root = createTemporaryDirectory('kiko-skill-citations-');

    mkdirSync(join(root, '.claude/skills/demo'), { recursive: true });
    writeFileSync(join(root, '.claude/skills/demo/SKILL.md'), skillText);
    writeFileSync(join(root, '.claude/skills/demo/reference.md'), referenceText);

    return root;
  };

  const resolvesIn = (root: string, citation: string): boolean =>
    citationResolves(citation, (skill) => readSkillIn(root, skill));

  it('resolves a heading of a reference file the SKILL.md links to (POSITIVE)', () => {
    const root = skillWithReference(
      '# Demo\n\n## Overview\n\nSee [the details](reference.md).\n',
      '# Reference\n\n## Wrapper details\n',
    );

    expect(resolvesIn(root, 'demo › Wrapper details')).toBe(true);
    expect(resolvesIn(root, 'demo › Overview')).toBe(true);
  });

  it('does not resolve a heading of a reference file the SKILL.md does not link to (NEGATIVE)', () => {
    const root = skillWithReference(
      '# Demo\n\n## Overview\n',
      '# Reference\n\n## Orphan heading\n',
    );

    expect(resolvesIn(root, 'demo › Orphan heading')).toBe(false);
  });

  it('does not resolve a heading that neither file holds', () => {
    const root = skillWithReference(
      '# Demo\n\nSee [the details](reference.md).\n',
      '# Reference\n\n## Wrapper details\n',
    );

    expect(resolvesIn(root, 'demo › Gone')).toBe(false);
  });
});

describe('metadata.skill citations in rules and NODE_RULES', () => {
  it('reads every skill citation in the rule files and NODE_RULES', () => {
    const yamlKeyCount = RULE_FILES.map(readRepositoryFile).reduce(
      (count, text) => count + (text.match(ANY_YAML_SKILL_PATTERN)?.length ?? 0),
      0,
    );

    expect(yamlCitations.length).toBeGreaterThan(0);
    expect(yamlCitations.length).toBe(yamlKeyCount);
    expect(guardCitations.length).toBeGreaterThan(0);
    expect(guardCitations.length).toBe(nodeRulesText.match(ANY_GUARD_SKILL_PATTERN)?.length);
  });

  it('cites only headings that exist in the named skill', () => {
    expect(
      [...yamlCitations, ...guardCitations].filter(
        (citation) => !citationResolves(citation, readRepositorySkill),
      ),
    ).toEqual([]);
  });
});
