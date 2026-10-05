import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// Every other pre-write-guard test stubs semgrep entirely (see
// pre-write-guard.test.ts), so nothing else in the suite proves
// rules/semgrep-prewrite.yml itself — the file the hook loads by default —
// actually catches what it claims to. This file runs the REAL semgrep
// binary against the REAL rules file, feeding it each covered rule's own
// fixture pair from rules/fixtures/ (targeted at a throwaway
// src/probe/<rule-id>.ts inside a temp CLAUDE_PROJECT_DIR, never at
// rules/fixtures/ itself, which the guard's own scope excludes). Skips with
// a clear failure — never a silent pass — when semgrep is missing, the same
// convention scripts/checks/security.sh and semgrep-rules.sh use.
const SCRIPT = join(__dirname, '../scripts/checks/pre-write-guard.sh');
const DISPATCH = join(__dirname, '../harness/kiko/hooks/dispatch.sh');
const FIXTURES = join(__dirname, '../rules/fixtures');
const REPOSITORY_ROOT = join(__dirname, '..');
// The coordinator's own session (and any subagent it starts) can have
// CLAUDE_PROJECT_DIR pointed at a DIFFERENT checkout than the file being
// edited — a subagent driven from the main checkout, editing a file in
// THIS worktree, being the real case this guards against (see
// harness/kiko/hooks/dispatch.sh's own header). A real `git worktree add`
// is not created for this test (never create a git worktree); this
// worktree's own relationship to the main checkout — a real linked
// worktree sharing the SAME git common dir — already exists, so this test
// points CLAUDE_PROJECT_DIR at it, read-only.
const MAIN_CHECKOUT_ROOT = '/Users/drizzer14/Developer/Projects/pff-ios';

// The first four were moved into rules/semgrep-prewrite.yml from
// rules/semgrep-mobile.yml as part of the guard's own consolidation; every
// prewrite-only rule added since (rule 8 on) lands in this same list.
const RULE_IDS_WITH_FIXTURES = [
  'kiko-no-switch',
  'kiko-no-nullable-map-ternary',
  'kiko-no-use-animated-keyboard',
  'kiko-no-swipe-action',
  'kiko-no-raw-category-title-in-message',
  'kiko-no-full-table-select-in-write',
  'kiko-no-history-id-comment',
  'kiko-no-history-word-comment',
  'kiko-no-task-id-comment',
  'kiko-no-raw-color-literal',
  'kiko-glass-surface-nav-layer-only',
  'kiko-no-placeholder-equal-to-label',
  'kiko-no-undefined-nitro-prop',
  'kiko-no-hand-built-divider',
  'kiko-no-raw-field-error-text',
  'kiko-no-hand-built-selectable-row',
  'kiko-no-literal-sync-error',
  'kiko-no-literal-biometric-label',
  'kiko-worklet-directive-required',
  'kiko-pinned-sync-button-variant',
  'kiko-pinned-change-bank-button-variant',
  'kiko-pinned-cancel-button-style',
  'kiko-no-direct-default-transaction-description',
  'kiko-no-process-env-time-zone-in-test',
  'kiko-no-confirm-sheet-in-form',
  'kiko-no-empty-object-jsx-spread',
  'kiko-no-needless-async-either-thunk',
  'kiko-no-math-min-max-spread',
  'kiko-no-root-calendars-value-import',
  'kiko-no-raw-error-in-console',
  'kiko-no-clipboard-set-string',
  'kiko-no-per-bucket-date-in-statistics',
  'kiko-no-bare-lowercase-category-fold',
  'kiko-no-date-utc-in-statement-import',
  'kiko-no-device-zone-in-statement-import',
  'kiko-no-source-text-read-in-test',
  'kiko-no-fixed-day-offset-on-real-clock-in-test',
  'kiko-header-item-native-only',
  'kiko-no-header-spacing-item',
  'kiko-no-direct-notification-permission-request',
  'kiko-no-fixed-day-offset-into-local-day',
  'kiko-no-redundant-button-full-width',
  'kiko-no-local-day-length-constant',
  'kiko-no-whole-price-points-read',
] as const;

