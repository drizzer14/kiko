## Implemented: a rule for a plain function called inside a worklet

Formerly a documented backlog item, now IMPLEMENTED:
`kiko-worklet-directive-required` (`rules/semgrep-prewrite.yml`) flags
a call to a SAME-FILE helper (declared as `const $F = (...) => ...` or
`function $F`) without a `'worklet'` directive, made inside the callback
argument of a reanimated worklet hook, `runOnUI`, or a
`Gesture.$G().$ON(...)` callback — read the rule for the closed hook
list. It does NOT catch an imported helper (that stays a review item),
excludes a helper declared inside the callback itself, and excludes
test files (Jest mocks reanimated; the rule's comment states the
timeout reason). A call in the deps argument of
`useAnimatedStyle` is NOT flagged (the rule's focus-metavariable
and the rule's good fixture deps case pin it). This is a real, previously-shipped bug class (see
`kiko-gestures`'s "Every function called inside a worklet needs its
own `'worklet'` directive" and memory
`worklet-directive-debug-swallows-release-aborts`): the missing
directive is invisible to `tsc` and to Jest (reanimated's worklet
runtime is mocked there, and Debug builds only warn), and only
SIGABRTs in a RELEASE build. See the rule itself for its fixture pair
and `docs/harness/review-to-biome-inventory.md` for the closed backlog
row.

## `kiko-rejects-to-throw-needs-error`

Mechanizes kiko-testing's "A rejection names its error": any `.rejects` form that passes on
every failure, so a test that fails for the wrong reason stays green. The forms are the patterns
of `kiko-rejects-to-throw-needs-error` in `rules/semgrep-prewrite.yml`; read them there.

**Severity ERROR from the start.** The tree holds 0 findings; re-measure with
`semgrep --metrics off --quiet --json --config rules/semgrep-prewrite.yml src __tests__`, filtered
to this id.

**Scope.** Test-only, with the same `paths.include` as the title rule. The fixture pair is
NESTED under `rules/fixtures/kiko-rejects-to-throw-needs-error/src/test-support/`.

**Known limits.** A rejection read through a helper and a synchronous `expect(fn).toThrow()`
are not seen. The rule checks that an expected error is named, not that it is the right one.

## `kiko-sortable-grid-lone-card-lifts`

Mechanizes kiko-gestures' "A lone card lifts too": a `<Sortable.Grid ... sortEnabled={...} />`
whose `sortEnabled` is `$ITEMS.length > 1`, `$ITEMS.length >= 2`, `1 < $ITEMS.length`, or
`2 <= $ITEMS.length`, alone or at any place in an `&&` chain.

**Severity ERROR.** The tree holds 0 findings; re-measure with
`semgrep --metrics off --quiet --json --config rules/semgrep-prewrite.yml src __tests__`, filtered
to this id.

**Scope.** App source: `paths.exclude` is the test files. The fixture pair is
`rules/fixtures/kiko-sortable-grid-lone-card-lifts.bad.tsx` and `.good.tsx`.

**Known limits.** A count held in a variable, then passed as `sortEnabled`, or a count read
through another expression (`!isEmpty(items)`), is not seen. A grid other than `Sortable.Grid`
is not seen.

## `kiko-kind-ternary-prefers-match`

Mechanizes kiko-code-style's "`ts-pattern` for exhaustive mapping": a ternary
`$X.kind === "$KIND" ? $A : $B`, which sends every other variant down the else branch.

**Severity ERROR.** The rule has no type information, so it cannot tell a closed union from a
plain `kind` string. A site on a closed union does not fit kiko-code-style's single-boolean-guard
allowance, because that allowance covers only a guard with no closed-set enum behind it. A site
uses `match(...).exhaustive()`. To re-measure, run the Semgrep command in the
`kiko-test-title-no-history` section in rules-comments.md, filtered to this id; the tree must hold 0
findings. `// nosemgrep:
kiko-kind-ternary-prefers-match OVERRIDE(<reason>) <why>` is only for a site where `kind` is
not a closed union.

**Scope.** App source: `paths.exclude` is the test files, `__tests__/**`, `e2e/**`,
`scripts/**`, and `harness/**`. The fixture pair is
`rules/fixtures/kiko-kind-ternary-prefers-match.bad.ts` and `.good.ts`.

