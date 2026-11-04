---
name: kiko-linter
description: Invoke when adding or changing a harness check (scripts/checks/*.sh), a Semgrep rule in rules/semgrep-mobile.yml or rules/semgrep-prewrite.yml, a pre-write guard rule (pre-write-guard.js NODE_RULES), a Node checker (scripts/checks/*.js), a fixture under rules/fixtures, a Biome rule, a plist assertion, or a Jest invariant test that mechanizes a review finding.
---

# Kiko linter and harness-check authoring

Source of truth: `docs/harness/checks.md` (the authoritative check rows and hook
wiring; `CLAUDE.md` carries the short form, plus "Override protocol" and
"Documented exceptions") and `scripts/checks/_lib.sh`. This skill
states the conventions for adding to the harness itself — the checks
that check the app, not the app's own code style (see
`kiko-code-style` for that). The files named below
(`scripts/checks/semgrep-rules.sh`, `scripts/checks/plist.sh`,
`scripts/checks/typecheck.sh`, `rules/fixtures/`) all exist in the
tree today.

The root `Makefile`'s `verify` target (`make verify`, wrapping
`scripts/checks/verify.sh`) is the end-of-work verify. The COORDINATOR queues it
(`bash scripts/job-queue.sh verify <worktree> <label> [--sha <commit>] [--scoped]`) when an
orchestrator reports READY FOR VERIFY: `--scoped` on a track verify, no flag on a main-bound one
(`scripts/ff-main.sh` needs a full verify); a typed `make verify` is
denied (see "Heavy-job and full-jest deny"). It runs `check:all` (the fast+medium gate, whose
first check is lint), then the full Jest suite in two
stages (2a: every suite but the real-semgrep ones, with the tripwire shim
`scripts/checks/semgrep-tripwire/semgrep` first on PATH; 2b: the suites listed in
`scripts/checks/semgrep-jest-suites.txt`, in band; a missing or empty list fails closed) as
ORDERED, FAIL-FAST stages, stopping at the first failing stage rather than always running all
of them. Stage 2b is skipped only with `--scoped` and no trigger path changed
(`scripts/checks/semgrep-suite-triggers.txt`; a Markdown file under `harness/` is no trigger,
user ruling 2026-11-04); any doubt runs it. Read `verify.sh` directly for the exact stage commands rather
than restating them here; a new harness check that belongs in the
fast+medium gate is picked up by `make verify` automatically through
`check:all`, with no `Makefile` change needed.

## Reference files (read the one your task touches)

This skill is SKILL.md plus the reference files below; their `##` sections are cited by name
(`kiko-linter's "The wrapper contract"`) exactly as SKILL.md's own sections are, and they hold
the long detail that is read only when the task touches it. Read the file before you edit the
code it describes.

- [wrapper-contract.md](wrapper-contract.md) — "The wrapper contract": the shape of every
  `scripts/checks` wrapper (fail block, silent success and its stated exceptions), and the
  hook guards `kill-guard.sh`/`kill-guard.js` (every deny kind, the tokenizer, probing rules,
  known limits), `pre-write-guard.sh`, and `mutation.sh` (diff scope, cap, lock, scorer). Read
  it before you change a wrapper, a hook guard or the mutation gate, or when a deny reason
  cites a kind.
- [semgrep-facts.md](semgrep-facts.md) — the "Semgrep facts verified on ..." sections:
  measured Semgrep behaviour (`paths.include`, taint, `pattern-inside`, YAML quoting, speed),
  as "Semgrep facts verified on 1.175", "Semgrep facts verified on 2026-10-11
  (kiko-no-typed-jest-require-actual)", "Semgrep facts verified on 2026-09-25 (pre-write guard
  build-out)", "Semgrep facts verified on 2026-09-28 (the Round A guard rules)", "Semgrep facts
  verified on 2026-09-29 (kiko-no-needless-async-either-thunk)", "Semgrep facts verified on
  2026-09-29 (kiko-no-source-text-read-in-test)" and "Semgrep facts verified on 2026-10-01 (the
  P5 guard rules)". Read it before you write or debug a Semgrep rule.
- [rules-comments.md](rules-comments.md) — the per-rule sections for the comment and test-title
  guards ("F4 code-style mechanization candidates", `kiko-no-stale-guideline-2-3-1a-citation`,
  `kiko-no-history-id-comment`, `kiko-no-history-word-comment`,
  `kiko-no-history-date-comment`, `kiko-no-task-id-comment`,
  `kiko-no-change-language-in-test-body`, `kiko-test-title-no-history`, and the rules
  implemented beside them). Read it before you change one of those rules or their fixtures.
- [rules-code.md](rules-code.md) — the per-rule sections for the code-shape rules and
  invariants ("Implemented: a rule for a plain function called inside a worklet" with
  `kiko-worklet-directive-required`, `kiko-rejects-to-throw-needs-error`,
  `kiko-sortable-grid-lone-card-lifts`, `kiko-kind-ternary-prefers-match`,
  `kiko-type-ternary-prefers-match`, `kiko-no-inline-text-variant-mock`,
  `kiko-component-explicit-return`, "The `docs-known-limit` invariant",
  `kiko-no-typed-jest-require-actual`, one exported component per `.tsx`, import
  length-sort, `kiko-no-switch`, full words in identifiers). Read it
  before you change one of those rules or their fixtures.

## The fixture contract (Semgrep rules)

A Semgrep rule that mechanizes a finding needs a fixture pair, run by
`scripts/checks/semgrep-rules.sh`:

- `rules/fixtures/<rule-id>.bad.<ext>` — must draw at least one finding
  from its own rule.
- `rules/fixtures/<rule-id>.good.<ext>` — must draw zero findings from
  every rule.
- Discovery is by **filename**: the runner credits a finding toward a
  rule only when the finding's fixture file is literally named for
  that rule id. A companion rule (see "taint does not propagate
  through `.then`" in semgrep-facts.md) needs **its own** dedicated fixture pair —
  a finding that happens to land on a *different* rule's fixture file
  proves nothing about the companion rule; this was a real gap, caught
  and fixed only because a reviewer deliberately broke the companion
  rule and watched the check stay green.
- An optional `// EXPECT-FINDING` comment directly above a line in a
  `.bad` fixture pins the rule to fire on that exact line — use this
  when a coarse ">= 1 finding anywhere in the file" contract could stay
  green after a regression that only breaks matching for a renamed
  binding (e.g. keying a rule on a metavariable name like `snapshot`
  or `item` instead of on the member being read).
- The runner asserts every fixture file appears in the scanner's
  `paths.scanned` list — a fixture Semgrep never opened must fail the
  check, not silently prove nothing.
- Biome format-checks a `.good.` fixture (never lints it; `biome.json`
  `overrides`) and skips a `.bad.` one. Format a new good fixture with
  `./node_modules/.bin/biome format --write <file>` (never `npx biome`:
  RTK rewrites it in agent Bash and it fails). A `pattern-regex` probe whose layout
  is the point keeps it with
  `// biome-ignore format: OVERRIDE(<reason>)` on the line above
  (example: `rules/fixtures/kiko-no-native-reminders-module-import.good.ts`).

## `semgrep-prewrite.yml` vs `semgrep-mobile.yml` — where a rule lives

`rules/semgrep-prewrite.yml` holds only the rules the pre-write guard
(`scripts/checks/pre-write-guard.js`, `KIKO_PREWRITE_RULES`) needs to
deny a write before it lands. Every one of those rules is ALSO loaded
as an additional `--config` by `scripts/checks/security.sh` and
`scripts/checks/semgrep-rules.sh` alongside `rules/semgrep-mobile.yml`,
so the project-wide gate keeps proving them against the real tree and
their `rules/fixtures/` pair unchanged. Each rule in
`semgrep-prewrite.yml` carries `metadata: { fix, skill }` —
`metadata.fix` is the one-line fix an agent applies, `metadata.skill`
points at the skill section (this file) explaining why; the guard
itself denies fail-closed on any rule missing `metadata.skill`, since
a deny that cannot point the agent anywhere is a guard bug. Add a NEW
prewrite-checkable rule to `semgrep-prewrite.yml` directly, not to
`semgrep-mobile.yml` — see that file's own header comment for the full
reasoning. One exception: the three generic shell comment-history rules
(`kiko-no-history-id-shell-comment`, `-word-`, `-date-`) live in `semgrep-mobile.yml`,
because the pre-write guard reads TypeScript only and a shell write never reaches it.

## Class A vs Class B

`rules/semgrep-mobile.yml` groups rules into two severities, both
enforced by `scripts/checks/security.sh` (read that file's current
findings-handling for the exact mechanism, not restated here):

- **Class A (ERROR)** — a deterministic, always-a-bug pattern (e.g.
  TLS validation disabled, a secret written to AsyncStorage). Any
  Class A finding fails the check; there is no override path.
- **Semgrep errors fail the check too.** A Semgrep exit code other than
  0/1, output that is not valid JSON, or an `errors[]` entry at level
  `error` or of type `Timeout` (Semgrep reports a timeout at warn level
  with exit 0) fails `check:security`, except a Timeout the single re-scan clears (next bullet).
  Other warn-level errors stay non-blocking. Read `scripts/checks/security.sh` for the exact
  test.
- **One re-scan for timed-out files.** The main scan runs with `--jobs 6`. Each file that timed
  out is re-scanned once alone with `--jobs 1`, with the same configs and the same 5 s
  timer. A pass prints one WARNING per rule and file pair (exit 0). More than 10 pairs, or any
  re-scan problem, fails. A warn-level `PartialParsing` entry in a re-scan also fails it
  (accepted ruling, I0-5 review F3). The re-scan is not an override. Read
  `scripts/checks/security.sh` for the limits.
- **Only registry rules that cannot match this repo are excluded.**
  `security.sh` passes `--exclude-rule <full check_id>`; the full id is
  the registry rule file's dotted path plus the rule's own id; copy it from
  the Semgrep JSON `check_id`, never build it by hand (for example
  `javascript.express.security.audit.express-ssrf.express-ssrf`). Semgrep
  1.175.0 silently ignores a short or unknown id: it excludes nothing and
  gives no error. A new id needs a `docs/harness/documented-exceptions.md`
  entry with a can-not-match proof and an update to
  `__tests__/security-excluded-registry-rules.test.ts`. Never exclude a
  `kiko-*` rule, a file, or an id that can match here; the proof is
  handler-shaped (any `(request, response)` HTTP handler, a sink package, or
  a DOM target means the matching ids come back). A Semgrep Timeout on a
  rule that still runs fails `check:security` unless the single re-scan clears it.
- **Every argument is scanned.** `security.sh` takes any number of targets
  (none means the whole repo), drops a `rules/fixtures/` file among them,
  and hands the rest to ONE Semgrep call. A call whose targets are all
  files dedups on every file's content, both rules files, and the
  `EXCLUDED_RULE_IDS` list (a list change forces a rescan; read it in
  `scripts/checks/security.sh`); a skip prints
  `SKIPPED, not a fresh scan` on stderr, so an exit 0 with no scan never
  reads as one. A failure block always names its cause (Semgrep's stderr,
  its `errors[]`, or the exit code) and a Class A/B block lists each
  finding from the JSON already in hand, not from a second Semgrep run.
  The `rules/fixtures/` drop is a prefix match and skips an argument with a
  `..` segment, so a path that starts under the fixtures folder and climbs
  back out of it is scanned.
- **Known limit: `src/**` includes need a root-relative path.** A rule whose
  `paths.include` is `src/**` does not match a path given relative to a
  working directory inside `src/`; `fast.sh` passes absolute paths and npm
  runs from the repo root, so neither shape hits this.
- **Class B (WARNING)** — a pattern that is usually right but can have
  a legitimate exception (e.g. taint mode also flags a value merely
  *derived* from a secret, which is a judgment call, not a
  deterministic violation). Class B findings are surfaced,
  override-eligible, and non-blocking on their own. Use Class B only
  when the rule's own comment can state a concrete, verifiable reason
  a finding might be a false positive — the same "justified, not bare"
  standard as a `biome-ignore` override.

## Every new ignore/exclude entry needs a CLAUDE.md exception

Any new entry in `.jscpd.json`, `biome.json`'s `files.includes`,
`knip.json`, `.depcheckrc.json`, `.gitleaks.toml`, or a semgrep
`--exclude` flag needs a matching entry in
`docs/harness/documented-exceptions.md` — see that file for the required shape: name the
config, name the exact path/value excluded, and state the concrete,
verifiable reason (a measured false-positive rate, a tool that cannot
parse the language, a generated-and-cumulative file format), not a
vague "not relevant". `rules/fixtures/**` is the running example: it
Biome skips its bad fixtures (`rules/fixtures/**/*.bad.*`) and only
format-checks the good ones, and it is excluded from Knip/jscpd/the real
Semgrep scan, each
independently verified as load-bearing by probing with a deliberately
bad file and confirming the check would otherwise fire on it.

## `check:dup`'s changed-file scope can surface PRE-EXISTING duplication

`check:dup`'s jscpd run is scoped to the session's changed source
files (see `docs/harness/checks.md` "Automatic wiring"), so a new test file
entering that changed-file set can pull an EXISTING sibling test file
along with it and cross the 5% threshold together, even though the
duplication (e.g. repeated fixture-building closures) predated the new
file and the new file didn't add any of it. The fix is still root-cause
extraction of the shared helper/builder into one place reused by both
old and new tests — never an ignore-list entry (the check fired
correctly; the duplication is real, just older than the diff) — and it
belongs in the SAME commit as the feature that triggered the check, so
`git log` shows one coherent change rather than a drive-by refactor
with no test-behavior delta.

The large-file pass runs on every call, a dedup skip included: see "`check:dup` measures the
files jscpd skips for size" below.

## `check:dup` measures the files jscpd skips for size

jscpd 4.3.0 skips a file over `maxLines` (1000, counted as `content.split('\n')`) or `maxSize`
(100kb) without a word, so a blocking run alone passes a project whose largest files were never
measured. `scripts/checks/dup.sh` keeps that blocking run exactly as it was (same config, same
default limits, same 5% threshold, same exit code, a jscpd crash still fails closed) and adds a
second pass, the large-file pass (WARN at or under a file's ceiling, FAIL otherwise):

- It asks jscpd itself which files are in scope: `--debug` lists the selected files and runs no
  detection. The files listed with the limits raised but not with the defaults are the ones the
  blocking run skipped, so the config's `ignore`, `.gitignore`, and the args (the Stop tier's
  changed files) apply to both lists by construction.
- It measures each skipped file ALONE with the limits raised (JSON reporter into a temp dir,
  nothing written into the repo). Alone, not in one combined run: a combined run credits a clone to
  whichever file jscpd stores first, so a file's percentage would depend on its neighbours. The
  alone figures are the ones the debt entry in `docs/harness/documented-exceptions.md` records.
  A per-file alone figure differs from a combined run (jscpd credits a clone to the first-stored
  file), so per-file debt needs the combined total too, and a baseline names its scope.
- One more run measures the WHOLE scope together with the limits raised, because a clone between a
  large file and another file is invisible to the alone runs (two 1100-line copies of one file
  show 0% alone and about 50% together). It runs only when the scope holds a size-skipped file and
  more than one file, so a scope with no large file runs no combined run and a one-file scope does
  not repeat its alone figure. The pass itself still costs the two file listings (about 1 s).
  The combined baseline is the `*combined*` row of `scripts/checks/dup-ceilings.tsv`, held by the
  no-argument run only; read the row there, not a figure copied here. A row at or under the
  `.jscpd.json` threshold (`*combined*` included) fails `__tests__/dup-ceilings-rows.test.ts`.
- The ceilings file `scripts/checks/dup-ceilings.tsv` is read up front on every run: a missing
  or malformed file (a bad row, a repeated path, no `*combined*` row) exits 2 before any jscpd
  run. Per class:
  - WARN (stderr, exit 0): a listed file over the threshold but at or under its ceiling; a
    scoped run's combined figure over the threshold; a row naming a file not on disk.
  - FAIL (`print_block`, exit 2): a listed file above its ceiling; an unlisted file over the
    threshold (a new regression); a file jscpd fails on or gives no figure for; a combined run
    that fails or, in the no-argument run, exceeds the `*combined*` baseline; a failed file
    listing; a failed `mktemp`.
  A number a tool printed is used only after `is_number` accepts it. The Stop tier's scoped run
  therefore measures only changed large files (and the combined figure of the changed set); a
  whole-repo run measures all of them. An unchanged dedup fingerprint skips only the blocking
  run: the large-file pass runs every time, so a repeated scoped run prints the same warning or
  failure again.
- A hook that exits 0 does not show the WARNING to the agent, so a person or a manual
  `check:dup` run is the reader; a FAIL block reaches the agent.
- The ceilings are tracked debt, not an allowlist. A figure never rises (dedupe the test), and a
  row changes only with a reviewer finding. The rows go once every large file is 5% or less
  alone AND the combined raised total is 5% or less (`docs/harness/documented-exceptions.md`).
- `__tests__/dup-large-files.test.ts` runs a copy of `dup.sh` in a throwaway project against the
  real jscpd, under `FORCE_COLOR=3` too. A file over about two billion lines or 1gb is not listed
  under the raised limits, so it would still pass unseen; no file of that size exists in this repo.

## Override forms and where each is honored

- Semgrep rule: `// nosemgrep: <rule-id> OVERRIDE(<reason>) <why>`.
- Node rule (a `NODE_RULES` row): `// kiko-override: <rule-id> OVERRIDE(<reason>) <why>`.
- Put the comment on the finding's line or the line above.
  `check:overrides` fails any `biome-ignore`, `nosemgrep`,
  `kiko-override:`, or `Stryker disable` comment without `OVERRIDE(`.
- The pre-write guard accepts either spelling for any rule id (its
  `OVERRIDE_COMMENT_PATTERN` in `pre-write-guard.js`), except a rule
  whose `NODE_RULES` row sets `overridable: false`. Such a rule has no
  override at all: the guard never reads an override comment for it, the
  finding still denies, and its deny text does not mention an override.
  Read `overridable: false` in `NODE_RULES` in
  `scripts/checks/pre-write-guard.js` for the current rows (at the time of
  writing: `kiko-comment-line-width` and `kiko-component-i18n-namespace`);
  guard-replay runs the unchanged guard, so it inherits the same refusal.
- `check:security` honors only Semgrep's own `nosemgrep`.
- The project-wide check of every `overridable: false` rule and its guard
  rule have no override of any kind (see the `overridable: false` bullet
  above).
- The other project-wide Node checkers (`check:import-order`,
  `check:full-word-identifiers`, `check:screen-imports`,
  `check:feature-imports`, `check:blank-line-separation`,
  `check:component-i18n-namespace`) have NO inline
  override either. A
  `kiko-override:` gets a write past the guard, and `check:all` still
  fails on that line. A Node-rule exception needs a checker-level
  exemption (like `EXEMPTIONS` in `full-word-identifiers.js`), which is
  developer code work. Decide how a justified exception passes both the
  guard and the project-wide checker before a new Node rule ships.

## Node checkers

Each runs as `node scripts/checks/<name>.js <file>`, as a guard
`NODE_RULES` row, and project-wide through a `.sh` wrapper in
`check:all` (`plural-count.js`: a Jest invariant instead, see its bullet). Every checker and the shared scanner stay reachable for
knip only through `knip.json`'s `ignore` (read the list there; it
includes `feature-imports.js` and `specifier-scanner.js`). None has a
report or JSON mode.