// kiko-no-literal-sync-error carries a path-prefixed `paths.include` (
// `src/crypto-sync/**`/`src/monobank/**`), so its fixture pair is NESTED
// (rules/fixtures/<rule-id>/<mirrored path>/, per semgrep-rules.sh's own
// nested-fixture support) rather than flat at `rules/fixtures/<rule-id>.*` —
// this maps a rule id to that pair's path prefix, relative to FIXTURES, with
// no `.bad`/`.good`/extension suffix. A rule absent here uses the flat,
// same-name-as-the-rule-id default.
const NESTED_FIXTURE_PREFIXES: Partial<Record<(typeof RULE_IDS_WITH_FIXTURES)[number], string>> = {
  'kiko-no-literal-sync-error': 'kiko-no-literal-sync-error/src/monobank/sync-example',
  'kiko-no-process-env-time-zone-in-test':
    'kiko-no-process-env-time-zone-in-test/src/test-support/time-zone-example',
  'kiko-no-confirm-sheet-in-form': 'kiko-no-confirm-sheet-in-form/src/screens/forms/form-example',
  'kiko-no-empty-object-jsx-spread':
    'kiko-no-empty-object-jsx-spread/src/screens/settings/settings-row-example',
  'kiko-no-per-bucket-date-in-statistics':
    'kiko-no-per-bucket-date-in-statistics/src/statistics/bucket-example',
  'kiko-no-bare-lowercase-category-fold':
    'kiko-no-bare-lowercase-category-fold/src/statistics/category-fold-example',
  'kiko-no-date-utc-in-statement-import':
    'kiko-no-date-utc-in-statement-import/src/statement-import/date-example',
  'kiko-no-device-zone-in-statement-import':
    'kiko-no-device-zone-in-statement-import/src/statement-import/zone-example',
  'kiko-no-source-text-read-in-test':
    'kiko-no-source-text-read-in-test/src/test-support/source-read-example',
  'kiko-no-fixed-day-offset-on-real-clock-in-test':
    'kiko-no-fixed-day-offset-on-real-clock-in-test/src/test-support/day-offset-example',
};

// A rule scoped by `paths.include` only fires when the guard's OWN probe
// target sits under a matching path — this maps such a rule id to the
// probe directory (relative to the temp project root) that satisfies its
// scope. A rule absent here probes at the default `src/probe`.
const PROBE_DIRECTORIES: Partial<Record<(typeof RULE_IDS_WITH_FIXTURES)[number], string>> = {
  'kiko-no-literal-sync-error': 'src/monobank',
  'kiko-no-process-env-time-zone-in-test': 'src/test-support',
  'kiko-no-confirm-sheet-in-form': 'src/screens/forms',
  'kiko-no-empty-object-jsx-spread': 'src/screens/settings',
  'kiko-no-per-bucket-date-in-statistics': 'src/statistics',
  'kiko-no-bare-lowercase-category-fold': 'src/statistics',
  'kiko-no-date-utc-in-statement-import': 'src/statement-import',
  'kiko-no-device-zone-in-statement-import': 'src/statement-import',
  'kiko-no-source-text-read-in-test': 'src/test-support',
  'kiko-no-fixed-day-offset-on-real-clock-in-test': 'src/test-support',
};

function fixturePrefix(ruleId: string): string {
  return NESTED_FIXTURE_PREFIXES[ruleId as (typeof RULE_IDS_WITH_FIXTURES)[number]] ?? ruleId;
}

function probeDirectorySegments(ruleId: string): string[] {
  const directory =
    PROBE_DIRECTORIES[ruleId as (typeof RULE_IDS_WITH_FIXTURES)[number]] ?? 'src/probe';

  return directory.split('/');
}

// Most rules have no JSX shape, so their fixtures are plain `.ts`; a rule
// whose pattern needs a real JSX element (e.g. `kiko-no-placeholder-equal-
// to-label`) needs `.tsx` instead, both for the fixture file itself and for
// the probe target the guard scans it as, so the guard's TypeScript parser
// picks the JSX-aware grammar.
function fixtureExtension(ruleId: string): 'ts' | 'tsx' {
  return existsSync(join(FIXTURES, `${fixturePrefix(ruleId)}.bad.tsx`)) ? 'tsx' : 'ts';
}

function payloadFor(filePath: string, content: string): string {
  return JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  });
}

function runGuard(input: string, projectDirectory: string): SpawnSyncReturns<string> {
  return spawnSync('bash', [SCRIPT], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDirectory },
  });
}

