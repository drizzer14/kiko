## Semgrep facts verified on 1.175 — don't relearn these the hard way

- `paths.include` CAN be path-prefixed (e.g. `"src/screens/**"`), but
  only when the fixture for that rule is placed at the MIRRORED nested
  path under `rules/fixtures/<rule-id>/<mirrored path>/...` rather than
  flat at `rules/fixtures/<rule-id>.bad.<ext>` — the fixture runner
  scans `rules/fixtures/` directly, so a flat fixture silently draws
  **zero** findings against a path-prefixed include (the fixture isn't
  under that prefix) — verified by sabotage: the prefixed form drew
  zero findings against a flat fixture. A **basename-only** pattern
  (e.g. `"*.swift"`) needs no nesting. `kiko-no-literal-sync-error`
  (`rules/semgrep-prewrite.yml`, `paths.include: src/crypto-sync/**,
  src/monobank/**`) is the nested-fixture example — its fixture pair
  lives at `rules/fixtures/kiko-no-literal-sync-error/src/monobank/...`,
  mirroring the included path; read it directly for the current shape.
  (`kiko-no-cross-screen-import` is NOT a Semgrep rule and has no
  fixture pair at all — it is a `NODE_RULES` entry in
  `pre-write-guard.js`, run via `scripts/checks/screen-imports.js`.)
- `pattern-inside: func $F(...) { ... }` (or any brace-delimited
  container pattern) matches **nothing** in Swift — Semgrep's rules
  here are effectively file-scoped for Swift, not function-scoped. A
  Swift rule that needs to be "inside a function" should scope by
  file content instead (e.g. `pattern-regex` over the whole file, or
  requiring co-occurring markers), not by `pattern-inside`.
- Taint mode does **not** propagate through a `.then(callback)`
  parameter — neither a `propagator` nor a `focus-metavariable` source
  closes this. A `readSecret().then((value) => { setState(value) })`
  shape needs a **separate syntactic companion rule** (not taint mode)
  with its own fixture pair, sharing only a message theme with the
  taint rule.
- `metavariable-regex` is **start-anchored** against the metavariable's
  text. A regex like `\.(formatted|total)(\.|$)` matches nothing when
  the metavariable itself starts with a member access
  (`snap.total.formatted`) — it needs a leading `.*` (`.*\.(formatted|
  total)(\.|$)`) to match anywhere in the text. Verified empirically:
  the anchored form drew 0 findings, the `.*`-prefixed form drew the
  expected 4.