A Node checker never pre-filters RAW source text with a pattern that can span a comment
leader: test the name alone, or the leader-stripped text, or the filter fails open. A test
that skips what the checker skips reuses the checker's own pattern and form test, never a
second regex. A reader never filters out a missing link (`existsSync`): it reuses the throwing
reader.

Knip flags an exported type that no module imports; export a type in the
commit that first imports it.

Every `NODE_RULES` row's `ruleId` must be named in this section. The
Jest invariant `__tests__/node-rules-skill-coverage.test.ts` fails,
naming the missing ids, when a row has no bullet here (it matches the
id as a whole token, so `kiko-a-longer` does not cover `kiko-a`, and
reads the skill through `readSkillText` (SKILL.md plus linked reference files), and only from
this heading to the next `##` heading, ignoring `#`
lines inside fenced blocks). Add the bullet in the same commit as the
row. A section moved into a reference file keeps its heading line there, and a bullet for each
rule id goes under it.

Each `NODE_RULES` row names its own `projectCheck`, the gate a deny for
a pre-existing finding points at. A Semgrep deny names
`check:security`.

- `blank-line-separation.js` (`kiko-blank-line-separation`) enforces
  kiko-code-style's "Blank lines before statement blocks" and "Blank
  line between adjacent JSX sibling nodes". Read the checker for its
  keyword set and its exemptions; kiko-code-style states the rule.
  `--write` inserts the missing blank lines, then re-checks its own
  output.