**Known limits.** Only `$X.kind === "<literal>" ? a : b` is matched (a nested chain reports
both ternaries). Not seen: `!==`, `==`, a reversed literal (`'x' === a.kind`), a ternary on a
variable that holds the kind, and a plain `if` on `kind`.

## `kiko-type-ternary-prefers-match`

The `kiko-kind-ternary-prefers-match` rule's twin for a `type` tag: a ternary
`$X.type === "$TYPE" ? $A : $B` on a discriminated union (kiko-code-style's "`ts-pattern` for
exhaustive mapping") reads through `match(...).with({ type: ... }, ...).exhaustive()`.

**Severity WARNING.** A separate id, so the `kind` rule stays a pinned ERROR: the tree already
holds `type` ternaries (a `holding.type === 'bond' ? ... : null` narrowing; re-measure the
count and sites with the command below, they are listed in run-log gap
20261016T2009-kiko-currency-pickers/1) and `check:security` fails on any
ERROR. `check:security` surfaces them without failing and the
pre-write guard denies a NEW one. **Promotion condition:** flip to ERROR, and add the id to
`PINNED_SEVERITIES` in `__tests__/rule-inventory.test.ts`, when `check:security` reports 0
findings for this id. To re-measure, run the Semgrep command in the `kiko-test-title-no-history`
section in rules-comments.md, filtered to this id. A site on a `type` that is a plain
string (a DOM or event
`type`) is not a union: it keeps the ternary under `// nosemgrep: kiko-type-ternary-prefers-match
OVERRIDE(<reason>) <why>`.

**Scope.** App source: `paths.exclude` is the test files, `__tests__/**`, `e2e/**`,
`scripts/**`, and `harness/**`. The fixture pair is
`rules/fixtures/kiko-type-ternary-prefers-match.bad.ts` and `.good.ts`.

**Known limits.** The same shapes as the `kind` rule: only an `===` against a literal. The `if`
plus early-return form (`if (row.type === 'heading') { return ... }`) is not matched, because
Semgrep has no type information and a statement `if` on an event's `type` is everywhere in
handlers; no fixture can prove that form free of false positives.

## `kiko-no-inline-text-variant-mock`

Mechanizes kiko-design-system's "Component set": a test that reads a label's `variant` or `tone`
mocks `Text` with the shared `src/test-support/mock-text-variant-tone.tsx` (a getter in the
`jest.mock` factory), never with its own factory that forwards `variant` onto the host node.

**Severity ERROR.** The tree holds 0 findings; re-measure with the Semgrep command in the
`kiko-test-title-no-history` section in rules-comments.md, filtered to this id.

**Scope.** `paths.include` is `*.test.ts`, `*.test.tsx` and `src/test-support/**`; the last entry
is only what lets the guard's probe file reach the rule, so the fixture pair is NESTED under
`rules/fixtures/kiko-no-inline-text-variant-mock/src/test-support/`.

**Known limits.** The module is matched by its text ending in `components/text` or `../text`;
a mock through another relative path (`./text`) or through the component file
(`components/text/text.component`) is not seen. The pattern is the two-argument `jest.mock`
call, so a three-argument one (`{ virtual: true }`) is not seen. The factory is matched by the
word `variant` anywhere in its text (a hyphenated name such as `mock-text-variant-tone` does not
count), so a factory that mentions `variant` for another reason is flagged too, a factory that
spreads `...props` onto the host node forwards `variant` without naming it and is not seen, and a
mock that forwards only `tone` is not (it has the `mock-text-tone` helper). A factory held in a
variable and passed by name is not seen. `jest.doMock` is not matched. A module-level local copy
of the component returned through the sanctioned getter (`get default() { return localCopy; }`)
names `variant` outside the factory and is not seen either: the helper
`src/test-support/mock-text-variant-tone.tsx` forwards `variant`, `tone` and `style`, so a test
that pins a style too imports it, never a copy of it (gap 20261019T1704/1 tracks a rule that
flags the copy).

## `kiko-component-explicit-return`

Mechanizes kiko-code-style's "One component per file, each in its own folder": a component
uses an explicit `return`, never the arrow-shorthand implicit return.

**Severity ERROR.** The tree holds 0 findings; re-measure with the Semgrep command in the
`kiko-test-title-no-history` section in rules-comments.md, filtered to this id.

**Scope.** `paths.include` is `*.tsx` and `paths.exclude` is `*.test.tsx`. The rule reads source
text, string contents included, so a `.ts` file (a `__tests__/` harness test that embeds component
source in a string) stays outside it; `__tests__/pre-write-guard-rules.test.ts` pins that, with a
`.tsx` control that proves the guard's probe file (named `<rule-id>.tsx`) still reaches the rule.
A component local to a `*.test.tsx` is test scaffolding and is exempt: kiko-code-style's "One
component per file, each in its own folder" states it, and the entry is in
`docs/harness/documented-exceptions.md`. The fixture pair is
`rules/fixtures/kiko-component-explicit-return.bad.tsx` and `.good.tsx`.

**Known limits.** A `pattern-regex`, because Semgrep reads `=> expr` and `=> { return expr; }`
as one function. It reads `const <Name>: FC<...> = (<params>) =>`, also bare `FC` and `React.FC`,
and flags a first token after `=>` that is not `{`. Not seen: a component with no `FC`
annotation (`const Row = (props: Props) => (...)`, gap 20261019T1704/2), a component with a
return-type annotation after the parameters (`({ a }): ReactElement => (...)`), a `function`
declaration, a component wrapped in `memo(...)`, `React.FunctionComponent`, a generic that holds
an `=` inside a string-literal type, and a parameter list that holds a string or a regex literal
with an unbalanced parenthesis. False positives: a comment between `=>` and `{` (the first token
is the comment), and example code in a comment of a non-test `.tsx` that spells an `FC` arrow
with an expression body.

## The `docs-known-limit` invariant

`__tests__/docs-known-limit.test.ts` fails when a plan or a spec under `docs/superpowers/`
files a gap with the phrase "known limit" or "known limitation" (any case, wrapped across a
line break too): a gap is fixed, or put to the user as an open question. Two dated reminders
docs predate the rule and are exempt by exact path, each pinned to the count of matches it
holds (the list is `PREDATING_DOCS` in the test). A doc that gains a match, or loses one
without its pin dropping, fails, and so does an exempt doc with no match left. The list only
shrinks; a new doc is never added. The reason is in `docs/harness/documented-exceptions.md`.

## `kiko-no-typed-jest-require-actual`

Mechanizes kiko-testing's "A jest.requireActual call takes no type argument": a type argument
on `jest.requireActual`, `jest.requireMock`, `jest.createMockFromModule` or
`jest.genMockFromModule` (`jest.requireActual<{ ... }>('m')`), including a
multi-line generic. **Why:** jest-haste-map's dependency extractor (`JEST_EXTENSIONS_RE` in
`node_modules/jest-haste-map/build/lib/dependencyExtractor.js`, which lists exactly those four
names) matches only
`jest.<name>(`, optional whitespace, then a string literal. A typed call yields no
dependency (probed through the module's `extractor.extract`: the typed text gives `[]`, the
untyped one `["m"]`), so `--findRelatedTests` and Stryker's per-test coverage never relate the test
to that module. Proven on the Duo native specs (fixed in 21425bd1 and e015e334). **Fix:**
`jest.requireActual('m') as { ... }`, or a typed const annotation.

