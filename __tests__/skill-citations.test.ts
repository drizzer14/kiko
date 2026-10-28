import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  headingResolves,
  headingsOf,
  helperCatalogueGaps,
  indexLeadGaps,
  readSkillText,
  unnamedLockedMarks,
} from './test-support/skill-text';
import {
  directionCitations,
  proseCitations,
  unresolvedDirectionCitations,
  unresolvedProseCitations,
} from './test-support/prose-citations';
import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { orphanReferenceFiles } from './test-support/orphan-reference-files';

// A guard deny points the agent at `metadata.skill` ("<skill> › <heading>").
// A heading renamed or cited from memory leaves the deny pointing nowhere, and
// two NODE_RULES rows cited a prefix of their heading unnoticed. This makes a
// citation that names no real heading fail `make verify`.
//
// Resolution: the skill's SKILL.md under `.claude/skills/`, else under
// `harness/kiko/skills/`, plus the reference files that SKILL.md links to (read through
// `readSkillText`). The heading matches any `#`-`######` heading outside
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
    .map(readSkillText)[0];

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

describe('prose citations of a skill section', () => {
  afterEach(removeTemporaryDirectories);

  const DEMO_SKILL = [
    '# Demo',
    '',
    '## Exact heading',
    '',
    '## Prefix heading — with a tail',
    '',
    '**Bold lead.** The sentence goes on and mentions a lonely word.',
    '',
    'See [the details](reference.md).',
    '',
    'Mid bold has a **middle bold** span.',
    '',
    '- Bullet lead item.',
    '  Wrapped bullet tail.',
    '- A first article thing.',
    '- An other article thing.',
    '- The third article thing.',
    '',
    'Paragraph lead opens the paragraph',
    'Soft wrapped line goes on. Sentence start follows here.',
    '',
    '### Directly under',
    'Tight paragraph lead.',
    'Soft tail line.',
    '',
    '```',
    'Fenced line text',
    '**Fenced bold**',
    '- Fenced bullet',
    '```',
    '',
  ].join('\n');

  const REFERENCE = '# Reference\n\n## Reference heading\n';

  const demoRoot = (files: Record<string, string>): string => {
    const root = createTemporaryDirectory('kiko-prose-citations-');

    mkdirSync(join(root, '.claude/skills/demo'), { recursive: true });
    writeFileSync(join(root, '.claude/skills/demo/SKILL.md'), DEMO_SKILL);
    writeFileSync(join(root, '.claude/skills/demo/reference.md'), REFERENCE);

    Object.entries(files).forEach(([file, text]) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    });

    return root;
  };

  const NOTES = 'docs/harness/notes.md';

  const citationOf = (text: string, resolved: boolean, line = 1, file = NOTES, skill = 'demo') => ({
    file,
    line,
    skill,
    text,
    resolved,
  });

  // A skill name that ends in s, so its possessive is a bare apostrophe.
  const PLURAL_SKILL = { '.claude/skills/demos/SKILL.md': '# Demos\n\n## Exact heading\n' };

  it('resolves a citation of an exact heading (POSITIVE)', () => {
    expect(proseCitations(demoRoot({ [NOTES]: 'See demo\'s "Exact heading" first.\n' }))).toEqual([
      citationOf('Exact heading', true),
    ]);
  });

  it('resolves a citation of the part of a heading before its dash (POSITIVE)', () => {
    expect(proseCitations(demoRoot({ [NOTES]: 'See demo "Prefix heading" first.\n' }))).toEqual([
      citationOf('Prefix heading', true),
    ]);
  });

  it('resolves a citation of a bold lead (POSITIVE)', () => {
    expect(proseCitations(demoRoot({ [NOTES]: "See demo's 'Bold lead' first.\n" }))).toEqual([
      citationOf('Bold lead', true),
    ]);
  });

  it('resolves a citation of a bullet lead, the bullet text wrapped or not (POSITIVE)', () => {
    expect(
      proseCitations(
        demoRoot({
          [NOTES]: 'demo "Bullet lead item"\ndemo "Bullet lead item. Wrapped bullet tail"\n',
        }),
      ),
    ).toEqual([
      citationOf('Bullet lead item', true),
      citationOf('Bullet lead item. Wrapped bullet tail', true, 2),
    ]);
  });

  it('resolves a citation of a paragraph lead, over its wrapped line too (POSITIVE)', () => {
    expect(
      proseCitations(
        demoRoot({
          [NOTES]:
            'demo "Paragraph lead opens the paragraph"\n' +
            'demo "Paragraph lead opens the paragraph Soft wrapped line"\n' +
            'demo "Tight paragraph lead"\n',
        }),
      ),
    ).toEqual([
      citationOf('Paragraph lead opens the paragraph', true),
      citationOf('Paragraph lead opens the paragraph Soft wrapped line', true, 2),
      citationOf('Tight paragraph lead', true, 3),
    ]);
  });

  it('resolves a citation of a bold span in the middle of a line (POSITIVE)', () => {
    expect(proseCitations(demoRoot({ [NOTES]: 'demo "middle bold"\n' }))).toEqual([
      citationOf('middle bold', true),
    ]);
  });

  it('resolves a citation that leaves out the leading A, An or The (POSITIVE)', () => {
    expect(
      proseCitations(
        demoRoot({
          [NOTES]:
            'demo "first article thing"\ndemo "other article thing"\ndemo "third article thing"\n',
        }),
      ),
    ).toEqual([
      citationOf('first article thing', true),
      citationOf('other article thing', true, 2),
      citationOf('third article thing', true, 3),
    ]);
  });

  it('does not resolve a sentence start inside a paragraph (NEGATIVE)', () => {
    expect(
      unresolvedProseCitations(demoRoot({ [NOTES]: 'demo "Sentence start follows here"\n' })),
    ).toEqual([citationOf('Sentence start follows here', false)]);
  });

  it('does not resolve a part of a word (NEGATIVE)', () => {
    expect(unresolvedProseCitations(demoRoot({ [NOTES]: 'demo "Exact head"\n' }))).toEqual([
      citationOf('Exact head', false),
    ]);
  });

  it('does not resolve the soft-wrapped line of a paragraph or of a bullet (NEGATIVE)', () => {
    expect(
      unresolvedProseCitations(
        demoRoot({
          [NOTES]:
            'demo "Soft wrapped line goes on"\ndemo "Wrapped bullet tail"\ndemo "Soft tail line"\n',
        }),
      ),
    ).toEqual([
      citationOf('Soft wrapped line goes on', false),
      citationOf('Wrapped bullet tail', false, 2),
      citationOf('Soft tail line', false, 3),
    ]);
  });

  it('does not resolve a line, a bullet or a bold span inside a fenced block (NEGATIVE)', () => {
    expect(
      unresolvedProseCitations(
        demoRoot({
          [NOTES]: 'demo "Fenced line text"\ndemo "Fenced bold"\ndemo "Fenced bullet"\n',
        }),
      ),
    ).toEqual([
      citationOf('Fenced line text', false),
      citationOf('Fenced bold', false, 2),
      citationOf('Fenced bullet', false, 3),
    ]);
  });

  it('resolves a citation after a plural possessive, with the name in backticks or not (POSITIVE)', () => {
    expect(
      proseCitations(
        demoRoot({
          ...PLURAL_SKILL,
          [NOTES]: 'See demos\' "Exact heading" first.\nSee `demos`\' "Exact heading" first.\n',
        }),
      ),
    ).toEqual([
      citationOf('Exact heading', true, 1, NOTES, 'demos'),
      citationOf('Exact heading', true, 2, NOTES, 'demos'),
    ]);
  });

  it('names a stale citation after a plural possessive (NEGATIVE)', () => {
    expect(
      unresolvedProseCitations(
        demoRoot({
          ...PLURAL_SKILL,
          [NOTES]: 'See demos\' "Gone heading" first.\nSee `demos`\' "Gone heading" first.\n',
        }),
      ),
    ).toEqual([
      citationOf('Gone heading', false, 1, NOTES, 'demos'),
      citationOf('Gone heading', false, 2, NOTES, 'demos'),
    ]);
  });

  it('resolves a citation of a heading in a linked reference file (POSITIVE)', () => {
    expect(
      proseCitations(demoRoot({ [NOTES]: 'See demo\'s "Reference heading" first.\n' })),
    ).toEqual([citationOf('Reference heading', true)]);
  });

  it('resolves a cited text that ends with the quote-closing period (POSITIVE)', () => {
    expect(proseCitations(demoRoot({ [NOTES]: 'See demo\'s "Exact heading."\n' }))).toEqual([
      citationOf('Exact heading', true),
    ]);
  });

  it('names a citation of text the skill does not have (NEGATIVE)', () => {
    expect(
      unresolvedProseCitations(demoRoot({ [NOTES]: 'one\nSee demo\'s "Gone heading" first.\n' })),
    ).toEqual([citationOf('Gone heading', false, 2)]);
  });

  it('does not resolve a word that occurs in the skill only inside a sentence (NEGATIVE)', () => {
    expect(
      unresolvedProseCitations(demoRoot({ [NOTES]: 'See demo\'s "lonely word" first.\n' })),
    ).toEqual([citationOf('lonely word', false)]);
  });

  it('does not read a citation of a name that is no skill folder (NEGATIVE)', () => {
    expect(
      proseCitations(
        demoRoot({ [NOTES]: 'kiko-gone "Gone heading"\nSee demo\'s "Gone heading" first.\n' }),
      ),
    ).toEqual([citationOf('Gone heading', false, 2)]);
  });

  it('reads the message and the comments of a rule file, a wrapped comment too (POSITIVE)', () => {
    expect(
      proseCitations(
        demoRoot({
          'rules/demo.yml': [
            '# see demo "Exact',
            '# heading" above',
            'rules:',
            '  - message: |',
            '      Read demo\'s "Gone heading" first.',
            '',
          ].join('\n'),
        }),
      ),
    ).toEqual([
      citationOf('Exact heading', true, 1, 'rules/demo.yml'),
      citationOf('Gone heading', false, 5, 'rules/demo.yml'),
    ]);
  });

  it('reads agents, CLAUDE.md, plans and the skill folders, not superpowers or reviews (POSITIVE)', () => {
    const stale = 'See demo\'s "Gone heading" first.\n';

    expect(
      unresolvedProseCitations(
        demoRoot({
          'harness/kiko/agents/worker.md': stale,
          'CLAUDE.md': stale,
          'docs/plans/plan.md': stale,
          'harness/kiko/skills/other/SKILL.md': stale,
          'docs/superpowers/plans/dated.md': stale,
          'docs/reviews/dated.md': stale,
        }),
      ).map(({ file }) => file),
    ).toEqual([
      'CLAUDE.md',
      'docs/plans/plan.md',
      'harness/kiko/agents/worker.md',
      'harness/kiko/skills/other/SKILL.md',
    ]);
  });

  describe('in the other forms a skill is cited', () => {
    const SHORT_SKILLS = {
      '.claude/skills/ops/SKILL.md': '# Ops\n\n## Exact heading\n',
      '.claude/skills/release/SKILL.md': '# Release\n\n## Exact heading\n',
      '.claude/skills/kiko-demo/SKILL.md': '# Kiko demo\n\n## Exact heading\n',
    };

    it("resolves a citation after '<skill> skill's' (POSITIVE)", () => {
      expect(
        proseCitations(
          demoRoot({
            ...SHORT_SKILLS,
            [NOTES]:
              'See ops skill\'s "Exact heading" first.\nSee demo skill\'s "Exact heading".\n',
          }),
        ),
      ).toEqual([
        citationOf('Exact heading', true, 1, NOTES, 'ops'),
        citationOf('Exact heading', true, 2),
      ]);
    });

    it("names a stale citation after '<skill> skill's' (NEGATIVE)", () => {
      expect(
        unresolvedProseCitations(
          demoRoot({
            ...SHORT_SKILLS,
            [NOTES]: 'See release skill\'s "Gone heading" first.\n',
          }),
        ),
      ).toEqual([citationOf('Gone heading', false, 1, NOTES, 'release')]);
    });

    it('resolves a citation after a comma, the name backticked or kiko-prefixed (POSITIVE)', () => {
      expect(
        proseCitations(
          demoRoot({
            ...SHORT_SKILLS,
            [NOTES]: 'See `demo`, "Exact heading" first.\nSee kiko-demo, "Exact heading" too.\n',
          }),
        ),
      ).toEqual([
        citationOf('Exact heading', true),
        citationOf('Exact heading', true, 2, NOTES, 'kiko-demo'),
      ]);
    });

    it('resolves a citation in parentheses after the name, backticked or kiko-prefixed (POSITIVE)', () => {
      expect(
        proseCitations(
          demoRoot({
            ...SHORT_SKILLS,
            [NOTES]:
              'The rule (`demo` ("Exact heading")).\nThe rule (kiko-demo ("Gone heading")).\n',
          }),
        ),
      ).toEqual([
        citationOf('Exact heading', true),
        citationOf('Gone heading', false, 2, NOTES, 'kiko-demo'),
      ]);
    });

    it('does not read a short skill name used as a plain word before a comma or a bracket (NEGATIVE)', () => {
      expect(
        proseCitations(
          demoRoot({
            ...SHORT_SKILLS,
            [NOTES]:
              'We ship the release, "Gone heading" was the codename.\n' +
              'Then ops ("Gone heading") took over.\n' +
              'So demo, "Gone heading" is just prose.\n',
          }),
        ),
      ).toEqual([]);
    });

    it('does not end a quoted heading at a YAML-escaped quote inside it (NEGATIVE)', () => {
      expect(
        proseCitations(
          demoRoot({
            '.claude/skills/quoted/SKILL.md': '# Quoted\n\n## Say "hi" now\n',
            'rules/demo.yml': [
              'rules:',
              '  - message: |',
              '      Read quoted\'s "Say \\"hi\\" now" first.',
              '      Read quoted\'s "Say \\"bye\\" now" first.',
              '',
            ].join('\n'),
          }),
        ),
      ).toEqual([
        citationOf('Say "hi" now', true, 3, 'rules/demo.yml', 'quoted'),
        citationOf('Say "bye" now', false, 4, 'rules/demo.yml', 'quoted'),
      ]);
    });
  });

  describe('in the comments of src and rules/fixtures', () => {
    it('reads a line comment, a block comment and a wrapped comment of a src file (POSITIVE)', () => {
      expect(
        proseCitations(
          demoRoot({
            'src/feature/feature.ts': 'export {};\n// See demo\'s "Gone heading" first.\n',
            'src/feature/feature.component.tsx': [
              'export {};',
              '/**',
              ' * Read demo\'s "Exact',
              ' * heading" first.',
              ' */',
              '',
            ].join('\n'),
          }),
        ),
      ).toEqual([
        citationOf('Exact heading', true, 3, 'src/feature/feature.component.tsx'),
        citationOf('Gone heading', false, 2, 'src/feature/feature.ts'),
      ]);
    });

    it('reads the comment of a fixture under rules/fixtures, a nested one too (POSITIVE)', () => {
      expect(
        proseCitations(
          demoRoot({
            'rules/fixtures/demo.bad.ts':
              '// Semgrep fixture: demo\'s "Gone heading".\nexport {};\n',
            'rules/fixtures/demo/src/screens/form.bad.tsx': [
              '// Semgrep fixture: demo\'s "Exact',
              '// heading".',
              'export {};',
              '',
            ].join('\n'),
          }),
        ),
      ).toEqual([
        citationOf('Gone heading', false, 1, 'rules/fixtures/demo.bad.ts', 'demo'),
        citationOf('Exact heading', true, 1, 'rules/fixtures/demo/src/screens/form.bad.tsx'),
      ]);
    });

    it('does not read a citation inside a string or a template of a src file (NEGATIVE)', () => {
      expect(
        proseCitations(
          demoRoot({
            'src/feature/text.ts': [
              "export const first = \"see demo's 'Gone heading' first\";",
              'export const second = `see demo\'s "Gone heading" first`;',
              '',
            ].join('\n'),
          }),
        ),
      ).toEqual([]);
    });

    it('reads the comments of src and rules/fixtures in the real repository', () => {
      const files = new Set(proseCitations(REPOSITORY_ROOT).map(({ file }) => file));

      expect([...files].filter((file) => file.startsWith('rules/fixtures/'))).not.toEqual([]);
    });
  });

  describe('of a quoted heading with a qualifier', () => {
    const QUALIFIED_SKILL = {
      '.claude/skills/qual/SKILL.md': [
        '# Qual',
        '',
        '## Component set',
        '',
        'Intro text.',
        '',
        '- **Button** — the button.',
        '',
        '### Nested part',
        '',
        'Nested text mentions Gizmo.',
        '',
        '## Other section',
        '',
        'Other text mentions Sprocket.',
        '',
        '## Plain (continued)',
        '',
        'A body without the word.',
        '',
      ].join('\n'),
    };

    const qualifiedCitation = (text: string, resolved: boolean) =>
      citationOf(text, resolved, 1, NOTES, 'qual');

    it('resolves a qualifier the body of the section names, a nested part too (POSITIVE)', () => {
      expect(
        proseCitations(
          demoRoot({
            ...QUALIFIED_SKILL,
            [NOTES]: 'qual "Component set (Button)"\nqual "Component set (Gizmo)"\n',
          }),
        ),
      ).toEqual([
        qualifiedCitation('Component set (Button)', true),
        citationOf('Component set (Gizmo)', true, 2, NOTES, 'qual'),
      ]);
    });

    it('resolves a heading that carries the parenthesis itself (POSITIVE)', () => {
      expect(
        proseCitations(demoRoot({ ...QUALIFIED_SKILL, [NOTES]: 'qual "Plain (continued)"\n' })),
      ).toEqual([qualifiedCitation('Plain (continued)', true)]);
    });

    it('does not resolve a qualifier the section body lacks, though the bare heading exists (NEGATIVE)', () => {
      expect(
        unresolvedProseCitations(
          demoRoot({ ...QUALIFIED_SKILL, [NOTES]: 'qual "Component set (Missing)"\n' }),
        ),
      ).toEqual([qualifiedCitation('Component set (Missing)', false)]);
    });

    it('does not resolve a qualifier that only another section names (NEGATIVE)', () => {
      expect(
        unresolvedProseCitations(
          demoRoot({ ...QUALIFIED_SKILL, [NOTES]: 'qual "Component set (Sprocket)"\n' }),
        ),
      ).toEqual([qualifiedCitation('Component set (Sprocket)', false)]);
    });
  });

  describe('of a quoted heading beside above or below, with no skill name', () => {
    const directionOf = (
      text: string,
      direction: 'above' | 'below',
      resolved: boolean,
      line: number,
      file = NOTES,
    ) => ({ file, line, text, direction, resolved });

    it('resolves a heading before the line for above and after it for below (POSITIVE)', () => {
      expect(
        directionCitations(
          demoRoot({
            [NOTES]: [
              '## First heading',
              '',
              'See "First heading" above.',
              'See "Last heading"',
              'below.',
              '',
              '## Last heading',
              '',
            ].join('\n'),
          }),
        ),
      ).toEqual([
        directionOf('First heading', 'above', true, 3),
        directionOf('Last heading', 'below', true, 4),
      ]);
    });

    it('resolves an anchored lead in the direction, as a prose citation does (POSITIVE)', () => {
      expect(
        directionCitations(
          demoRoot({
            [NOTES]: [
              '- **Bold lead.** The sentence goes on.',
              '',
              'See "Bold lead" above and "Later lead" above.',
              '',
              '- Later lead item.',
              '',
            ].join('\n'),
          }),
        ),
      ).toEqual([
        directionOf('Bold lead', 'above', true, 3),
        directionOf('Later lead', 'above', false, 3),
      ]);
    });

    it('does not resolve a heading that only another file has (NEGATIVE)', () => {
      expect(
        unresolvedDirectionCitations(
          demoRoot({
            [NOTES]: 'See "Elsewhere heading" below.\nSee "Elsewhere heading" above.\n',
            'docs/harness/other.md': '## Elsewhere heading\n',
          }),
        ),
      ).toEqual([
        directionOf('Elsewhere heading', 'below', false, 1),
        directionOf('Elsewhere heading', 'above', false, 2),
      ]);
    });

    it('does not resolve a heading of a linked reference file for a SKILL.md line (NEGATIVE)', () => {
      expect(
        unresolvedDirectionCitations(
          demoRoot({
            '.claude/skills/demo/SKILL.md':
              '# Demo\n\nSee [the details](reference.md).\n\nSee "Reference heading" above.\n',
          }),
        ),
      ).toEqual([
        directionOf('Reference heading', 'above', false, 5, '.claude/skills/demo/SKILL.md'),
      ]);
    });

    it('does not resolve a heading in the wrong direction (NEGATIVE)', () => {
      expect(
        unresolvedDirectionCitations(
          demoRoot({
            [NOTES]: [
              'See "Later heading" above.',
              '',
              '## Later heading',
              '',
              'See "Later heading" below.',
              '',
              '## Earlier heading',
              '',
              'See "Earlier heading" below.',
              '',
            ].join('\n'),
          }),
        ),
      ).toEqual([
        directionOf('Later heading', 'above', false, 1),
        directionOf('Earlier heading', 'below', false, 9),
      ]);
    });

    it('does not count a heading line inside a fenced block (NEGATIVE)', () => {
      expect(
        unresolvedDirectionCitations(
          demoRoot({
            [NOTES]: [
              '```',
              '## Fenced heading',
              '```',
              '',
              'See "Fenced heading" above.',
              '',
            ].join('\n'),
          }),
        ),
      ).toEqual([directionOf('Fenced heading', 'above', false, 5)]);
    });

    it('leaves a citation that names a skill to the prose citation check (NEGATIVE)', () => {
      expect(
        directionCitations(demoRoot({ [NOTES]: 'See demo\'s "Exact heading" below.\n' })),
      ).toEqual([]);
    });

    it('are all resolved in the real repository (the sources are scanned and none is stale)', () => {
      expect(directionCitations(REPOSITORY_ROOT).length).toBeGreaterThan(20);
      expect(unresolvedDirectionCitations(REPOSITORY_ROOT)).toEqual([]);
    });
  });

  it('are all resolved in the real repository (the sources are scanned and none is stale)', () => {
    expect(proseCitations(REPOSITORY_ROOT).length).toBeGreaterThan(300);
    expect(unresolvedProseCitations(REPOSITORY_ROOT)).toEqual([]);
  });
});