- `screen-imports.js` (`kiko-no-cross-screen-import`) enforces
  the "No imports across screen folders" bullet in
  kiko-design-system's "Component set (continued)" (component-set-forms.md). It resolves
  relative specifiers against the importing file, which Semgrep cannot
  do. No `--write`.
- `feature-imports.js` (`kiko-feature-imports`) enforces
  kiko-code-style's "Feature imports (B2)". Per-file mode is FS-free,
  so it works on the guard's mirror. `treeRootOf` resolves a file
  inside the checker's own checkout against that root first, and only
  a path outside it (the guard mirror) by its first `src/`-style
  segment. `--tree` checks layout invariants and feature-level value
  cycles; its `barrel-leak` also catches the two-statement form
  (`import { b } …` then `export { b }`, `export default b` or
  `export const a = b`), with comments inside the import braces
  ignored. Its classification
  (`CONTAINERS`, `TEST_ONLY`, `AMBIENT_LOOSE`, …) lives in the checker;
  read it there. `native-specs/**` has no barrel and is deep-imported via
  the alias (`NATIVE_SPEC_PATTERN`; read it there). No `--write`.
- `specifier-scanner.js` is the shared import-specifier scanner. A new
  checker that reads import specifiers reuses it. Its `commentSpans`
  returns the real comment spans (offsets) that `blankNoise` passes over,
  so a checker that reads comments needs no scanner of its own.
- `comment-line-width.js` (`kiko-comment-line-width`) enforces
  kiko-code-style's "Wrap comments at 100 columns": a physical line over
  100 columns that holds real comment text fails, unless the comment
  cannot be wrapped (one long URL). The checker header and the skill
  section define the exemption exactly. `matchedText` is the trimmed
  comment text of the line (the comments only, joined with a space when a
  line holds two, never the code between them), so a moved long comment
  or a renamed identifier beside it is not new and a reworded comment is.
  The row sets `overridable: false`: no override comment passes it.
  The checker also reads `#` comment lines (first non-blank character `#`, not a `#!` first
  line) of `.sh`, `.bash`, `.yml`, `.yaml` and shell-shebang files, with the same columns and
  exemption. `comment-line-width.sh` runs project-wide
  (`npm run check:comment-line-width`, part of `check:all`) and per file (one path
  argument, no dedup; a MISSING path exits 2 first, then a file of an unread type exits 0).
  A `#`-first line inside a multi-line string, a heredoc body or a YAML block scalar is read
  as a comment too; the pin file is the way out for such a line. Read its header for the
  exact scope:
  the TypeScript roots of `full-word-identifiers.sh`, scripts js/sh/bash, `rules/fixtures/`,
  `rules/*.yml`, `.maestro`, `githooks/`, and every other tracked `.sh`/`.bash`.
  `harness/kiko/scripts/run-log.mjs` is left out: it stays byte-identical with the harness
  repository. `scripts/checks/comment-line-width.pinned` lists, as `<path><TAB><exact line>`,
  the lines that cannot wrap; it is shrink-only (a pin whose line is gone or now fits fails as
  stale) and a line that can wrap is wrapped, never pinned. Editing a pinned line, even by one
  word, fails until its pin key is edited to the same new text (the count stays).
  `__tests__/pin-count-ceilings.test.ts`
  caps how many pins each pin file (this one and the markdown prose-width one) may hold; read
  the test for the ceilings. `fast.sh` runs the per-file mode on
  a shell, YAML or githooks write, and on a `.js` write only for the per-file case pattern in
  `comment-line-width.sh` (`scripts/*.js` or `*/scripts/*.js`, so a nested
  `scripts/` folder counts;
  `rules/fixtures/*.js`; `githooks/*`), wider than the project-wide check, which reads only root
  `scripts/`, `rules/fixtures` and `githooks` (the
  generated header of `drizzle/migrations/migrations.js` is 109 columns and must not block
  an edit of it). A tool directive keeps its `OVERRIDE(...)` on ONE
  line directly above the statement: a continuation comment between a `biome-ignore lint/...`
  directive and its statement breaks the suppression, so put the explanation above the
  directive. A `biome-ignore format` directive may continue on a second comment line and
  still suppresses. No `--write`.
  Tests: `__tests__/comment-line-width.test.ts`.
- `component-i18n-namespace.js` (`kiko-component-i18n-namespace`) enforces
  kiko-translator's "A string moved into a shared component changes
  namespace" for a literal key in the component's own folder tree: a file
  under `src/design-system/components/<name>/` (its tests too) reads only
  `components.<camelCase(name)>.*`. A key in a comment is not a read. The
  finding prints the key as captured, stopping at the closing quote,
  whitespace or `${`, so one finding is one line with no space in the key
  and the guard's line parser reads it. The row sets `overridable: false`.
  `component-i18n-namespace.sh` is project-wide only
  (`npm run check:component-i18n-namespace`, in `check:all`): it has no
  per-file mode, and it exits 2 when its scan root is missing instead of
  passing with nothing checked. No `--write`, no exemption list. Tests:
  `__tests__/component-i18n-namespace.test.ts`.
- `import-order.js` (`kiko-import-order`) enforces kiko-code-style's
  "Import ordering and `import type`". `import-order.sh` is the
  project-wide gate (`npm run check:import-order`, in `check:all`);
  `--write` fixes what it safely can. Tests: `__tests__/import-order.test.ts`.
- `full-word-identifiers.js` (`kiko-full-word-identifiers`) enforces
  kiko-code-style's "Full words in identifiers". `full-word-identifiers.sh`
  is the project-wide gate (`npm run check:full-word-identifiers`, in
  `check:all`); its denylist and `EXEMPTIONS` live in the checker. Tests:
  `__tests__/full-word-identifiers.test.ts`.
- `one-component-per-file.ts` (`kiko-one-component-per-file`) enforces
  kiko-code-style's "One component per file, each in its own folder". It is
  a TypeScript module the guard loads in a worker, with no `.sh` wrapper
  and no `check:*` gate: its project-wide check is the Jest invariant
  `__tests__/one-component-per-file.test.ts`.
- `plural-count.js` (`kiko-plural-key-needs-count`) enforces kiko-translator's
  "A plural key is always called with `count`". It has no `.sh` wrapper
  and no `check:*` gate: its project-wide check is the Jest invariant
  `__tests__/plural-count.test.ts`, the same setup as
  `kiko-one-component-per-file`. It reads the plural key set from its own
  checkout's en.ts, never from the guard mirror. It is a scanner over
  `specifier-scanner.js`'s `blankNoise`, not the `typescript` compiler
  API: the guard-replay scratch checkout has no `node_modules`, so a
  checker that requires an npm package fails closed on every replayed
  file. Every checker in `scripts/checks/` stays dependency-free for the
  same reason, with one exception (the next bullet). No `--write`.
- `comment-only-changes.js` is the one exception to "dependency-free": it
  requires `typescript` (a pinned devDependency) to decide, from the
  compiler's own parse, which changed files `mutation.sh` may leave out as
  comment/whitespace-only (the mutation paragraphs in wrapper-contract.md state the rule).
  That is safe because it runs only inside `mutation.sh`, in a full worktree
  where Stryker itself needs `node_modules`, never in the pre-write guard,
  the hooks, or the guard-replay scratch checkout, and because a failed
  require keeps every file (fail closed). It is not a `NODE_RULES` row and
  has no `.sh` wrapper, `check:*` gate, or `--write`; `knip.json` ignores it.

A Jest invariant, `__tests__/cited-paths.test.ts`, fails when a skill
(SKILL.md or reference file), agent or harness doc cites a repo path in an inline code span
that does not exist. Fix the citation in the text; never allowlist it. A doc never cites an
untracked folder that exists only in some checkouts (for example .claude/worktrees/ or
memory/refs/): the citation resolves in one checkout and fails in another. Write it without
backticks. A sentence that names a path that is gone (a move, a removal) writes it without
backticks, so it is not a citation; no prose wording exempts a
backticked path. The test's header defines what counts as a citation.
A partial citation that drops the root (`design-system/entity-tint/`,
`checks/lint.sh`) counts too when its first segment is a child folder
of a cited root; it fails only when no file or folder outside
`rules/fixtures/` ends with it. The partial check reads the files on
disk that git tracks or would track
(the file listing in `__tests__/test-support/repository-files.ts`, kept when
`existsSync`), so, as with the rooted `existsSync` check, a new
uncommitted file resolves and a deleted one does not.

## Skill reference files

A skill is its SKILL.md plus its reference files: the other `.md` files in the skill folder
that SKILL.md links to. The doc suites that read a skill read it through `readSkillText` in
`__tests__/test-support/skill-text.ts`, so the readers of section text need no edit when a
section moves into a reference file. Per-file pins and exemptions do follow moved text: a line
pinned in `__tests__/fixtures/markdown-prose-width.pinned.json` (keyed by file; the key may
move to the new file, the count does not grow) and an entry in
`__tests__/skill-identifiers.test.ts` (the example-name exemptions, keyed by file). When text
moves, rewrap a pinned line so it needs no pin, or move the pin or exemption key to the new
file.

Link a reference file with a Markdown link whose target is file.md or file.md#anchor: a
relative path with no space, inside the skill folder (a subfolder target is accepted). A link
with a title, angle brackets or reference style is not read, a link to a target outside the
skill folder or a URL is ignored, and a link inside a reference file is not followed. A link to
a file that is not there throws, so a typo fails the suite; a `%20` link is read and throws as
a missing file. The link regex reads raw text, so a link inside a fenced block or an inline
code span counts too: describe an example link in words, never write it as a link. A `.md`
file at any depth in a skill folder that SKILL.md does not link fails the orphan row in
`__tests__/skill-citations.test.ts` (`orphanReferenceFiles`); fix it by linking the file in
the accepted form, never by dropping the row. Start each reference file with a `##` heading,
or a concatenating reader runs the last SKILL.md section into its first lines.
`cited-paths` reads every `.md` under `.claude/skills`, reference files included.

