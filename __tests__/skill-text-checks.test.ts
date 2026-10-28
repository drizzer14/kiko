import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { helperCatalogueGaps, indexLeadGaps, unnamedLockedMarks } from './test-support/skill-text';

// What the skill text must say about the files beside it: the kiko-testing helper catalogue, the
// Locked marks of the kiko-design-system reference files, and the index bullets of a skill with
// reference files. The citation rows stay in skill-citations.test.ts.
const REPOSITORY_ROOT = join(__dirname, '..');

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