describe('scripts/checks/pre-write-guard.sh against rules/semgrep-prewrite.yml (real semgrep)', () => {
  it('has semgrep available on PATH', () => {
    const which = spawnSync('which', ['semgrep'], { encoding: 'utf8' });

    expect(which.status).toBe(0);
  });

  it.each(RULE_IDS_WITH_FIXTURES)(
    'denies the %s positive fixture and allows the negative one',
    (ruleId) => {
      const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-rules-'));
      try {
        const probeDirectory = join(project, ...probeDirectorySegments(ruleId));
        mkdirSync(probeDirectory, { recursive: true });
        const extension = fixtureExtension(ruleId);
        const targetFile = join(probeDirectory, `${ruleId}.${extension}`);
        const prefix = fixturePrefix(ruleId);

        const badContent = readFileSync(join(FIXTURES, `${prefix}.bad.${extension}`), 'utf8');
        const badResult = runGuard(payloadFor(targetFile, badContent), project);
        expect(badResult.status).toBe(2);
        const reason = JSON.parse(badResult.stdout).hookSpecificOutput.permissionDecisionReason;
        // The probe file is named for the rule, so a bare id also matches a
        // deny from another rule; only the finding header proves this rule fired.
        expect(reason).toContain(`rule ${ruleId} at `);

        const goodContent = readFileSync(join(FIXTURES, `${prefix}.good.${extension}`), 'utf8');
        const goodResult = runGuard(payloadFor(targetFile, goodContent), project);
        expect(goodResult.status).toBe(0);
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    },
  );

  // kiko-no-history-id-comment's own paths.exclude only names "__tests__/**"
  // and "e2e/**" (the legacy top-level test directories), never a bare
  // "*.test.tsx" — unlike kiko-no-raw-color-literal, which excludes every
  // test file. A co-located test file under src/ (this project's own
  // folder-per-thing convention) is therefore in scope, and a brand-new one
  // has no BEFORE tree at all, so every finding in it is new by definition.
  // This closes the gap: nothing else in this suite writes a NEW file under
  // src/ with a history-id comment.
  it('denies a Write of a new co-located test file containing a history-id comment', () => {
    const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-history-'));
    try {
      const targetDirectory = join(project, 'src', 'screens', 'statistics');
      mkdirSync(targetDirectory, { recursive: true });
      const targetFile = join(targetDirectory, 'new-probe.test.tsx');
      const content = [
        '// T12 review round 3: this probe pins the regression the fix covers.',
        'export const probeValue = 1;',
        '',
      ].join('\n');

      const result = runGuard(payloadFor(targetFile, content), project);

      expect(result.status).toBe(2);
      const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
      expect(reason).toContain('kiko-no-history-id-comment');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // A history rule's finding is keyed on the watched word or id alone, so editing the other text
  // of a comment that already holds one adds nothing, while a new or changed one is denied.
  const historyBaseline = [
    '/**',
    ' * Opening line of the note.',
    ' * The picker no longer ships here, see Bug 8 for the rest.',
    ' * Closing line of the note.',
    ' */',
    'export const block = 1;',
    '',
    '// The sheet no longer pushes a duplicate instance, see Bug 9.',
    'export const line = 2;',
    '',
  ].join('\n');

  function editHistoryBaseline(from: string, to: string): SpawnSyncReturns<string> {
    const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-history-edit-'));
    try {
      const targetDirectory = join(project, 'src', 'probe');
      mkdirSync(targetDirectory, { recursive: true });
      const targetFile = join(targetDirectory, 'history-edit.ts');
      writeFileSync(targetFile, historyBaseline);
      const payload = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: targetFile, old_string: from, new_string: to },
      });

      return runGuard(payload, project);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }

  it.each([
    ['allows editing text before the word in a block comment', 'Opening line', 'First line', 0],
    ['allows editing text after the word in a block comment', 'Closing line', 'Last line', 0],
    ['allows editing text around the word on its line', 'ships here, see', 'ships there, see', 0],
    ['allows editing text before the word in a line comment', 'sheet no', 'page no', 0],
    ['allows editing text after the word in a line comment', 'duplicate instance', 'second one', 0],
    [
      'denies a new word in a new comment',
      'export const line = 2;',
      '// It no longer ships.\nexport const line = 2;',
      2,
    ],
    ['denies a changed word in a comment', 'no longer ships', 'previously shipped', 2],
    [
      'denies a new id in a new comment',
      'export const line = 2;',
      '// Bug 10 is fixed.\nexport const line = 2;',
      2,
    ],
    [
      'denies a second word added to a block comment that already holds one',
      'Closing line of the note.',
      'Previously it rendered twice.',
      2,
    ],
    [
      'denies a second word added to a line comment that already holds one',
      'see Bug 9.',
      'see Bug 9; previously it pushed two.',
      2,
    ],
    [
      'denies the same word added a second time to a comment that already holds it',
      'Closing line of the note.',
      'It is no longer here either.',
      2,
    ],
    [
      'denies a second id added to a block comment that already holds one',
      'Closing line of the note.',
      'Closing note, see T14.',
      2,
    ],
    ['denies a second id on a flagged line', 'see Bug 9.', 'see Bug 9 and T14.', 2],
  ])('%s', (_name, from, to, status) => {
    expect(editHistoryBaseline(from, to).status).toBe(status);
  });

  // The key is the word alone, so the deny cannot tell which of several equal words is the new
  // one (the occurrence rank counts in file order); it names every line that holds the word.
  it('names every line that holds the word when the edit adds it above an existing one', () => {
    const result = editHistoryBaseline(
      'export const block = 1;',
      'export const block = 1;\n// It no longer ships.',
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('rule kiko-no-history-word-comment at src/probe/history-edit.ts,');
    expect(reason).toContain('one of lines 3, 7, 9 is new');
  });

  // kiko-worklet-directive-required excludes every test file: Jest mocks
  // reanimated, so the Release-only SIGABRT it guards against cannot happen
  // there, and its statement-sequence patterns are slow enough on a large
  // test file to hit Semgrep's per-rule timeout (a random "could not check"
  // deny). The rule's own positive fixture, written as a co-located test
  // file, must therefore be allowed.
  it.each([
    'src/probe/worklet-probe.test.ts',
    '__tests__/worklet-probe.ts',
    'e2e/worklet-probe.ts',
  ])(
    'allows the kiko-worklet-directive-required positive fixture written to test path %s',
    (relativeTarget) => {
      const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-worklet-test-'));
      try {
        const targetFile = join(project, ...relativeTarget.split('/'));
        mkdirSync(join(targetFile, '..'), { recursive: true });
        const badContent = readFileSync(
          join(FIXTURES, 'kiko-worklet-directive-required.bad.ts'),
          'utf8',
        );

        const result = runGuard(payloadFor(targetFile, badContent), project);

        expect(result.stdout).toBe('');
        expect(result.status).toBe(0);
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    },
  );

  // Content that does not parse cannot be checked, so it is denied; the
  // reason must name the parse error's file:line and Semgrep's own message,
  // and tell the agent to make each edit syntactically complete — a
  // half-applied multi-part change is the usual cause.
  it('names the parse error when the proposed content does not parse', () => {
    const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-parse-'));
    try {
      const targetDirectory = join(project, 'src', 'probe');
      mkdirSync(targetDirectory, { recursive: true });
      const content = [
        'export const value = 1;',
        '',
        'export function broken( {',
        '  return value +;',
        '}',
        '',
      ].join('\n');

      const result = runGuard(payloadFor(join(targetDirectory, 'broken.ts'), content), project);

      expect(result.status).toBe(2);
      const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
      expect(reason).toContain('src/probe/broken.ts:3');
      expect(reason).toContain('was unexpected');
      expect(reason).toContain('syntactically complete');
      expect(reason).toContain('MultiEdit');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // Proves, THROUGH the dispatcher and the REAL guard, that a worktree
  // edit is still checked when CLAUDE_PROJECT_DIR points at a DIFFERENT
  // checkout (the exact shape the dispatcher exists to fix — see
  // harness/kiko/hooks/dispatch.sh's own header). file_path sits inside
  // THIS worktree (an existing src/ directory, never actually written to —
  // the guard only ever writes into its own mkdtemp scratch tree), while
  // CLAUDE_PROJECT_DIR is the main checkout, a DIFFERENT top-level
  // directory. If the dispatcher fell back to resolving against
  // CLAUDE_PROJECT_DIR instead of the file's own worktree, the guard's
  // relativeInProject check would call this file "outside the project" and
  // allow it unchecked; it must instead deny, exactly like the plain
  // history-id test above.
  it('denies through the dispatcher when CLAUDE_PROJECT_DIR points at a different checkout', () => {
    const targetDirectory = join(REPOSITORY_ROOT, 'src', 'screens', 'statistics');
    const targetFile = join(targetDirectory, 'new-probe-i3.test.tsx');
    const content = [
      '// T12 review round 3: this probe pins the regression the fix covers.',
      'export const probeValue = 1;',
      '',
    ].join('\n');

    const result = spawnSync('bash', [DISPATCH, 'pre-write-guard.sh'], {
      input: payloadFor(targetFile, content),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: MAIN_CHECKOUT_ROOT },
    });

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('kiko-no-history-id-comment');
  });

  // A NEW flip is denied in every test path the rule covers, while app source
  // (where TZ is not a test sandbox copy) stays out of scope.
  it.each([
    ['src/probe/time-zone-probe.test.ts', 2],
    ['src/probe/time-zone-probe.test.tsx', 2],
    ['__tests__/time-zone-probe.ts', 2],
    ['src/probe/time-zone-probe.ts', 0],
  ])('kiko-no-process-env-time-zone-in-test on %s exits %s', (relativeTarget, status) => {
    const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-time-zone-'));
    try {
      const targetFile = join(project, ...relativeTarget.split('/'));
      mkdirSync(join(targetFile, '..'), { recursive: true });
      const content = "export const pin = (): void => {\n  process.env.TZ = 'UTC';\n};\n";

      const result = runGuard(payloadFor(targetFile, content), project);

      expect(result.status).toBe(status);

      if (status === 2) {
        const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
        expect(reason).toContain('kiko-no-process-env-time-zone-in-test');
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // The guard denies only a NEW finding, so an edit that adds no flip to a
  // file whose flip predates it must still land.
  it('allows an edit to a test file whose time-zone flip already existed', () => {
    const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-time-zone-baseline-'));
    try {
      const targetDirectory = join(project, 'src', 'probe');
      mkdirSync(targetDirectory, { recursive: true });
      const targetFile = join(targetDirectory, 'time-zone-probe.test.ts');
      const existing = "export const pin = (): void => {\n  process.env.TZ = 'UTC';\n};\n";
      writeFileSync(targetFile, existing);
      const payload = JSON.stringify({
        tool_name: 'Edit',
        tool_input: {
          file_path: targetFile,
          old_string: 'export const pin',
          new_string: 'export const other = 1;\n\nexport const pin',
        },
      });

      const result = runGuard(payload, project);

      expect(result.stdout).toBe('');
      expect(result.status).toBe(0);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  const sourceReadProbe = [
    "import { readFileSync } from 'node:fs';",
    '',
    "export const schemaText = (): string => readFileSync(`${__dirname}/schema.ts`, 'utf8');",
    '',
  ].join('\n');

  const dayOffsetProbe = [
    "import { DAY_MS } from '@kiko/dates';",
    '',
    'export const tomorrow = (): number => Date.now() + DAY_MS;',
    '',
  ].join('\n');

  // Both rules guard test code only. A co-located test is where a source read
  // or a real-clock fixture lands; app source reads files and the real clock at
  // runtime on purpose, and a harness test under __tests__/ reads rules,
  // scripts and docs, which mutation testing never rewrites. A test that keeps
  // one overridden read is still checked on every other line.
  const sourceRead = 'kiko-no-source-text-read-in-test';
  const dayOffset = 'kiko-no-fixed-day-offset-on-real-clock-in-test';

  it.each([
    [sourceRead, 'src/probe/source-read-probe.test.ts', 2, sourceReadProbe],
    [sourceRead, 'src/probe/source-read-probe.test.tsx', 2, sourceReadProbe],
    [sourceRead, 'src/db/settings-columns.test.ts', 2, sourceReadProbe],
    [sourceRead, 'src/probe/source-read-probe.ts', 0, sourceReadProbe],
    [sourceRead, '__tests__/source-read-probe.test.ts', 0, sourceReadProbe],
    [dayOffset, 'src/probe/day-offset-probe.test.ts', 2, dayOffsetProbe],
    [dayOffset, 'src/probe/day-offset-probe.test.tsx', 2, dayOffsetProbe],
    [dayOffset, 'src/probe/day-offset-probe.ts', 0, dayOffsetProbe],
  ])('%s on %s exits %s', (ruleId, target, status, content) => {
    const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-test-scope-'));
    try {
      const targetFile = join(project, ...target.split('/'));
      mkdirSync(join(targetFile, '..'), { recursive: true });

      const result = runGuard(payloadFor(targetFile, content), project);

      expect(result.status).toBe(status);

      if (status === 2) {
        const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
        expect(reason).toContain(ruleId);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // A test's own day length drifts from DAY_MS just like app code's, so only
  // src/dates/, the owner of DAY_MS, is out of scope.
  const dayLengthProbe = [
    'const DAY = 86_400_000;',
    '',
    'export const tomorrow = (time: number): number => time + DAY;',
    '',
  ].join('\n');
  const dayLength = 'kiko-no-local-day-length-constant';

  it.each([
    ['src/probe/day-length-probe.test.ts', 2],
    ['src/probe/day-length-probe.test.tsx', 2],
    ['__tests__/day-length-probe.test.ts', 2],
    ['src/test-support/day-length-probe.ts', 2],
    ['e2e/probe/day-length-probe.ts', 2],
    ['src/dates/day-length-probe.ts', 0],
  ])(`${dayLength} on %s exits %s`, (target, status) => {
    const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-day-length-scope-'));
    try {
      const targetFile = join(project, ...target.split('/'));
      mkdirSync(join(targetFile, '..'), { recursive: true });

      const result = runGuard(payloadFor(targetFile, dayLengthProbe), project);

      expect(result.status).toBe(status);

      if (status === 2) {
        const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
        expect(reason).toContain(`rule ${dayLength} at `);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // The whole-table read is allowed in its two owner folders and in tests,
  // and denied everywhere else in app source.
  // No import: the owner folders may not import their own feature by alias.
  const wholeReadProbe = ['export const useBook = () => usePriceBook();', ''].join('\n');
  const wholeRead = 'kiko-no-whole-price-points-read';

  it.each([
    ['src/probe/whole-read-probe.ts', 2],
    ['src/screens/probe/whole-read-probe.tsx', 2],
    ['src/probe/whole-read-probe.test.ts', 0],
    ['src/prices/use-price-book/whole-read-probe.ts', 0],
    ['src/prices/price-points-repo/whole-read-probe.ts', 0],
  ])(`${wholeRead} on %s exits %s`, (target, status) => {
    const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-whole-read-scope-'));
    try {
      const targetFile = join(project, ...target.split('/'));
      mkdirSync(join(targetFile, '..'), { recursive: true });

      const result = runGuard(payloadFor(targetFile, wholeReadProbe), project);

      expect(result.status).toBe(status);

      if (status === 2) {
        const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
        expect(reason).toContain(`rule ${wholeRead} at `);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // kiko-no-native-reminders-module-import is not in RULE_IDS_WITH_FIXTURES:
  // its negative fixture's type-only imports name the spec by a path the
  // feature-import rule rejects at the src/probe target, and a relative path
  // there would not type-check from rules/fixtures/. These probes sit inside
  // the native feature itself, where a relative import is legal. The quoted
  // specifier is joined in, so this file never holds a loading call itself.
  const nativeSpecSpecifier = "'./NativeKikoReminders'";

  it.each([
    [
      'denies a value import next to the spec',
      'src/reminders/native/probe.ts',
      'import NativeKikoReminders from '.concat(
        nativeSpecSpecifier,
        ';\n\nexport const probe = NativeKikoReminders;\n',
      ),
      2,
    ],
    [
      'allows a type-only import next to the spec',
      'src/reminders/native/probe.ts',
      'import type { Spec } from '.concat(nativeSpecSpecifier, ';\n\nexport type Probe = Spec;\n'),
      0,
    ],
    [
      'allows the lazy require in the wrapper itself',
      'src/reminders/native/reminders-native.ts',
      'export const load = (): unknown => require('.concat(nativeSpecSpecifier, ').default;\n'),
      0,
    ],
  ])('kiko-no-native-reminders-module-import %s', (_name, relativeTarget, content, status) => {
    const project = mkdtempSync(join(tmpdir(), 'kiko-prewrite-native-module-'));
    try {
      const targetFile = join(project, ...relativeTarget.split('/'));
      mkdirSync(join(targetFile, '..'), { recursive: true });

      const result = runGuard(payloadFor(targetFile, content), project);

      expect(result.status).toBe(status);

      if (status === 2) {
        const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
        expect(reason).toContain('kiko-no-native-reminders-module-import');
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