const fixtureRoot = (files: Record<string, string>): string => {
  const root = createTemporaryDirectory('kiko-skill-checks-');

  Object.entries(files).forEach(([file, text]) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  });

  return root;
};

// A helper the catalogue may leave out on purpose. The key is the path, the value the reason.
const HELPER_CATALOGUE_EXEMPTIONS: Record<string, string> = {};

describe('the kiko-testing helper catalogue', () => {
  afterEach(removeTemporaryDirectories);

  const CATALOGUE = [
    '# Kiko testing',
    '',
    '## Shared test helpers',
    '',
    '### `src/test-support/`',
    '',
    '- `first-helper.ts`, `second-helper.tsx`: two helpers.',
    '- `element.d.ts`: a type file.',
    '',
    '### `__tests__/test-support/` (harness tests)',
    '',
    '- `harness-helper.ts`: a harness helper.',
    '',
    '## Real SQLite versus a fake database',
    '',
    'Prose naming `unrelated-file.ts` is no catalogue entry.',
    '',
  ].join('\n');

  const CATALOGUE_FILE = '.claude/skills/kiko-testing/SKILL.md';

  const SHAPE_FILES = {
    [CATALOGUE_FILE]: CATALOGUE,
    'src/test-support/first-helper.ts': '',
    'src/test-support/second-helper.tsx': '',
    'src/test-support/element.d.ts': '',
    'src/test-support/first-helper.test.ts': '',
    '__tests__/test-support/harness-helper.ts': '',
    '__tests__/test-support/harness-helper.test.ts': '',
  };

  const shapeFilesWithout = (file: string): Record<string, string> =>
    Object.fromEntries(Object.entries(SHAPE_FILES).filter(([path]) => path !== file));

  const NO_GAPS = { missing: [], unlisted: [], staleExemptions: [] };

  it('lists exactly the helper files of both folders, test files aside (POSITIVE)', () => {
    expect(helperCatalogueGaps(fixtureRoot(SHAPE_FILES), [])).toEqual(NO_GAPS);
  });

  it('names a listed helper whose file is gone (NEGATIVE)', () => {
    expect(
      helperCatalogueGaps(fixtureRoot(shapeFilesWithout('src/test-support/second-helper.tsx')), []),
    ).toEqual({
      ...NO_GAPS,
      missing: ['src/test-support/second-helper.tsx'],
    });
  });

  it('names a helper file of a folder that the catalogue does not list (NEGATIVE)', () => {
    expect(
      helperCatalogueGaps(
        fixtureRoot({
          ...SHAPE_FILES,
          'src/test-support/new-helper.ts': '',
          '__tests__/test-support/new-harness-helper.ts': '',
        }),
        [],
      ),
    ).toEqual({
      ...NO_GAPS,
      unlisted: ['__tests__/test-support/new-harness-helper.ts', 'src/test-support/new-helper.ts'],
    });
  });

  it('reads a name by its folder: a helper listed for the other folder is both gaps (NEGATIVE)', () => {
    expect(
      helperCatalogueGaps(
        fixtureRoot({
          ...shapeFilesWithout('__tests__/test-support/harness-helper.ts'),
          'src/test-support/harness-helper.ts': '',
        }),
        [],
      ),
    ).toEqual({
      ...NO_GAPS,
      missing: ['__tests__/test-support/harness-helper.ts'],
      unlisted: ['src/test-support/harness-helper.ts'],
    });
  });

  it('lets an exemption excuse an unlisted file and names an exemption that is stale (POSITIVE)', () => {
    expect(
      helperCatalogueGaps(fixtureRoot({ ...SHAPE_FILES, 'src/test-support/odd-helper.ts': '' }), [
        'src/test-support/odd-helper.ts',
        'src/test-support/first-helper.ts',
        'src/test-support/gone-helper.ts',
      ]),
    ).toEqual({
      ...NO_GAPS,
      staleExemptions: ['src/test-support/first-helper.ts', 'src/test-support/gone-helper.ts'],
    });
  });

  it('matches the real folder listings, every exemption with a reason', () => {
    expect(Object.values(HELPER_CATALOGUE_EXEMPTIONS).every((reason) => reason.length > 0)).toBe(
      true,
    );
    expect(helperCatalogueGaps(REPOSITORY_ROOT, Object.keys(HELPER_CATALOGUE_EXEMPTIONS))).toEqual({
      missing: [],
      unlisted: [],
      staleExemptions: [],
    });
  });
});