**Shape.** One `pattern-regex`
(`\bjest\s*(?:\?\.|\.)\s*(?:require(?:Actual|Mock)|createMockFromModule|genMockFromModule)\s*<`),
not an AST pattern: Semgrep reads an absent type argument as matching `<$T>`, so the AST form also matched
`jest.requireActual('m') as T` and `const x: T = jest.requireActual('m')` (probed on 1.175). The
regex reads across a line break; a comment or a string that spells the typed form is flagged
too, so reword it. A harness test that quotes the typed form in a string is denied by the guard:
build the text at runtime, or keep it under `rules/fixtures/` (the only exempt folder). ERROR,
flat fixture pair `rules/fixtures/kiko-no-typed-jest-require-actual.{bad,good}.ts`.

**Scope: no `paths.include`.** Any file that calls `jest.requireActual` is test code (a test, a
`__mocks__` file, a test-support helper), and a typed call in a helper also cuts the chain test,
helper, real module. The one hit at landing was `src/test-support/field-label-spy.ts`, rewritten
untyped in the same commit. Measured with `npx jest --listTests --findRelatedTests` on the
field-label source before and after: 82 related tests both times, because every consumer of the
spy also reaches FieldLabel through a real import. The typed helper cost nothing there yet; it is
fixed because the next consumer that only reaches it through the spy would lose its test.