- `paths.exclude`, unlike `paths.include` above, IS safe to path-prefix
  (e.g. `"src/screens/**"`) — verified empirically against a throwaway
  rule+tree that a path-prefixed exclude matches correctly whether
  Semgrep's target is a whole directory, an absolute directory path, or
  a single absolute file path (`fast.sh`'s per-file scan). The failure
  modes are asymmetric: an `include` that fails to match fails CLOSED
  (the rule silently never fires — the `rules/fixtures/` gotcha above),
  while an `exclude` that fails to match fails OPEN (the rule still
  applies) — which is exactly why `kiko-no-import-screens-outside-ui`
  (`rules/semgrep-mobile.yml`) uses a path-prefixed `paths.exclude` for
  `src/screens/**`/`src/navigation/**` instead of trying to scope the
  rule down with `paths.include`.
- A `pattern:`/`pattern-either` string containing a bare `:` (a ternary
  `? … : …`, an object literal, a type annotation) MUST be YAML-quoted
  (`pattern: "$X ? $A : $B"`), never left bare
  (`pattern: $X ? $A : $B`). Left bare, YAML parses everything after
  the first unquoted `:` as a nested mapping key, which Semgrep then
  rejects as "Invalid YAML file: mapping values are not allowed here"
  — but that error is only visible when the config is invalid; a
  **subtly wrong but still-parseable** unquoted pattern silently
  matches NOTHING instead of erroring, which is what actually happened
  writing `kiko-no-nullable-map-ternary`: `pattern: $A ? $B : $C`
  parsed as valid YAML with a truncated pattern string and produced
  zero findings against a fixture the rule was later proven (once
  quoted) to match. Verified empirically: the bare form gave 0
  findings on a trivial `true ? 1 : 2` fixture; the quoted form gave 1.
  Quote every ternary/object/type-annotation pattern string from the
  start, rather than debugging a mysteriously-empty result set.
- A bare `switch ($X) { ... }` pattern matches NO real `switch` statement
  — a switch's body is a case-clause list, not a generic statement block,
  so the block-ellipsis operator does not generalize to it the way it
  does for a function/if body. Anchor on a real clause instead:
  `switch ($X) { case $C: ... }` (`kiko-no-switch`) — verified
  empirically: the bare form gave 0 findings against a real `switch`
  fixture with three `case` arms; the clause-anchored form matched.

## Semgrep facts verified on 2026-10-11 (`kiko-no-typed-jest-require-actual`)

- An AST pattern `jest.requireActual<$T>(...)` also matches the UNTYPED call (1.175), so a
  type-argument ban uses `pattern-regex`.
- When a regex rule widens, probe the adjacent forms in the same commit and list each miss in the
  known limits (the node-print rule's `-r ./setup.js -p` miss was found only after landing).

## Semgrep facts verified on 2026-09-25 (pre-write guard build-out)

- An unanchored `paths.include`/`paths.exclude` glob (e.g. `src/screens/**`,
  no leading `**/` or root pin) matches correctly whether Semgrep's target
  is the real repo root or a completely different root (a worktree, a
  fixture directory scanned directly) — the guard's per-write scan runs
  Semgrep against a temp copy of the proposed content, not the repo tree,
  and the same include/exclude patterns still resolved correctly there.
- Never read `extra.lines` from Semgrep JSON: this Semgrep version
  reports it as the literal string "requires login". Slice the matched
  text from the scanned file by the UTF-8 BYTE offsets
  (`start.offset`/`end.offset` on a Buffer), as `buildFinding` in
  `pre-write-guard.js` does.
- A `// nosemgrep: <rule-id> OVERRIDE(<reason>) <justification>` comment
  is honored by Semgrep's own suppression even with trailing text after
  the rule id. That holds for `check:security` only. The pre-write guard
  runs Semgrep with `--disable-nosem` and applies its own override
  matcher instead — see "Override forms and where each is honored".
- Inside ONE `patterns:` list, a text-based `pattern-regex` narrows the
  matched span to its own matched text, and a sibling negative filter
  (`pattern-not-regex` or a structural `pattern-not`) is then checked
  against that narrowed span, not the original node — so the exclusion
  silently never fires and every candidate matches. To exclude a value,
  capture it as a metavariable and filter it with `metavariable-regex`
  (which does not narrow the span), and give each text-based filter its
  own `patterns:` arm under a top-level `pattern-either` (the
  `kiko-pinned-*` Button rules in `rules/semgrep-prewrite.yml`). A
  narrowed span also reports the finding at the narrowed child line, not
  the enclosing statement, so an `EXPECT-FINDING` pin cannot land there
  (`kiko-no-hand-built-selectable-row`'s fixture cannot pin at all).

- A PCRE `\K` inside a `pattern-regex` works on Semgrep 1.175 (probe scanned
  by path, `paths.scanned` read, 2026-10-05): the reported `start` is the
  offset right after the `\K`, `end` is the match end, and a lookahead after
  the member keeps the rest of a comment out of the span. `buildFinding`
  slices `[start.offset, end.offset)`, so the guard's matched text is the
  member alone. The reported line is the member's line.

## Semgrep facts verified on 2026-09-28 (the Round A guard rules)

1. `pattern-not: import type { $X } from 'm'` also matches the VALUE
   import `import { X } from 'm'`, so the rule removed every finding
   and reported nothing. Use `pattern-regex` with a `(?!type\b)`
   lookahead after `import`/`export` instead
   (`kiko-no-root-calendars-value-import`).
2. `pattern-not: "{...}"` in a `metavariable-pattern` does NOT exclude
   an object-literal argument. Filter the argument's own text with
   ``metavariable-regex: ^(?!['"`{])`` instead
   (`kiko-no-raw-error-in-console`).
3. A deep-expression pattern
   `$O.$M(..., (...) => <... $X.$N(..., (...) => <... $DATE ...>, ...) ...>, ...)`
   reports the OUTER call's line, so its `EXPECT-FINDING` pin goes above
   the outer call, not above the inner one
   (`kiko-no-per-bucket-date-in-statistics`).
4. Inside an arrow with a BLOCK body, the deep-expression operator
   `<... $X ...>` reaches only the block's `return` statement, not a
   `const` initializer or an expression statement. To match a block-body
   callback, add a separate statement-sequence arm:
   `$O.$M(..., (...) => {` / `...` / `$X.$N(..., (...) => <... $DATE ...>, ...);`
   / `...` / `}, ...)`. That arm also matches the inner call as a `const`
   initializer, and it reports the outer call's line. Do
   not scope with `pattern-inside: $O.$M(..., (...) => { ... }, ...)`
   instead: `{ ... }` also matches an EXPRESSION body, so a one-off
   `rows.map((row) => new Date(row))` matches itself and fires
   (`kiko-no-per-bucket-date-in-statistics`).

## Semgrep facts verified on 2026-09-29 (`kiko-no-needless-async-either-thunk`)

- Semgrep IGNORES the `async` keyword of an arrow function in a
  pattern: `const $F = async () => $B` also matches
  `const f = () => …`, and `either(async () => $F())` also matches
  `either(() => f())`. `async function $F(...) { ... }` DOES require
  the keyword. To require an async arrow, capture the initializer
  (`const $F = $INITIALIZER;`) and filter it with
  `metavariable-regex` (`^(async\b|useCallback\(\s*async\b)`).
- A `pattern-inside` that opens with `...` before a common statement
  (`...` / `const $F = $INITIALIZER;` / `...`) is quadratic on a large
  file: each `const` opens a range on both sides. It ran 63 s on
  the transaction-form screen (then one 2818-line file, since split) and the guard denied
  "could not check" on every write to it. Even the rarer
  `async function $F` arm with a leading `...` cost 0.15-0.26 s of rule
  match time per large file, and under `check:security`'s full-tree
  load it hit the per-rule timeout on `holding-form.screen.test.tsx`
  (4173 lines), which fails the gate. The guard speed check did not
  show that. So never write the two-sided `...` / `<decl>` / `...`
  (O(k*m) ranges per declaration): write `<declaration>` / `...`. A
  one-sided leading arm `...` / `<decl>` is allowed only when it is
  needed to keep findings (e.g. a use placed before a hoisted
  declaration) and its cost is measured with `semgrep --time` on the
  largest matching file (`match_times`, not wall time). Example:
  `kiko-worklet-directive-required` once used two-sided arms and timed
  out `check:security` on
  `src/screens/statistics/net-worth-line/net-worth-line.component.tsx`
  (1.4-2.9 s of rule match time against the 5 s default per-rule
  budget under load); split into one-sided arms it costs 0.12-0.21 s
  there and the whole tree went 2.69 s to 0.35 s, with identical
  findings. Pin each arm with its own fixture. A rule with only the
  trailing arm accepts the false negative that a use placed before a
  hoisted `async function` is not flagged. For every new statement-sequence rule, run both the
  guard speed check in "Adding a pre-write guard rule" AND a
  whole-tree `npm run check:security`; the fixtures are too small to
  show either cost.
- `either(async (...$REST) => $F(...$REST))` matches nothing when the
  target's rest parameter has a type annotation
  (`(...rest: []) => …`); write `(...$REST: $TYPE)`.

## Semgrep facts verified on 2026-09-29 (`kiko-no-source-text-read-in-test`)

- With `options: { symbolic_propagation: true }`, a top-level
  `pattern-not: $READ($JOIN(..., "=~/\.csv$/"), ...)` also drops
  `readFileSync(FIXTURE_PATH)` when `const FIXTURE_PATH = join(…,
  'x.csv')`, and it sees through two levels
  (`join(migrationsDir, name)` with `migrationsDir` a `const` join).
  The same filter as a `metavariable-pattern` on the path argument does
  NOT see through the `const`: every identifier path fired.
- A pattern on `readFileSync(...)` also matches a renamed named import
  (`import { readFileSync as read }`), a default or namespace import
  (`fs.readFileSync`), `require('node:fs').readFileSync`, and
  `fs.promises.readFile` via `$FS.readFile(...)`.
- A metavariable callee `$READ(...)` also matches a member call
  (`fs.readFileSync(…)`, `fs.promises.readFile(…)`), so a
  `pattern-not: $READ(...)` needs no `$FS.$READ(...)` twin. The good
  fixture's `fs.` reads pin this.
- Semgrep skipped every file when it scanned a DIRECTORY under the
  scratchpad (`paths.scanned` was empty, no error); naming the file
  scanned it. Scan a probe file by its path, and read `paths.scanned`
  before trusting a zero.

## Semgrep facts verified on 2026-10-01 (the P5 guard rules)

- A bare `{}` in a pattern matches ANY object literal. Pin an empty
  side with `metavariable-regex` on `^\{\s*\}$`.
- A bare JSX attribute (`<Button fullWidth />`) reads as `={true}`.
- `metavariable-comparison` folds constant arithmetic
  (`24 * 60 * 60 * 1000`).
- Constant propagation makes `pattern: $X` plus a comparison match an
  identifier use too, so write each operand as literal text.
- A QUOTED number-literal pattern (`"86400000"`) matches every spelling
  of that value. Quote it in YAML: unquoted `864e5` is a float.
- `options: { constant_propagation: false }` stops a literal pattern
  from matching a propagated identifier. Fixtures cannot pin this
  option: the verifier checks only positive lines, so a stray
  identifier match in a good fixture is the only signal.
- `pattern-not-inside` with an object pattern skips by range: the whole
  object literal's span.
- Semgrep reports a parenthesized JSX expression at the `(` line; pin
  `EXPECT-FINDING` there.