`__tests__/skill-citations.test.ts` also resolves prose citations of the form
`kiko-x's "Heading"`, the plural possessive `kiko-x' "Heading"`, the bare `kiko-x "Heading"`,
single-quoted text (`kiko-x's 'Heading'`) and a backticked skill name in skills, agents,
CLAUDE.md, docs/harness, docs/plans and the message text and comments of `rules/*.yml`
(`__tests__/test-support/prose-citations.ts`), and the forms `kiko-x skill's "Heading"`, plus
`` `x`, "Heading" `` and `` `x` ("Heading") `` for a backticked or `kiko-` name (a `\"` inside
the quote does not end it). It reads the comments, not the strings, of `src/**/*.ts(x)` and
`rules/fixtures/**` too. A citation resolves against the skill's text,
reference files included, on an exact heading (a trailing parenthesized qualifier is cut) or
on an anchored lead: the cited text starts a heading, a list item, a paragraph's first line
outside fences, or a bold span, with an optional A, An or The. A match at a sentence start
inside a paragraph, or inside a longer phrase, does not resolve. A qualified citation that is
no exact heading resolves only when its qualifier occurs in the body of that heading,
subsections included. Quote the heading or the lead's first words.

Four more readers check the skill text beside the citations. `directionCitations` reads a
double-quoted text followed by "above" or "below" that no prose citation reads, in documents and
not in code comments: it must be a heading or an anchored lead of the SAME file, before the line
for "above" and after it for "below". The readers are in `__tests__/test-support/skill-text.ts`,
their rows in `__tests__/skill-text-checks.test.ts`:
`helperCatalogueGaps` (kiko-testing lists every top-level helper file of `src/test-support/` and
`__tests__/test-support/`, test files aside), `unnamedLockedMarks` (each `**Locked` mark of a
kiko-design-system reference file is named by its date and `Component` in the "Locked decisions
(user-approved)" list) and `indexLeadGaps` (each `##` heading and top-level bold lead of a
reference file is named in its index bullet in SKILL.md, as a whole word, any case). When one
fails, add the name to the list or the bullet. `unnamedLockedMarks` and `indexLeadGaps` read the
reference files through the same link reader, so a link to a missing file throws. A quote that
a prose citation reads is never read again as a direction citation; a quote after a short skill
name used as a plain word before a comma or a parenthesis is no prose citation, so the direction
check reads it.

A skill sentence that lists a guard's conditions, or a write-queue read's
callers, drifts when one is added: point at the boolean's definition or at a
`grep` that finds the callers, and grep the skills for a screen's boolean
names when a hook joins it.

`__tests__/cited-paths.test.ts` also checks the comments of `src/**` sources (read through
the TypeScript parse, so
a path in a string or JSX text is not read). A rooted path (the roots are in `TREE_PATH_PATTERN` in
`__tests__/test-support/source-comment-citations.ts`; read them there) or a bare migration file name in a comment must
exist. A rootless partial citation in a comment counts only when it ends in a file extension
(`monobank/sync/sync.ts`): comment prose is not backticked, so two words joined by a
slash are not a claim about a file. It then resolves as a partial citation in a
doc does. The helper is `__tests__/test-support/source-comment-citations.ts`.

A second Jest invariant, `__tests__/skill-identifiers.test.ts`, does the
same for names: it fails when an inline code span in a skill
(`.claude/skills`, `harness/kiko/skills`) or an agent file
(`harness/kiko/agents`) is exactly an identifier, a dotted member path
or either with `()`, and any dotted part is not a whole word anywhere in
the code corpus (so a `repo.method` path fails when either half is
gone). A span that ends in a file extension (`ts`, `tsx`, `js`, `mm`,
`swift`, `json`, `sh`, `md`, `yml`, and the like in the test's
file-extension pattern) is a file name instead: it resolves only when a
tracked file has that exact base name, since the words of its parts
(`schema`, `ts`) occur in nearly every file. The corpus is the files under `src/`, `__tests__/`,
`__mocks__/`, `jest/`, `e2e/`, `scripts/`, `rules/`, `ios/` (so a Swift,
Obj-C or plist name resolves) and `harness/kiko/scripts/`, plus the root
config files, minus the test file itself. It shares the span reader
with cited-paths (`__tests__/test-support/markdown-code-spans.ts`, so a
fenced block is skipped). A path, command, flag, call with arguments,
rule id and a commit sha (7 to 40 hex digits with a digit) are not
identifier spans. A span with `()` is never a file name
(`response.json()` is a member path). Known limits: a name that survives
only in a comment or a string still resolves, so the check catches a name
that left the tree entirely, not a dead one; and a file name matches any
tracked file with that base name in any folder (`index.ts` always resolves,
and a deleted file still resolves while another folder has one with the same
base name). To fix a failure: when the symbol was renamed, name the new
one; when it is gone, write the sentence without backticks (the cited-paths
rule). A stale-name sweep chooses per sentence: rename to
the live symbol, delete the sentence, or keep it. Never rewrite a gone
symbol into vague prose, because that can hide a stale rule. The test
proves a name exists, not that it means the same thing, so a reviewer
checks the meaning of every rename (a real but wrong symbol passes).
An entry in the test's two exemption lists (non-project names, and
bad-name examples exempt per skill file and name) is only for a
name that is not this repository's code (a library, Apple, shell or
other-repo name) or a deliberate bad-name example, each group with its
one-line reason, and it is listed in
`docs/harness/documented-exceptions.md`. A listed name that is no longer
cited or now resolves fails the test, so the lists only shrink.

## Pre-write guard and merge-conflict files

The guard reads the file on disk (BEFORE) and the proposed content
(AFTER). For a file with merge-conflict markers:

- BEFORE with conflict markers never causes a deny from its own parse
  error.
- A write that keeps markers is checked only if it keeps whole blocks
  (`<<<<<<<`, `=======`, `>>>>>>>`). The guard rebuilds new-ours and
  new-theirs. Every finding must exist in the union of the old-ours and
  old-theirs findings (max count). One baseline, not per side, so a block
  resolved to theirs does not falsely deny. A full resolution is the
  zero-block case of the same rule.
- A write that keeps markers without a whole block, or adds markers to a
  clean file, is denied.
- A new side that does not parse while the same side parsed on disk is
  denied. A side already broken on disk is tolerated, and its Node-checker
  findings are dropped too.
- A file WITHOUT markers that does not parse on disk is denied on every
  write. If both on-disk and new content fail to parse, the deny gives the
  on-disk advice: ask the user how to repair it. Do not work around it
  with a Bash write.
- The one-exported-component check runs in a worker thread, so the two
  sides run in parallel. A shared-code edit while a block stays on a very
  large `.tsx` can still exceed the 3 s p95 (known scanner cost).

The baseline pass re-runs only the Node rules that found something in
a new tree. See `conflictSides`, `afterTreesFor`, and
`throwIfEditBrokeASide` in `scripts/checks/pre-write-guard.js`.

## Pre-write guard replay on the Stop tier

On a `Stop` event (not `SubagentStop`) whose payload has `stop_hook_active: true`, `medium.sh` exits 0 with a one-line stderr note instead of running, because a failing Stop tier started a new turn that ended in the same failure and the orchestrator looped (knip ran about 8 times in a row, 2026-10-11); a first `Stop` and every `SubagentStop` still run and block, the payload is read only when stdin is a regular file (`dispatch.sh` replays it as a file), and the cost is that a repeated Stop shows the failure once, with `check:all` before a commit still catching it. Read `medium.sh`'s header comment for the exact check.