**Known limits (each probed).** Not caught, because the regex wants `jest` then `.requireActual`
then `<` with only whitespace between: `jest['requireActual']<T>(`, `(jest.requireActual)<T>(`, a
comment between the callee and `<`, a destructured `const { requireActual } = jest` called with a
type argument, and `jest.requireActual as <T>(m: string) => T`. The bracket and destructured
forms hide the module even untyped, which is a separate gap this rule does not close. A generic
through a type alias IS caught (`jest.requireActual<Alias>(`): any `<` after the callee counts.
The same limits hold for `createMockFromModule` and `genMockFromModule` (one shared regex).

## One exported component per `.tsx` — a Jest invariant and a guard rule

The pre-write guard also runs it in-process as the Node rule
`kiko-one-component-per-file` (`.tsx` only; it reports each exported
component after the first). The Jest invariant below stays the
project-wide check.

`scripts/checks/one-component-per-file.ts` mechanizes kiko-code-style's
"One component per file". It lives alongside the other check tooling
(`import-order.js`, `kill-guard.js`, `full-word-identifiers.js`), not
under `src/` — a harness rule, not app code — and is excluded from
Stryker's mutate set there (`stryker.conf.json`'s `!scripts/checks/**`;
see `docs/harness/documented-exceptions.md`). Its test,
`__tests__/one-component-per-file.test.ts`, imports it directly (a
plain module import, unlike the `.sh`-spawned checks). Semgrep has no
way to express "a second exported-component declaration exists
elsewhere in this file" without `pattern-inside`/taint scoping, and
neither spans two independent top-level statements — so this is a
Jest invariant instead: `exportedComponentNames(source)` returns the
name of every top-level, exported, component-like declaration in a
`.tsx` source string, and `one-component-per-file.test.ts` asserts
every real file under `src/` returns at most one name (0 known
violations today).

The scanner is a hand-rolled heuristic, not a TypeScript AST parse —
consistent with this project's Semgrep-regex style elsewhere (e.g.
`settings-columns.test.ts`'s column-name scan): it blanks every
string/template/comment span first (so a regex never matches text
that only *looks* like a declaration inside a literal), then finds
each top-level (column-0 — Biome formats every top-level statement
flush-left) declaration opener, and classifies each by regex
(`export default function Name`, `export function Name`,
`export const Name`, a two-step `const Name = …; export default
Name;` alias, or a plain local `const`/`function` that might later be
aliased). "Component-like" is `return`/`=>` leading into JSX, or an
`FC`/`FunctionComponent` type annotation on the declaration's own
line.

The jest.mock exemption (an inline mock component defined inside a
`jest.mock(...)` factory body never counts, per the brief) holds for
a structural reason worth knowing before touching this file: a
`jest.mock` factory body is a plain callback, and `export` is only
valid at module top level — so a factory body can **never**
syntactically contain a top-level `export`, meaning an export-keyword
scanner could never mistake an inline mock component for an exported
one in the first place. The scanner still explicitly blanks
`jest.mock(...)` call bodies (bracket-matching, after the noise-blank
pass) as a second, defensive layer — matching the design this rule
shipped with — so a mock factory's own `const`/`function` text can
never be mistaken for a *local* declaration a later `export default
Name;` might resolve to either.

## Import length-sort — a hand-rolled checker (and fixer)

`scripts/checks/import-order.js` (+ its wrapper `import-order.sh`)
mechanizes kiko-code-style's "Import ordering" rule — see that
section for the exact rule (3 blank-line-separated groups, sort
ascending by ending-physical-line length, value-before-type as an
equal-length tiebreak, a bare side-effect import as a barrier). Wired
at the **fast tier** (`fast.sh`; read it for the tool list): the rule is purely per-file with no cross-file
dependency, so per-edit feedback catches drift immediately instead of
waiting for `Stop`. It is ALSO wired project-wide
(`npm run check:import-order`, part of `check:all`) — `import-order.sh`
takes an optional file argument: given one (the fast-tier hook), it
checks only that file; given none, it walks every `.ts`/`.tsx` under
`src/`, `__tests__/`, `e2e/`, plus `App.tsx` (overridable via
`IMPORT_ORDER_SRC_ROOT`, used only by the test to point at a
disposable temp fixture tree instead of the real, much larger repo).
The per-file mode skips a file under `rules/fixtures/` (absolute under
its own root, or relative) and exits 0, since the pre-write guard
(`EXCLUDED_PREFIXES`) and the project-wide roots never read it either:
a fixture may hold any import order on purpose. `full-word-identifiers.sh`
keeps checking fixtures per file, because its project-wide roots
include `rules/fixtures/`.