describe('the Locked marks of the kiko-design-system reference files', () => {
  afterEach(removeTemporaryDirectories);

  const SKILL_FILE = '.claude/skills/kiko-design-system/SKILL.md';

  const skillWithLockedList = (locked: string[], parts?: string): string => {
    const root = fixtureRoot({
      [SKILL_FILE]: [
        '# Design',
        '',
        '## Reference files',
        '',
        '- [parts.md](parts.md) — "Parts": the widgets.',
        '',
        '## Locked decisions (user-approved)',
        '',
        'Each entry is a visual the user approved.',
        '',
        ...locked,
        '',
        '## After',
        '',
        '- **Gadget** — a SKILL.md mark is **Locked (2026-01-01)** but needs no entry.',
        '',
      ].join('\n'),
      '.claude/skills/kiko-design-system/parts.md':
        parts ??
        [
          '## Parts',
          '',
          '- **Widget** — a widget. **Locked (2026-09-30, user request "x"):** compact.',
          '- **Gizmo** — a gizmo, wrapped',
          '  **Locked',
          '  (user request 2026-10-02, "y"):** wider.',
          '',
        ].join('\n'),
    });

    return join(root, SKILL_FILE);
  };

  const WIDGET_ENTRY = '- **Widget compact** (2026-09-30). Smaller. See `Widget` in parts.md.';

  const GIZMO_ENTRY = '- **Gizmo wider** (2026-10-02). Wider. See `Gizmo` in parts.md.';

  it('are all named in the Locked decisions list (POSITIVE)', () => {
    expect(unnamedLockedMarks(skillWithLockedList([WIDGET_ENTRY, GIZMO_ENTRY]))).toEqual([]);
  });

  it('names a mark whose component has no entry in the list (NEGATIVE)', () => {
    expect(unnamedLockedMarks(skillWithLockedList([WIDGET_ENTRY]))).toEqual([
      { file: 'parts.md', line: 5, component: 'Gizmo', date: '2026-10-02' },
    ]);
  });

  it('names a mark whose entry carries another date (NEGATIVE)', () => {
    expect(
      unnamedLockedMarks(
        skillWithLockedList([WIDGET_ENTRY, GIZMO_ENTRY.replace('2026-10-02', '2026-10-03')]),
      ),
    ).toEqual([{ file: 'parts.md', line: 5, component: 'Gizmo', date: '2026-10-02' }]);
  });

  it('names a mark whose date belongs to the entry of another component (NEGATIVE)', () => {
    expect(
      unnamedLockedMarks(
        skillWithLockedList([WIDGET_ENTRY, '- **Other** (2026-10-02). Wider. See `Other`.']),
      ),
    ).toEqual([{ file: 'parts.md', line: 5, component: 'Gizmo', date: '2026-10-02' }]);
  });

  it('reads no mark outside a reference file or inside a fenced block (NEGATIVE)', () => {
    expect(
      unnamedLockedMarks(
        skillWithLockedList(
          [],
          ['## Parts', '', '```', '- **Widget** **Locked (2026-09-30)**', '```', ''].join('\n'),
        ),
      ),
    ).toEqual([]);
  });

  it('are all named in the real kiko-design-system skill', () => {
    const forms = readFileSync(
      join(REPOSITORY_ROOT, '.claude/skills/kiko-design-system/component-set-forms.md'),
      'utf8',
    );

    expect(forms.match(/\*\*Locked/g)?.length).toBeGreaterThan(0);
    expect(unnamedLockedMarks(join(REPOSITORY_ROOT, SKILL_FILE))).toEqual([]);
  });
});