The pre-write guard sees only `Edit`/`Write`/`MultiEdit`. The
kill-guard's SHELL-WRITE deny (in wrapper-contract.md) blocks the common Bash write
forms into the trees in "SHELL-WRITE deny" (`WRITE_GUARDED_TREES`, including `.claude/skills/`,
`.claude/agents/` and `harness/kiko/`) and YAML files (`YAML_FILE`). It allows the `--write`
fixers and git itself, which write source legitimately. What it does
not see still reaches disk unchecked: a script file that writes,
`find -exec`, a path held in a variable the command does not assign (see "SHELL-WRITE deny,
git config files and same-command variables"), and a commit of any
of these (see its Known limits). The replay catches those writes after
they land.

- **Where.** `scripts/checks/guard-replay.sh` (+ `guard-replay.js`, the
  planner and runner). `medium.sh` runs it on `Stop`/`SubagentStop`
  under its lock. It is also `npm run check:guard-replay`, part of
  `check:all`.
- **Engine.** It runs the unchanged `pre-write-guard.sh` once per file,
  as a `Write` of the working-tree content. The BEFORE content sits at
  the same relative path in a scratch `CLAUDE_PROJECT_DIR`. The
  new-finding diff, both override forms, `isInScope`, conflict-marker
  handling, and fail-closed handling are therefore the guard's own. A
  new guard rule reaches the replay with no change here.
- **Which commits.** Selection is by reachability from PASSED replays,
  not by how a commit was made or which branch has it: every commit in
  HEAD (all parents, not only the first-parent line) that no mark ref
  reaches and that is newer than the floor or has a session commit as
  a parent. Each worktree's mark is a git ref,
  `refs/kiko/guard-replay/<worktree id>` (the id hashes the worktree's
  git dir; see `harness_replay_ref` in `_lib.sh`), moved to HEAD on a
  pass and never on a failure. A pass never moves it back: when HEAD is
  the mark or an ancestor of it, the mark stays; a missing mark, one
  that is not a commit, and one HEAD diverged from (a rebase, an amend)
  move to HEAD. A mark vouches for the tree at the HEAD it recorded,
  not for each commit it reaches; see Known limits. A plain commit, an amend, a
  rebase, a cherry-pick, a `pull --rebase`, and every commit of a topic
  branch merged in (`--no-ff` or fast-forward) are all replayed. A
  backup branch, a `switch -c`, or a worktree made from HEAD hides
  nothing, because a branch name is no proof a replay passed. Commits
  another worktree's replay passed are reached by that worktree's mark
  and skipped, so a clean `git merge next` of gated work replays
  nothing.
- **Floor and never-replayed branches.** The repository's first replay
  records `refs/kiko/guard-replay-floor` (24 h before that run), pass or
  fail, and no run replays a commit older than it unless one of its
  parents is a session commit. A merge of a branch
  no replay ever passed (the first merge of `next` after the replay
  landed, or commits made by hand with no Stop hook) replays that
  branch's commits newer than the floor against their own history; they
  pass when they were written through Edit/Write. When they are too
  many, the Stop-tier deadline stops the run and says to run
  `npm run check:guard-replay` by hand, which records the pass. The
  floor does not slide, so a failed first replay resumed days later
  still fails. See `docs/harness/checks-internals.md` for the ref
  layout.
- **Files and BEFORE.** Every `.ts`/`.tsx` file changed in the working
  tree against HEAD (tracked and untracked, staged renames followed),
  plus every file a session commit touched. BEFORE is the file at the
  parent of the earliest session commit that touched it, otherwise at
  HEAD. When the file is absent there, it is a new file (every finding
  is new, as in the guard). AFTER is always the working-tree file, so a
  later fix clears the finding.
- **Merge commits.** Each session commit carries a baseline per path
  along its own line of history. A session merge keeps, for a path it
  left as one parent had it, that parent's baseline (none when that
  parent's version was already checked). For the paths it left
  different from every parent, the set `git diff-tree --cc` lists (a
  conflict resolution, a join of both sides, or anything written into
  the merge before it was committed), BEFORE is one conflict block of
  both parents' baselines, so the guard's own conflicted-BEFORE handling
  takes the union of both sides' findings. A clean merge of checked
  parents therefore replays nothing, and a finding this worktree already
  passed is never blamed on a merged-in branch that touched the same
  file.
- **Failure.** Exit 2 with the structured block. It holds each failing
  file's guard reason (file, rule, line) and says the write bypassed the
  pre-write guard. A guard crash or timeout arrives as the guard's own
  "could not check" deny and fails too. During an unfinished merge
  (`MERGE_HEAD` or unmerged paths) the block names the unfinished merge
  instead, since a file with conflict markers cannot parse. A replay
  that cannot run (git, node) fails closed with its own block.
- **Deadline.** On the Stop tier the replay starts no guard call after
  `stopTierDeadlineSeconds`: at most 150 s, and less when `medium.sh`'s
  own elapsed time (lock wait, `dup.sh`, the doc step), the 25 s in-flight guard call,
  and a 60 s reserve for the later checks leave less of the 300 s hook
  budget. The doc step ends by the budget `node scripts/checks/guard-replay.js step-budget`
  prints, so the replay keeps the guard-call tail and the later-checks reserve. It then fails with a
  block telling the agent to run
  `npm run check:guard-replay` by hand, which has no deadline and
  records its pass. A killed Stop hook would otherwise end the turn with
  no error and no check. The `KIKO_GUARD_REPLAY_DEADLINE_SECONDS` test
  seam only lowers the 150 s ceiling.
- **Dedup and speed.** See `docs/harness/checks-internals.md`'s "Guard
  replay: fingerprint, mark, and deadline" for the fingerprint, the
  mark, and the measured time.
- **Known limits.** A plain `mv` (unstaged) reads as a delete plus a new
  file, so every finding the moved file carries counts as new: move
  with `git mv`. A file whose merge baseline has more than two versions
  (an octopus merge, or nested merges that each changed it) is checked
  against the first two only. A merge that applies one side's change to
  a file the other side renamed compares it with the renamed side's
  baseline only, so a finding the change brought reads as new. All
  three fail closed (a finding reads as new, never as old). A commit
  with a forged committer date older than the floor
  (`GIT_COMMITTER_DATE`) whose parents are all outside the session is
  skipped, so its own change is not replayed; it hides no commit under
  it, and an old-dated commit on top of session commits stays in the
  session. That is deliberate evasion, not a slip. Deleting a mark ref
  by hand only widens the replay. Deleting the floor while no mark ref
  exists (a first replay that failed), or deleting every `refs/kiko/*`
  ref, records a NEW floor 24 h before the next run, later than the old
  one, so older unchecked commits drop out. Never delete the replay's
  refs. A mark attests its tip tree only. (1) Another worktree that
  takes a Bash-written commit, fixes the file, and passes its replay
  before the author's Stop makes the author's replay pass while the
  author's tree still holds the violation, until it takes the fix.
  (2) After a pass at a fixing commit, `git reset --hard HEAD~1` passes
  (the mark on the fix reaches the older commit, so the plan is empty)
  while the tree holds the violation again. The mark stays on the fix,
  so a later revert of the fix fails; a new commit made on the older
  commit diverges from the mark and moves it there, and the violation
  is then taken as checked. The queued verify (full Jest + `check:all`) is
  the backstop: `check:security` scans `rules/semgrep-prewrite.yml`
  project-wide, and every Node rule has its own project-wide check —
  some in `check:all`, and `kiko-one-component-per-file`'s as a Jest
  test, which runs only under the queued verify. A branch no replay
  ever passed costs replay time when merged (see "Floor and
  never-replayed branches").
- **Tests.** `__tests__/guard-replay.test.ts`: a throwaway repository
  with a linked worktree, copies of the real wrappers and rule file,
  and the real Semgrep. It covers a Bash-written violation (tracked and
  new file), a committed one, a fixed one, a pre-existing one, one under
  a commit with a forged old committer date, a revert of a passed fix
  after a reset back (the mark does not move back), the mark moving to
  a rebased HEAD, rebase,
  reset plus cherry-pick, `pull --rebase`, a clean rebase, a backup
  branch, `switch -c`, a sibling worktree made after a flag, merges
  (fast forward and clean of work another worktree passed, joined both
  sides, a write staged into the merge, a Bash-resolved conflict plus a
  track worktree, a `--no-ff` merge of an own topic, a never-passed
  branch, one older than the floor), an unfinished merge, the fixers,
  the floor across a failed first replay (the
  `KIKO_GUARD_REPLAY_NOW_SECONDS` test seam, which only moves the clock
  back), the dedup skip, a crashing engine,
  the deadline (a slow Semgrep stub through the
  `KIKO_GUARD_REPLAY_DEADLINE_SECONDS` test seam, a spent hook budget,
  and the clamp), and `medium.sh` itself.

## A test that execs a fresh script warms it first

A test that writes and execs a fresh script on macOS warms it once before any time bound starts
(`warmExecutables` in `__tests__/test-support/warm-executables.ts`). The first exec of a
never-seen script waits on XProtect: about 0.3 s alone, seconds under fan-out. Widen a time
budget only with that measurement, never as a guess. A suite that execs a fresh script in every
row of a table, under a per-test jest timeout, writes and warms those scripts once in a
describe-level `beforeAll` with its own timeout and passes per-row paths by environment variable
(`__tests__/mutation-ranges.test.ts`, the signal rows).

Warm only a stub that is harmless with an empty environment. A stub that reads its inputs from
env is safe to warm (job-queue's git stub reads `KIKO_STUB_GIT_CALLS` / `KIKO_STUB_REAL_GIT`). A
stub that needs env or sandbox state to be safe is not warmed (job-queue's `installMake` stubs
write into the cwd). A stub whose cost is its own work needs no warm-up (guard-replay's slow
Semgrep stub under a 1 s replay deadline: a slower first exec only makes the expected deadline
more certain).

A test that kills children in a teardown awaits each child's exit, with a pass-count bound (never
a timer), before `rmSync` of the sandbox; else the removal races a live trap (ENOTEMPTY). See the
`afterEach` in `__tests__/job-queue.test.ts`.

## Harness and hook changes land through a worktree

Merge a harness/hook change in a worktree first, never straight into
`main`. Before it lands, run `bash -n` on each changed shell script
under `harness/kiko/hooks/` and grep `harness/kiko/hooks/*` for
conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`). A broken hook
breaks every session's tool calls.

## Adding a pre-write guard rule

Use this for every review finding or user feedback item classified as
mechanizable (see harness-workflow's "Classify every finding").

0. When a rule's scope widens to sibling APIs, update the rule, its
   fixtures, the skill rule text, and the
   `docs/harness/review-to-biome-inventory.md` row in the same commit.
1. **Choose the engine.**
   - Semgrep: a syntactic pattern in one file. Add it to
     `rules/semgrep-prewrite.yml`, never `rules/semgrep-mobile.yml`.
   - Node: cross-line layout, path resolution, or word splitting that
     Semgrep cannot express. Add a `NODE_RULES` row in
     `scripts/checks/pre-write-guard.js`.
   - The guard only checks `.ts`/`.tsx` outside `rules/fixtures/`,
     `node_modules/`, `ios/`, and `android/` (`isInScope`).
2. **Semgrep rule.**
   - `severity: ERROR` by default, plus a `message`, `metadata.fix`, and
     `metadata.skill`. One exception: a rule whose pattern already has
     findings in the tree that a later track removes may land as
     `severity: WARNING`. The pre-write guard denies any NEW finding
     whatever its severity, while `check:security` only surfaces
     WARNING (Class B) without failing. Example:
     `kiko-no-process-env-time-zone-in-test` landed as WARNING with 26
     findings and was promoted to ERROR after the sweep. Promote such a
     rule to ERROR when `check:security` reports 0 findings for that
     rule id (not when a grep is empty). Record the promotion condition
     in the rule's comment and in
     `docs/harness/review-to-biome-inventory.md`. Document the re-measure
     command and the promotion condition there, never a site count or a
     site list (a copied count goes stale at the first sweep step).
     `metadata.skill` uses `"<skill> › <heading>"`. A finding without
     `metadata.skill` makes the guard deny "could not check".
     `__tests__/skill-citations.test.ts` fails a `metadata.skill` or a
     `NODE_RULES` `skill` that names no real heading in the skill's SKILL.md or in a reference
     file it links to (see "Skill reference files" for the link form). Cite the heading
     exactly (backticks do not matter); a trailing ` (Qualifier)` and
     ` / `-joined headings are allowed, a prefix is not.
   - The guard, `check:security`, and `check:rules` load the whole file.
     Nothing else needs wiring.
   - Fixture pair: `rules/fixtures/<rule-id>.bad.<ext>` and
     `.good.<ext>` (see "The fixture contract"). A rule with a
     path-prefixed `paths.include` needs the nested layout
     `rules/fixtures/<rule-id>/<mirrored path>/<name>.(bad|good).<ext>`.
     A fixture under `rules/fixtures/` is still typechecked (the tsconfig
     includes `**/*.ts`): give every fixture an `export {}` or an import,
     and run `npm run check:typecheck` before committing a fixture change.
   - A rule message or skill sentence that says what is allowed is checked
     against the cited section's own text: if that section is silent, edit
     the section (kiko-code-style's "`ts-pattern` for exhaustive mapping"
     had to gain the kind-ternary sentence its rule cites).
   - Add the id to `RULE_IDS_WITH_FIXTURES` in
     `__tests__/pre-write-guard-rules.test.ts`; a path-scoped rule also
     needs `NESTED_FIXTURE_PREFIXES` and `PROBE_DIRECTORIES` entries.
   - A legitimate existing site in a file the rule targets gets a
     per-line `// nosemgrep: <id> OVERRIDE(<reason>)`, never a file
     entry in `paths.exclude`. A whole-file exclude hides the rule from
     its own motivating file. `paths.exclude` is for a helper's own sink
     file or a whole out-of-scope tree. `__tests__/rule-inventory.test.ts`
     fails an exclude entry with no glob character that names one test
     file (`.test.ts`, `.test.tsx`, `.spec.*`, or a file under
     `__tests__/` or `e2e/`); a glob such as `"*.test.ts"` stays fine.
     Write `exclude:` as a block list (one `- "…"` item per line): the
     test reads only block items, so a flow list (`exclude: [...]`)
     reads as empty and fails it.
3. **Node rule.**
   - Write `scripts/checks/<name>.js`: exit 0 clean, exit 1 with
     findings on stdout. Any other exit, a signal, stderr output, or
     exit 1 with no parseable finding makes the guard deny.
   - Add `parse<Name>CheckerOutput(stdout)` returning
     `[{ line, matchedText, detailText? }]`. `matchedText` is the
     new-finding key: keep it stable under unrelated edits (no line
     numbers). Put display-only text in `detailText`. When a finding has
     `detailText`, the deny message prints it in place of `matchedText`,
     so `detailText` must still name the offending code.
   - Add one `NODE_RULES` row: `ruleId`, `extensions`, `fix`, `skill`,
     `projectCheck` (the project-wide gate the deny reason names for a
     pre-existing finding, e.g. `check:<name>`), and `run`.
     `pre-write-guard.sh` needs no change. Name the `ruleId` in the
     "Node checkers" section in the same commit (a Jest invariant
     enforces it, see that section).
   - The checker prints one finding per line with no whitespace in the key
     field, because the guard's line parser splits on it. Add a test with a
     template-literal input, and run the rule's own output through the
     guard's line parser.
   - A project-wide wrapper that walks a scan root exits 2 when the root is
     missing, never passes on an empty scan.
   - Node rules have no `rules/fixtures/` pair. Prove them with
     `__tests__/<name>.test.ts` and a case in
     `__tests__/pre-write-guard.test.ts`.
   - A guard test proves concurrency or speed by counting work or by a
     file rendezvous between stubs, never by a clock. The invariant
     `__tests__/guard-tests-no-wall-clock.test.ts` fails a clock reading
     in a pre-write-guard or kill-guard test; read its `CLOCK_READINGS` for the banned
     forms. A kill-guard test counts work with `options.workCounter` (`{ steps }`, test-only,
     `decide` only) through `stepsFor` in `__tests__/test-support/kill-guard-decide.ts`.
     It fails every `Date.now()` read in a guard test, a
     `${Date.now() - start}` delta included, and also `Date.now` without a
     call, `+new Date`, `Date()`, and a shell `date -u +%s`, `date +"%s"`.
     A unique temporary name comes from `createTemporaryDirectory(prefix)`,
     with `join(..., '<name>')` for a path inside it, never from the clock.
     The invariant also covers the queue tests (`job-queue.test.ts`,
     `ff-main.test.ts`): no settle sleep; prove concurrency by a rendezvous.
     A teardown poll may break at its pass-count bound instead of failing,
     so the sandbox removal still runs (the `job-queue.test.ts` afterEach).
     The poll-bound exemption applies only inside the braces of the loop
     that holds the bound; a renamed `timers/promises` `setTimeout` import
     counts as a sleep. Known limits: braces are counted per line, string,
     template and comment content included, so an unbalanced brace in a
     string or comment inside the loop can hide or flag a sleep; rename
     detection covers only `import { setTimeout as <name> }`; the
     sleep pattern also misses `promisify(setTimeout)`, `execSync('sleep')`,
     `spawnSync('/bin/sleep')` and a require destructure of
     `timers/promises` (gap 20261017T1654-kiko-harness-h8/4; read
     `SLEEP_CALL` in its rule file).
   - bash 3.2 (macOS): a trapped SIGINT sent to one pid is lost when it
     lands as a foreground external child is reaped. Where a signal must
     not be lost, run the command as `cmd & wait $!` (`run_awaited` in
     `scripts/job-queue.sh`), and end an in-flight one first in
     `stop_on_signal` (`end_in_flight`, before `terminate_job_group`) and
     again at the top of cleanup on the EXIT path; a pid reaped during a
     long terminate poll can be reused.
     The job-queue wait loop and `$(...)` command substitutions are not
     covered (open gap 20261017T1654-kiko-harness-h8/1).
   - A test that needs a scratch folder uses
     `__tests__/test-support/temporary-directory.ts` (`createTemporaryDirectory`
     and `removeTemporaryDirectories` in an `afterEach`). New code uses the
     helper, because a hand-rolled `mkdtempSync` leaks when a test throws.
     Existing hand-rolled `mkdtempSync` calls are old code: they move to the
     helper when their file is next edited.
   - `__tests__/error-class-pins.test.ts` fails when a non-empty
     `extends Error` class under `src/` has no same-folder test pinning its
     `.name` literal and its `.message`. The message pin must be on the same
     receiver chain as the `.name` pin in the same test block (blocks split at
     `it`/`test`/`xit`/`fit`/`xtest`/`describe` and their `.skip`/`.only`/`.concurrent`
     forms), or on `new ClassName(...).message`, or in one `toMatchObject({ name, message })`.
     Known limit: a rebound `let error` is not seen. A class with an empty body is skipped.
   - A new Node rule also runs on the probed negative (good) fixtures of
     `__tests__/pre-write-guard-rules.test.ts`. Make those fixtures pass
     the new rule, never exempt them.
   - Project-wide gate: `scripts/checks/<name>.sh` (copy
     `screen-imports.sh`), `package.json` `check:<name>` plus a
     `check:all` entry, and a `knip.json` `ignore` entry.
4. **Sweep in the same commit.** Fix every existing violation in the
   commit that adds the gate. A gate without its sweep breaks
   `check:all`. If the sweep is too big for one dispatch, land the guard
   row first with no gate (it blocks only NEW findings), then the sweep
   plus the gate wiring together.
5. **Deny message.** The author controls the rule id, `fix` (the correct
   pattern, one line), and `skill`. The `skill` section must exist and
   state the rule. Read `denyReason` in `pre-write-guard.js`
   for the full shape.
6. **Override form.** See "Override forms and where each is honored".
7. **Docs.**
   - A row in `docs/harness/review-to-biome-inventory.md` (always; its
     first cell is the exact rule id, see "Every mechanized finding gets
     an inventory row").
   - `docs/harness/documented-exceptions.md` for any new exclude or
     allowlist entry.
   - The CLAUDE.md short table and `docs/harness/checks.md` row, and the `check:all` list, only for a new
     `check:*` gate.
8. **Speed check.** Guard p95 must stay under 3 s. Run 20 guard calls on
   the largest real `.tsx` under `src/screens/` and take the 19th sorted
   time:

   ```bash
   F=$PWD/src/screens/forms/transaction-form/transaction-form.screen.tsx # the screen is now split; pick any large file if it is small
   S=<your scratchpad>
   node -e 'const fs=require("fs");const f=process.argv[1];const line=fs.readFileSync(f,"utf8").split("\n").find(l=>/^\s*const \w+ = /.test(l));process.stdout.write(JSON.stringify({tool_name:"Edit",tool_input:{file_path:f,old_string:line,new_string:line}}))' "$F" > "$S/b.json"
   for i in $(seq 20); do CLAUDE_PROJECT_DIR=$PWD /usr/bin/time -p bash scripts/checks/pre-write-guard.sh < "$S/b.json" 2>&1 >/dev/null | awk '/^real/{print $2}'; done | sort -n | sed -n '10p;19p'
   ```

   It prints p50, then p95. A p95 taken while the load is above about 10 is not valid: wait with
   `scripts/wait-load.sh`, or interleave runs with and without the rule and compare. A pattern that can go quadratic (a
   statement-sequence `pattern-inside` with a weak prefilter) must
   exclude files where it cannot apply; a Semgrep timeout becomes a
   "could not check" deny.

## Pinned-value rules for locked user-approved visuals

When the user approves a specific visual value at a known site, pin it
with a Semgrep rule so a change needs an override that names the
approval. Model: the `kiko-pinned-*` rules in
`rules/semgrep-prewrite.yml`.

Shape:

- Anchor on a UNIQUE site marker, such as the i18n label child or a
  named style key.
- One `patterns:` arm per way the pin can break, under a top-level
  `pattern-either`:
  - the value is present but different: capture it as a metavariable
    and reject everything else with `metavariable-regex`;
  - the attribute is absent and the default differs: `pattern` plus
    `pattern-not` with the attribute.
- Never combine `pattern-regex` with a negative filter in one arm (see
  "Semgrep facts verified on 2026-09-25").
- `metadata.skill` points at the skill section that states the pinned
  value.

Worked example (illustrative, not a real rule): pin the Summary table
preview to 5 rows.

```yaml
  - id: kiko-pinned-summary-preview-rows
    languages: [typescript]
    severity: ERROR
    message: The Summary preview table is pinned to previewRowCount={5}.
    metadata:
      fix: 'Use `previewRowCount={5}` on the Summary preview table.'
      skill: "kiko-design-system › <section that states the pin>"
    pattern-either:
      - patterns:
          - pattern: <SummaryTable ... testID="summary-preview" ... previewRowCount={$COUNT} ... />
          - metavariable-regex:
              metavariable: $COUNT
              regex: "^(?!5$).*$"
      - patterns:
          - pattern: <SummaryTable ... testID="summary-preview" ... />
          - pattern-not: <SummaryTable ... previewRowCount={$COUNT} ... />
```

To change a pinned value, do one of these:

- add `// nosemgrep: <rule-id> OVERRIDE(user-approved <date>) <why>`
  that names the user approval; or
- edit the rule in the same commit as the approved design change.

## Every mechanized finding gets an inventory row

`docs/harness/review-to-biome-inventory.md` tracks every review
finding that has been (or could be) mechanized into a Biome/Semgrep/
shell rule. A new rule of any kind gets a row there — enforced for
every Semgrep rule id by `__tests__/rule-inventory.test.ts` (the first
cell holds the exact rule id) — including the
basename-pattern `paths.include` scope, so a future rule copying the
row as a template inherits the correct (non-path-prefixed) form
instead of a stale mistake. A finding that is deliberately **not**
mechanized (e.g. Semgrep cannot read `Info.plist`, so a plist
assertion belongs in a shell check instead) gets a row noting why, not
silence.

## The medium-tier trigger filter must include the files you guard

`scripts/checks/medium.sh` early-exits silently when the session
touched no source file. A new harness check that guards a
non-`.ts`/`.tsx`/`.js` file (a Semgrep rule file, a fixture, another
`scripts/checks/*.sh` wrapper, `ios/Kiko/Info.plist`) must extend the
filter's harness-input pattern to include that file — otherwise a
session that edits only that file never triggers the new check on
`Stop`/`SubagentStop`. Read `medium.sh`'s current filter regex before
adding a new triggering path; extend it, don't bypass the early-exit
guard itself (a session that changed nothing must stay silent).

**A deleted file triggers the tier but is never handed to a content reader.** `medium.sh`'s
`changed` list comes from `git diff --name-only HEAD`, which lists a deleted file. It keeps
that path for the trigger (a deleted file can break an import elsewhere, so knip and tsc must
run), and builds a second list, `present` (an `-f` test per path), for `dup.sh` and
`override-guard.sh`. The invariant: a path that is not on disk never reaches jscpd (it fails with
`ENOENT lstat`, `dup.sh` would print its "duplicated code above the configured threshold" block,
and the dedup, which needs every path to be a file, would be off for the run). The existence test
runs after `changed` is built because `changed` must keep the deleted path for the trigger; a
`--diff-filter=d` on the one list would drop the trigger too. `guard-replay.js` plans its own file
set from git history and does not read the list. `dup.sh` itself fails closed on a path argument
that is not on disk, naming the path (exit 2, "does not exist"), and never starts jscpd.
`__tests__/medium-deleted-files.test.ts` pins both.

## Never pipe into grep -q or head under pipefail

Every script under `scripts/` and `harness/` runs with `set -o pipefail` (or is sourced by one
that does), except `scripts/checks/kill-guard.sh`, which sets neither. Under it, `printf '%s\n' "$out" | grep -q PATTERN` is a race: `grep -q` exits at the
first match, `printf` then dies of SIGPIPE (exit 141), and pipefail makes the whole pipeline
non-zero, so a MATCH reads as "no match". It is deterministic, not just flaky, when `$out` is
larger than the 64 KB pipe buffer and the match is on an early line: the pipeline failed 300 of
300 runs. The same holds for `grep -m N` / `--max-count` and for `| head` (any consumer that stops
reading before its producer finishes), and for a non-`printf` producer (`git diff | grep -q`).
It fails open when the match is the failure signal (`mutation.sh`'s "did not result in any files"
was skipped on a large Stryker log) and fails closed on a correct input when it is the success
signal (`plist.sh`'s Resources-phase check, `deploy-device.sh`'s `BUILD SUCCEEDED`).

Use a form with no producer to kill. All of these work under macOS `/bin/bash` 3.2:

- A here-string: `grep -qF 'literal' <<<"$value"` (keep `-F`/`-x`/regex exactly as before).
- A `case "$value" in *'literal'*) ... ;; esac`.
- A file argument (`grep -q 'x' "$file"`), or capture a command's output into a variable first
  (`changed="$(git diff --name-only HEAD)"`), then match it with a here-string.
- A first line: `sed -n '1p'` (it reads to the end of its input), never `head -1`.

A pipe into a `grep` that reads to the end of its input (`| grep -E x`, `| grep -c x`,
`| grep -v x`) is not a race.

The guard is the Semgrep rule `kiko-no-early-exit-pipe-consumer` in `rules/semgrep-mobile.yml`
(fixture pair `rules/fixtures/kiko-no-early-exit-pipe-consumer.{bad,good}.sh`). It runs at
`check:security` and `check:rules`, NOT at write time: the pre-write guard reads only `.ts`/`.tsx`,
and the fast tier runs on `.ts`/`.tsx`/`.js`, so a violation in a `.sh` file surfaces only when
`check:security` runs over the tree (`check:all`, or `bash scripts/checks/security.sh "$PWD/scripts"`). The Stop
tier's `check:rules` proves the rule against its fixtures, not the scripts. It is a regex in `languages: [generic]`, not a bash
AST pattern, because the bash parser cannot read a one-line `case ... in a|b) ;; esac` (`plist.sh`
has one) and then skips the whole file silently. A comment that spells out such a pipe is flagged
too, and so is `head` inside a string (for example `print_block` text), so reword it. A consumer
that stops early in another way (`sed -n '1{p;q}'`, an `awk` `exit`, a `read`) is not covered;
avoid those too.

Known limits (the regex does not see these, so avoid them by hand): a `grep` reached through a
path or a prefix (`| /usr/bin/grep -q`, `| LC_ALL=C grep -q`, `| command grep -q`); a `-q` flag
on a continuation line after `grep \`; `| grep -l` (it also stops at the first match); a blank
line or a comment between the `|` and `grep`; and `rg -q`. The `||` operator is not a pipe and is
not flagged.

A here-string is not free of risk everywhere: bash 3.2 writes it to a temp file, and when `/tmp`
cannot be written `grep` never runs, so its `if` reads false. That fails open for a check whose
match is the failure signal, so `mutation.sh` uses a `case "$out" in *'...'*)` match for the
"did not result in any files" check (no temp file, no pipe). The other here-string sites fail
closed (a lost match aborts the script) or run only in a deploy.

Prove a fix with a test that feeds the script a value over 64 KB with the match on the FIRST line:
`__tests__/mutation-gate.test.ts`, `__tests__/plist-credential-detect.test.ts`,
`__tests__/lint-fixtures-scope.test.ts`, and `__tests__/deploy-device.test.ts` each carry one.

## Never use the print flag of node in a shell script

`node -p` (and `--print`) prints its result through `console.log`, which wraps a number in ANSI
color codes when `FORCE_COLOR` is set, and background Claude sessions export `FORCE_COLOR=3` even
into a pipe. A figure captured with `$(node -p ...)` then fails a numeric test or compares as a
string: `dup.sh` once printed no warning for a file at 10% to 49.99%, because `awk` read the colored
text as a string. Print with `node -e 'process.stdout.write(String(value))'`, which no color
setting touches, and test the captured text is a plain number before comparing it (`dup.sh`'s
`is_number`); a value that is not a number is a "could not measure" outcome, never a pass.

The guard is the Semgrep rule `kiko-no-node-print-in-shell` in `rules/semgrep-mobile.yml` (fixture
pair `rules/fixtures/kiko-no-node-print-in-shell.{bad,good}.sh`). Like the pipe rule above, it is
a `generic` regex over `*.sh`, run by `check:security` and `check:rules`, not at write time. It
flags `node`, then any options, then a single-dash option cluster holding `p` or `--print`,
including in a comment or a string, so reword text that spells the flag. `-p"1"` (no space after
the flag) and an option before the flag (`node --no-warnings -p`) are caught; a literal path such
as `/usr/bin/node -p` is caught too. Known limit: node reached through a variable or command
substitution (`"$NODE" -p`, `$(command -v node) -p`), and an option that takes a separate value stops the match
(`node -r ./setup.js -p`, `node --require ./x -p`, `node -C production -p`, `node -e "x" -p`). A test that must prove a script survives a colored
environment sets `FORCE_COLOR: '3'` itself (`__tests__/dup-large-files.test.ts` does).

## Shipped migrations are never edited — check:shipped-migrations

User rule: a migration that already shipped is never edited, not even a
comment. The runner (`src/db/run-migrations.ts`) is count-based and never
re-runs an applied migration, so an edit never reaches a device that
applied it. New behavior goes in a new migration. Adding a migration
stays allowed.

`scripts/checks/shipped-migrations.sh` (+ `shipped-migrations.js`,
dependency-free like every checker; knip-ignored) is
`npm run check:shipped-migrations`, in `check:all` right BEFORE
`check:guard-replay`, the same order as `medium.sh`. It has no override and
no exemption list. A standalone `npm run check:guard-replay` also moves the
mark ref to HEAD, and a clean tree at the mark makes the next Stop exit
early, so after one a committed migration edit shows again only at
`check:all` / the queued verify (the order above keeps it first there), not at
a later Stop.

- **Baseline ("shipped").** For each LOCAL branch of main and next that
  resolves, the base is `git merge-base HEAD <branch>`. The protected set
  is the union of the files under `drizzle/migrations/` at those bases.
  Each base is compared with the WORKING TREE, so an uncommitted edit, a
  committed edit on the branch, and a Bash-written edit are all caught.
  A missing main fails closed, and so does a `git merge-base` failure
  against main or next that is not "no common history" (exit 1 means no
  base for next, a failure for main; any other exit fails closed for
  both). A missing next, or a next with no common history, uses main
  alone.
- **The earliest base decides.** Per file, the earliest base that has it
  decides (main's merge-base first); next's merge-base decides only a file
  main's base lacks. So when next edited a file main shipped, a branch cut
  from next restores main's bytes and passes; keeping next's bytes fails,
  naming the main base. For `meta/_journal.json` and `migrations.js`,
  next's base ALSO applies when it extends main's content (next only
  appended entries or inserted lines), so what next appended stays
  protected; when it does not extend it, main's alone decides, which
  cannot deadlock.
- **Per-file rules.** A snapshot, a `.sql`, and any other file type that
  existed at the deciding base: byte-identical; deleted or renamed fails
  (a rename is reported with the new path when the bytes match an added
  file). `meta/_journal.json`: both sides parsed as JSON (a parse error,
  or a value that is not an object with an `entries` array, fails closed
  with exit 2), every top-level key but `entries` deep-equal, and the new
  `entries` starts with the base entries, each deep-equal, in order;
  appended entries pass, and a pure reformat passes. `migrations.js`:
  the base lines stay an in-order subsequence of the new lines
  (insertion only; drizzle-kit regenerates it by insertion). A
  `*.test.ts` under `drizzle/migrations/` is never protected. A file
  absent at every base (added on this branch) is free.
- **Failure block.** Each line names the file, what changed (modified,
  deleted, renamed, journal entry N changed or removed, migrations.js
  line removed or changed), the deciding base sha, and the way out. For a
  whole file that is `git show <sha>:<path> > <path>`. For the journal and
  `migrations.js` it is NOT the whole file (that drops the branch's
  appended entries and inserted lines): the line shows the base text of
  the named entry or line, to restore in place while keeping the rest.
  Never restore with checkout, restore, stash or clean.
- **Second kind: a missing `src/` path in a NEW migration's header.** The
  wrapper runs the checker a second time (`shipped-migrations.js --headers`)
  after the shipped-file kind passes, so a shipped-file failure shows first.
  It reads only a `.sql` that no resolved base has (new on this branch),
  never a shipped one: a header names the source as it was when written, a
  later `src/` move must not fail a shipped header that may not be edited
  (2 stale shipped paths exist, both under the old monobank folder), and a
  new header is still free to fix.
  Only a backticked `src/...` path inside a SQL comment is read, both forms
  (`-- ...` lines and `/* ... */` blocks, which open most real headers). One
  left-to-right scan tells comment from code: a `'`, `"`, backtick or `[`
  opens a literal or quoted identifier that is skipped whole (a doubled
  closing quote is an escape), so a path in a string literal or SQL code is
  never read, and a `--` or `/*` inside one never opens a comment; an
  unterminated block comment runs to the end of the file. A path ending in `/`
  must exist as a folder; any other path must exist as a file (a file with a
  trailing `/`, or a folder without one, fails). Only the failing paths are
  named, each with its migration file. Own block title "Migration header names
  a missing src path", exit 2, no override. Known limits: a path in a
  non-comment position is not checked; a glob or a path with a line suffix
  is read as a literal path and fails.
- **Dedup.** The fingerprint is the base shas, the name and blob hash of
  every file under `drizzle/migrations/`, the name of every file and folder
  under `src/` (a move there must re-run the header kind), and the checker
  script. A hash failure, or a `find src` that fails (a missing `src/` is an empty list, not a
  failure), leaves the fingerprint empty, so the check runs and a partial listing never skips.
- **Wiring.** `scripts/checks/medium.sh` runs the wrapper BEFORE the guard
  replay and before its "only HEAD moved" early exit. Before the replay,
  because a passing replay moves the worktree's mark ref to HEAD: a
  failure after it would leave the next Stop a clean tree with no pending
  replay, which exits early and hides the committed violation; failing
  first leaves the mark, so every later Stop fails again. Before the early
  exit, so a turn that only committed a migration edit is checked. Its
  harness-input regex includes `drizzle/migrations/`, so a session that
  touched only a `.sql` file is not silent. No pre-write guard rule: the
  guard covers `.ts`/`.tsx`, and the Stop tier catches a `.sql` edit in
  the same turn. No guard-replay change: the check diffs the base with the
  working tree.
- **Known limits.** (1) On the main checkout itself (HEAD = main) both
  bases are HEAD, so nothing already committed is protected there; only
  uncommitted edits are caught. A merge into main comes from a verified
  worktree whose own check passed. On next itself the next base is HEAD,
  so only the main base protects: an edit committed directly on next to a
  migration not yet on main is not caught after the commit. (2) An
  inserted `migrations.js` line can still change what a shipped entry
  means: a duplicate key such as `m0036: m0052,`, or a block comment
  wrapped around shipped lines. The check proves only that no base line
  was removed or changed. (3) The check reads local branches only. (4)
  When next does not extend main for `meta/_journal.json` or
  `migrations.js` (next changed an entry or line main shipped), main alone
  decides, so the entries and lines next appended stay unprotected until
  next is fixed; the Stop tier on next catches the main-entry change
  itself. When two bases both decide a file and report the same change,
  the line is printed once, with the first base's hint. Tests
  live in `__tests__/shipped-migrations.test.ts` (a throwaway git repo
  with a copy of the wrapper; the other medium wrappers are stubs that
  exit 2 with a marker, and `guard-replay.sh` is a stub that records the
  mark ref through `_lib.sh`'s `harness_replay_ref`).

## Closure tables — check:closure

A round's closure list is one row per finding id, never a task title's
range: a range or a task-title row hides an id that no commit touched.
`scripts/checks/closure-table.js` (with the
`closure-table.sh` wrapper, `npm run check:closure -- <table.md>`, run
by hand at a round's end; NOT part of `check:all`, because it checks a
document, not the tree) fails when a closure table does not hold up.
The table's columns, in this order under this header row (case is
ignored), are defined in the script's own header:

`Id | Status | Fix sha | Pinning test file:line | Fails on pre-fix source`

- **Id** is ONE id: letter-only words joined by hyphens, then a tail
  that ends in a number and at most one lowercase letter (`CS1`,
  `STAT-N4`, `SEC-C1`, `TX-C6a`, `12`). A range
  (`STAT-N1..N5`, `N1-N5`), a list (`A, B`, `A/B`), a word, and an empty
  cell fail; an id in two rows fails and names the first line.
- **Status** is `OPEN`, `CLOSED`, or `CLOSED-UNPROVEN`. `CLOSED` and
  `CLOSED-UNPROVEN` need a fix sha and a pinning test; `CLOSED` also
  needs a last cell that starts with `yes` (how the test was shown to
  fail on the pre-fix source). A test not shown to fail is
  `CLOSED-UNPROVEN`, never `CLOSED`.
- **Fix sha** (any row that fills it) must resolve to a commit and be an
  ancestor of HEAD (`git merge-base --is-ancestor`); 7 to 40 hex digits.
- **Pinning test** (any row that fills it) is `path:line`: a file in the
  working tree, inside the repository, with at least that many lines.
- An `OPEN` row may leave the sha, test, and last cells empty (or `-`).
  A file with no table under that header fails, so a missing table never
  reads as a pass.

Exit 0 clean, 1 findings (one line each: `<table>:<line>: <problem>`),
2 when it could not run; the wrapper turns 1 and 2 into the structured
block. It has no content-dedup fingerprint: it reads a caller-chosen
file and the answer depends on HEAD, so every run checks. It is
dependency-free (`node:*` only). Tests, against a throwaway
git repository with good and bad tables built in the test:
`__tests__/closure-table.test.ts`.

## The check:all list is pinned

`__tests__/check-all-lists.test.ts` fails when `package.json`'s
`check:all`, the list in CLAUDE.md's "`npm run check:all` — the fast +
medium tier checks, in order" bullet, and the hooks disagree. The list
must be the same, in the same order, in the first two; each entry has a
CLAUDE.md short-table row (full row in `docs/harness/checks.md`) and a wrapper that exists; and each entry
runs in the fast tier (`fast.sh`), the medium tier (`medium.sh`), or at
write time (it is the `projectCheck` of a `NODE_RULES` row in
`pre-write-guard.js`). Every wrapper `fast.sh` or `medium.sh` runs must
be a `check:all` entry. The expected mapping is read from those files,
never hard-coded, so a new check added to one place and missed in
another fails here. `check:closure`, `check:permissions`, `check:mutation`, and `check:deep`
are outside `check:all` by design.

## Permission doctor — check:permissions

`npm run check:permissions` (`scripts/checks/permission-doctor.sh`, which runs
`permission-doctor.js`) is manual: no hook, not in `check:all`. It reads the permission path rules
of the user and project settings files and fails on a rule that cannot work as written. The
`.js` exits 0 (clean), 1 (findings) or 3 (crash); the wrapper maps 1 and 3 to exit 2, so run the
wrapper. The finding kinds, suggestions and Known limits are in the `permission-doctor.js` header;
the short form is the `check:permissions` row of `docs/harness/checks.md`. An agent never edits a
permission settings file: the user applies the suggested JSON by hand.

## Harness-test fixtures never read as an import of src

`__tests__/harness-tests-do-not-depend-on-src.test.ts` asks jest's own
`--findRelatedTests` which `__tests__` files it relates to a source file
and fails unless they equal its `GENUINE_SRC_TESTS` list (documented in
`docs/harness/documented-exceptions.md`). A harness-test fixture builds a
`@kiko/...` or src path specifier at runtime, for example
`['@kiko', 'dates'].join('/')`, so jest's dependency extractor does not
relate the test to src. The extractor is a regex over the raw text, so it
reads a fixture string like a real import, and Stryker's
`--findRelatedTests` then runs a Semgrep-spawning harness test for every
mutated file under it, past the dry-run timeout. It reads `import`/`export`
`from`, `require(`, dynamic `import(`, `jest.requireActual`, and
`jest.requireMock`; `jest.mock`, `doMock`, and `unmock` literals are not
read, so they stay as they are.

## Plist assertions

`scripts/checks/plist.sh` holds Info.plist invariants as a list of
named assertions (e.g. every credential-bearing host resolved from
`src/` + `.env` must appear in `NSPinnedDomains`). Add a new plist
invariant there as another named assertion in that same script, not as
a new standalone wrapper — `plist.sh` already owns `plutil -lint` on
`ios/Kiko/Info.plist` plus the fail-closed proofs for a missing file
or a broken `plutil`.

A plist/project-file assertion that greps `project.pbxproj` must read the
section that proves the claim (for a bundled resource, the
`PBXResourcesBuildPhase` section), never the whole file: the
`PBXBuildFile` line carries the same "in Resources" text, so a whole-file
grep passes vacuously. An answer computed by `node` must fail closed on
anything but its expected values — an empty answer from a crashed `node`
is not "no".

A credential marker is a credential header or the bare word `api_token`
(a query-parameter credential), quoted or not, so an object key the Biome
formatter unquotes and a template query string (`?api_token=${key}`) both
match. Read `scripts/checks/plist.sh` for the exact marker set.
The marker pass is file-level and quote-based: a quoted credential name
in ANY non-test `src/` file counts that file as a credential client, even
a validator or mapper that only reads such a field by property. Run
`npm run check:plist` after touching such a file.

Section 1b: a client that sends a credential (an `api_token` query
parameter or a credential header such as `X-Token`; section 1's marker
set) must also send a `Cache-Control: no-store` request header
(NSURLCache stores the request URL and headers in its disk cache).
A comment, an unused constant, or `no-cache` never
satisfies it. Read section 1b of `scripts/checks/plist.sh` for the
accepted header forms.
