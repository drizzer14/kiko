import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';

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
const FIXTURES = join(__dirname, '../rules/fixtures');

// The first four were moved into rules/semgrep-prewrite.yml from
// rules/semgrep-mobile.yml as part of the guard's own consolidation; every
// prewrite-only rule added since (rule 8 on) lands in this same list.
const RULE_IDS_WITH_FIXTURES = [
  'kiko-no-switch',
  'kiko-no-nullable-map-ternary',
  'kiko-no-use-animated-keyboard',
  'kiko-no-history-id-comment',
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
};

// A rule scoped by `paths.include` only fires when the guard's OWN probe
// target sits under a matching path — this maps such a rule id to the
// probe directory (relative to the temp project root) that satisfies its
// scope. A rule absent here probes at the default `src/probe`.
const PROBE_DIRECTORIES: Partial<Record<(typeof RULE_IDS_WITH_FIXTURES)[number], string>> = {
  'kiko-no-literal-sync-error': 'src/monobank',
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
        expect(reason).toContain(ruleId);

        const goodContent = readFileSync(join(FIXTURES, `${prefix}.good.${extension}`), 'utf8');
        const goodResult = runGuard(payloadFor(targetFile, goodContent), project);
        expect(goodResult.status).toBe(0);
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    },
  );
});