Tested by spawning the `.sh` end-to-end against fixture files on disk
(`__tests__/import-order.test.ts`, the `__tests__/kill-guard.test.ts`
pattern) — not by importing `import-order.js`'s internals directly.
`import-order.js` is in `knip.json`'s `ignore` list for the same
reason `kill-guard.js` is (see `docs/harness/documented-exceptions.md`):
it is reached only via a `node` invocation from its `.sh` wrapper,
never a static `import`/`require`, so Knip's reachability graph can't
see it.

The scanner is a hand-rolled heuristic (blank comments/strings first,
then walk the leading column-0 run of blank/comment/import lines),
the same style as the one-component-per-file scanner above, with one
extra design point worth knowing before touching it: a comment run
sitting directly above the FIRST import of a blank-line-delimited
group is treated as a PINNED group-level prefix — it never moves, and
is never treated as "belonging" to that first import — which is what
lets a file's own header doc-comment (or a general group-rationale
comment) stay put even when the import beneath it needs to move to a
new position. A comment glued to any OTHER (non-first) import in a
group, by contrast, must travel WITH that import when it moves — the
scanner marks the whole group "unsafe" and its `--write` mode leaves
it completely untouched, rather than guess where the comment should
end up. This is a real, load-bearing distinction, not a hypothetical:
a repo-wide sweep once found 210 files with a real violation;
`--write` resolved all but 7 of them, each left unresolved by exactly
this "comment glued to a non-first import" safety rule. Those 7 were
re-sorted by hand (moving the comment WITH its import, alongside the
file-level prefix comment when both were present in the same file —
see `net-worth-series.test.ts` for a worked example of both rules
applying in the same file at once).

A column-0 `declare module` block (or a one-line `declare module 'x';`) ends
an import run. The imports after it form an independent run: fresh
group-order and adjacency state, no order or adjacency check across the
block. `--write` keeps the block verbatim and fixes the next run
(`ambientBlockEnd`, `checkRun`, `fixRun`). Duplicate specifiers are checked
across all runs. Known limit (run-log gap 20261016T2311-kiko-net-worth-scrub/1):
only a bare column-0 `}` closes the block, so `};`, `} // x`, an indented
block or a one-line-body block still hides the imports after it.