describe('the index bullets of a skill with reference files', () => {
  afterEach(removeTemporaryDirectories);

  const SKILL_FILE = '.claude/skills/demo/SKILL.md';

  const skillWithReference = (bullet: string, reference: string): string => {
    const root = fixtureRoot({
      [SKILL_FILE]: ['# Demo', '', '## Reference files', '', bullet, '', '## After', ''].join('\n'),
      '.claude/skills/demo/parts.md': reference,
    });

    return join(root, SKILL_FILE);
  };

  const BULLET = [
    '- [parts.md](parts.md) — "Parts": the `Widget`, the gizmo',
    '  and the rule "Scroll rule", the trailing note, `useHook`. Read it before you touch them.',
  ].join('\n');

  const PARTS = [
    '## Parts',
    '',
    '- **Widget** — a widget.',
    '- **Gizmo** — a gizmo.',
    '- **Trailing note.** A lead may end in a period.',
    '- **`useHook()`** — a call written with its parentheses.',
    '  - **Nested** — a nested lead is no index entry.',
    '',
    '### Scroll rule',
    '',
    '## Scroll rule — with a tail',
    '',
  ].join('\n');

  it('name every heading and every bold lead of the reference file (POSITIVE)', () => {
    expect(indexLeadGaps(skillWithReference(BULLET, PARTS))).toEqual([]);
  });

  it('name a bold lead missing from the bullet (NEGATIVE)', () => {
    expect(indexLeadGaps(skillWithReference(BULLET, `${PARTS}- **Sprocket** — new.\n`))).toEqual([
      { file: 'parts.md', lead: 'Sprocket' },
    ]);
  });

  it('name a second-level heading missing from the bullet (NEGATIVE)', () => {
    expect(indexLeadGaps(skillWithReference(BULLET, `${PARTS}\n## Extra section\n`))).toEqual([
      { file: 'parts.md', lead: 'Extra section' },
    ]);
  });

  it('read a lead a heading or a bullet of another file would not cover (NEGATIVE)', () => {
    expect(
      indexLeadGaps(
        skillWithReference(
          '- [parts.md](parts.md) — "Parts": only that.\n\n- [other.md](other.md) — the Widget.',
          PARTS,
        ),
      ),
    ).toEqual([
      { file: 'parts.md', lead: 'Widget' },
      { file: 'parts.md', lead: 'Gizmo' },
      { file: 'parts.md', lead: 'Trailing note' },
      { file: 'parts.md', lead: 'useHook' },
      { file: 'parts.md', lead: 'Scroll rule' },
    ]);
  });

  it('do not read a heading or a lead inside a fenced block (NEGATIVE)', () => {
    expect(
      indexLeadGaps(
        skillWithReference(BULLET, `${PARTS}\n\`\`\`\n## Fenced\n- **Hidden** — x\n\`\`\`\n`),
      ),
    ).toEqual([]);
  });

  it('are complete for every reference file of the real skills', () => {
    const skills = ['kiko-architecture', 'kiko-design-system', 'kiko-linter'];

    expect(
      skills.flatMap((skill) =>
        indexLeadGaps(join(REPOSITORY_ROOT, '.claude/skills', skill, 'SKILL.md')),
      ),
    ).toEqual([]);
  });
});

// Here, not beside the fixture rows in test-support: the doc-suite discovery lists only this
// folder's top-level suites, so a row elsewhere never runs in the Stop tier or `make doc-suites`.
describe('the reference files of the real skill folders', () => {
  it('are all linked from their SKILL.md, so the doc suites read every one', () => {
    expect(
      SKILL_ROOTS.flatMap((skills) => orphanReferenceFiles(join(REPOSITORY_ROOT, skills))),
    ).toEqual([]);
  });
});