`--write` (`node scripts/checks/import-order.js --write <file...>`) is
a repo-sweep tool, not part of the check-wrapper contract (see "The
wrapper contract" in wrapper-contract.md — a checker only checks) — it is invoked by
hand, never from `import-order.sh`.

Two adjacent groups of the SAME kind (no other-kind group or
side-effect barrier between them) is also a checked violation —
`mergeAdjacentSameKindGroups` folds them into one group and re-sorts
the result, so `--write` fixes this shape itself; it only leaves the
merge for a human when the "comment glued to a non-first import"
safety rule above marks one of the two groups unsafe to touch, OR
when the LATER group has its own PREFIX comment (a comment run
directly above that group's first import) or its own INTERIOR comment
(glued to one of its non-first imports) — folding either would strand
that comment mid-chain once the group boundary disappears, with
nowhere left to attach it.

**The general rule: `--write` re-checks its own output and reports
ANYTHING it could not fix.** Rather than tracking each unfixable shape
as its own bespoke reason, `writeFile` re-runs the plain checker
(`checkImportOrder`) against the text it just wrote (or left
unchanged) and prints `left for hand fix: <file> <reason>` — the exact
same violation string the non-`--write` check would have printed —
for every violation still present, exiting non-zero. This covers a
blocked merge (prefix or interior comment on the later group) and a
group `--write` left completely untouched (a comment glued to a
non-first import) with the same mechanism, so a future unfixable shape
is caught by construction instead of needing its own new tracking
list — never a silent no-op that reads as "nothing to fix" while a
violation is still there.

**Duplicate specifier.** `checkDuplicateSpecifiers` counts every
declaration in the leading import header by its exact specifier
string and flags a specifier with two or more
(`duplicate import of '<specifier>' (<n> declarations)`). It is a
finding of this same analyzer, not a separate check, so it runs
everywhere the analyzer runs: the fast tier, `check:import-order`,
and the pre-write guard's `kiko-import-order` Node rule. The
`matchedText` carries no line number, so an unrelated edit in a file
with a pre-existing duplicate is not a new finding. Adding a third
declaration changes the count and so the text, and the guard denies
it. When you merge a duplicate by hand, delete the old pair BEFORE you
insert the merged line in its sorted position; the other order briefly
makes three declarations, which the guard denies. A namespace import
is exempt (it cannot share a declaration with named imports). A bare
side-effect import beside a VALUE import of the same module counts. A
bare side-effect import beside only `import type` declarations does
not (`duplicateCount`): Babel erases `import type`, so deleting the
bare import would stop the module from running, and `useImportType`
forbids folding it into a value import. Two type-only declarations
beside it still fail.
Biome 2.5.11 has no lint rule for this: only the `organizeImports`
assist merges duplicates, and it is off here. `--write` never merges a
duplicate, because the merged line needs rewrapping at Biome's line
width and a placement for any glued comment. The general re-check
above reports it as `left for hand fix`.

`kiko-repo-no-class` bans any class in a `*.repo.ts`, so a repo's error class lives in
its own non-`.repo.ts` file exported through the repo barrel (precedent:
`src/transaction-templates/repo/template-name-taken-error.ts`).

## `kiko-no-switch` — an AST `switch` pattern, not a keyword regex

`kiko-no-switch` (`rules/semgrep-prewrite.yml`, Class A) mechanizes
kiko-code-style's ts-pattern section: `switch` is banned outright, no
exception. It matches the AST shape of a real `switch` statement rather
than a bare keyword-plus-paren regex — unlike `kiko-repo-no-class`'s
`\bclass\s+\w`, a keyword regex over `switch` has real false-positive
shapes worth avoiding: a comment or string/template literal that merely
*mentions* `switch(`, and a `.switch(...)` method call (an
RxJS-observable-style chain, for example) — none of these are a `switch`
STATEMENT, and the AST pattern naturally ignores all of them. A bare
`switch ($X) { ... }` pattern does NOT match a switch's case-clause list
(verified empirically — 0 findings against the bad fixture's real
`switch`), so the rule is a `pattern-either` of two arms, each anchored
on a real clause label: `switch ($X) { case $C: ... }` and
`switch ($X) { default: ... }`. The `case`-anchored arm draws one finding
per case label in a given switch (ellipsis-after-metavariable matches
once per possible starting clause) — harmless duplication for a keyword
ban, and the fixture's own `EXPECT-FINDING` line only needs at least one
match to start there. Fixture pair:
`rules/fixtures/kiko-no-switch.{bad,good}.ts`, the `.good.ts` one
covering all four false-positive shapes plus the genuine
`match(...).exhaustive()` conversion.

A closed-set mapping over a discriminant read from storage or network —
a DB row's `HoldingType`, a settings-JSON field's own `mode`/`kind` —
needs its catch-all arm to stay `.otherwise()`, not `.exhaustive()`,
whenever the ORIGINAL `switch`/if-chain/ternary-chain tolerated ANY
unmatched runtime value (a trailing `default`, an unconditional trailing
statement, or an implicit "anything else" ternary/if-else branch) — not
just the few other literal members named in the other arms. A fully
literal `.exhaustive()` there silently turns "tolerate a stale or
malformed value" into "crash on it", which is a real behavior change,
not a mechanical rewrite — caught by real Jest suites whose fixtures
either omit the discriminant field entirely or deliberately store an
unrecognized one, relying on exactly that tolerance (`holdingValueBreakdown`'s
`HoldingType` dispatch — two suites with `type`-less holding fixtures;
`resolveTrendFilter`'s stored `trend_filter` JSON `mode`; the
column-mapping screen's stored `statement_mappings` JSON `amount`/
`currency` `mode`). This risk is specific to a discriminant read off
persisted/external data; a purely LOCAL type this codebase's own code
constructs (a `useState` literal, a pure helper's own return value, a
caller-supplied op) has no such stale-data path and stays genuinely
`.exhaustive()`.

## Full words in identifiers — exact-path exemption allowlist, not a suppression comment

`scripts/checks/full-word-identifiers.js` (+ its wrapper `.sh`) mechanizes
kiko-code-style's "Full words in identifiers" rule. Wired at the fast tier
(`fast.sh`; read it for the tool list) — every
`.ts`/`.tsx` is in scope, and a `.js`/`.mjs`/`.cjs` is in scope only under
a `scripts/` directory (the fast tier's own harness-tooling files, the
only place today's tree mixes CommonJS/ESM with TypeScript) — the rule is
purely per-file with no cross-file dependency. Project-wide via `npm run
check:full-word-identifiers` (part of `check:all`) mirrors that: every
`.ts`/`.tsx` under `src/`, `__tests__/`, `rules/fixtures/`, `scripts/`,
`jest/`, `__mocks__/`, `e2e/`, plus `App.tsx` and `drizzle.config.ts`
themselves, and a second pass for `.js`/`.mjs`/`.cjs` under any `scripts/`
directory in scope — everything the fast tier already checks on a fresh
edit, so the project-wide scan can never silently miss a file the hook
guards.

The scanner is the same `blankNoise`-then-scan shape as
`import-order.js`/`one-component-per-file.ts`: blank every string,
template, comment, AND regex-literal span first (a bare letter inside a
regex, e.g. the `e` in `/e([+-]\d+)/`, is not an identifier — a real false
positive hit writing this rule, in `src/currency/decimal/decimal.ts`), then
scan every remaining identifier-like token and split it into lowercase word
parts on snake_case underscores and camelCase/PascalCase transitions
(including the acronym-run boundary — `maskedPAN` splits `masked` + `PAN`,
not `masked` + `PANValue`-style). A word part is flagged only when it
EQUALS a denylisted word from the exact table in kiko-code-style's "Full
words in identifiers" section — never a substring match, so `context`,
`value`, and `cube` never trip on the `ctx`/`val`/`cb` entries buried
inside them (no camelCase transition means no split, so the whole word
stays one part).

This is a hand-rolled checker, not Semgrep, for the same reason
`import-order.js` is: Semgrep has no primitive that splits an identifier
into word parts and tests each against a list across every
identifier-bearing syntax position (a `const` declaration, a function
parameter, a type/interface member, a destructuring binding, a JSX prop) at
once — writing that as `pattern-either` branches would need one branch per
syntax position, is fragile the same way the quoting/anchoring gotchas
under "Semgrep facts verified on 1.175" in semgrep-facts.md are, and
Semgrep still couldn't do the case-preserving word-part split itself.

**Exact-path exemption allowlist, not an inline suppression comment.** The
brief's exception for "a name forced by a third-party API, a DB column, a
persisted JSON key" is NOT syntactically detectable — a DB column's JS-side
field name is a plain identifier, indistinguishable from any other. Rather
than a new per-line suppression-comment syntax (which would need its own
override-guard-style justification check), this rule uses an exact
`{ suffix: '<path from repo root>', word: '<denylisted word>', name:
'<exact identifier>' }` allowlist in the analyzer file itself, checked by
path SUFFIX match (so a temp fixture ending in the same relative path also
matches — this is what makes the allowlist unit-testable without coupling
the test to real repo files). Keyed by (path, word, EXACT NAME), not by
word alone — the name field is load-bearing, not redundant: exempting
`idx` in `src/db/run-migrations.ts` (drizzle-kit's own generated
migration-journal JSON shape — see that file's own header comment) does
NOT exempt `idx` anywhere else, and a (path, word)-only key would have
been too WIDE inside a single file too — `src/crypto-sync/binance/binance.transactions.ts`
needed its wire-mirrored `txId` field exempted while a DIFFERENT `tx`-bearing
identifier in that SAME file (`BinanceTransactionSyncDeps`, this codebase's own type
name) still needed the ordinary rename. Every entry needs a concrete,
verified external-format citation, the same standard as every other
ignore-list exception in this repo — see
`docs/harness/documented-exceptions.md` for the full, individually-cited
list; read `EXEMPTIONS` in `scripts/checks/full-word-identifiers.js`
for the current set. Moving code that holds an exempted identifier moves its
`EXEMPTIONS` entry (path suffix + exact name) in that file and its
`docs/harness/documented-exceptions.md` citation in the same commit; the old
suffix silently stops matching.
