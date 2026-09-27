# Mutation-run cost reduction — proposal (record, 2026-09)

> Status 2026-09-27: Part 2 is APPLIED (b5fdc600: `stryker.conf.json` mutate negations and
> `mutable_source_files` in `scripts/checks/mutation.sh`). Part 1 is NOT applied. Since
> de3ca55a, `mutation.sh` refuses `KIKO_MUTATION_FULL=1` and an unresolvable base, and caps a
> run at `MUTATION_FILE_CAP`; statements below about a whole-project run or fallback, and
> every `mutation.sh:<line>` reference, describe the script when this was written. Read
> `scripts/checks/mutation.sh` for current behavior.

Investigation only. Nothing here is implemented. `stryker.conf.json` and
`scripts/checks/mutation.sh` are UNCHANGED by this document.

Two independent levers:

- **Part 1** — an opt-in "mutate only changed LINES" mode for the manual
  `check:deep` gate (keeps whole-changed-file as the default release gate).
- **Part 2** — a small, justified set of zero-logic files to drop from the
  mutate set (barrels + pure-static styles), each overriding a prior
  "stays in scope" note with a concrete reason.

Stryker pin verified: `@stryker-mutator/core` **8.7.1**
(`node_modules/@stryker-mutator/core/package.json` `"version": "8.7.1"`).
All Part 1 source citations are from that install's `dist/src/`.

> Context7 cross-check could not be performed: the Context7 MCP tools are
> not available in this worktree session (`mcp__context7__resolve-library-id`
> returned "No such tool available"). The orchestrator's standing rule
> applies regardless — for our pinned 8.7.1, the SOURCE is authoritative,
> and every claim below is cited to it. If the public docs ever disagree,
> trust the cited source lines for this pin.

---

## Part 1 — changed-LINE mutation (opt-in)

### Feasibility: YES

Stryker 8.7.1 natively supports per-file mutation RANGES in the `mutate`
list (both the config array and the `--mutate` CLI list). Our diff-scoped
run already passes an **exact-path** CSV (no globs), which is exactly the
input shape ranges require.

#### Verified facts (source-cited)

1. **Range syntax + regex.** A mutate entry may be postfixed with a range:
   `file:startLine[:startColumn]-endLine[:endColumn]`. Lines are **1-based**
   in the input; columns optional.
   - Regex: `MUTATION_RANGE_REGEX` at `dist/src/fs/project-reader.js:18` =
     `/(.*?):((\d+)(?::(\d+))?-(\d+)(?::(\d+))?)$/`. The range must be at the
     **end** of the string (`$` anchor); `.*?` is non-greedy so the split
     happens at the LAST `:` before the range.
   - Docstring examples at `project-reader.js:11-17`: `"src/app.js:1-11"`,
     `"src/app.js:5:4-6:4"`, `"src/app.js:5-6:4"`.
2. **Parse + 1-based→0-based conversion.** `filterMutatePattern`
   (`project-reader.js:100-121`): on a match it strips the range off the
   pattern (`:105`) and builds `mutate: [{ start:{line: parseInt(startLine)-1,
   column: parseInt(startColumn)}, end:{line: parseInt(endLine)-1, column:
   parseInt(endColumn)} }]` (`:106-111`). So our 1-based `git`-derived lines
   are correct as-is — Stryker subtracts 1 itself. Omitted `startColumn`
   defaults to `0`, omitted `endColumn` to `Number.MAX_SAFE_INTEGER`
   (`:104`), i.e. `file:S-E` means "whole of lines S..E inclusive".
3. **Multiple ranges per file MERGE.** When the same file path appears twice
   with array `mutate` values, `mergeFileDescriptions`
   (`project-reader.js:78-94`) returns `{ mutate: [...second.mutate,
   ...first.mutate] }` (`:81`). So N diff hunks in one file = repeat the file
   path N times, each with its own range; both ranges survive.
4. **A range entry CANNOT be a glob.** `options-validator.js:125-143`: if a
   `mutate` entry matches the range regex AND `new Minimatch(mutateString)
   .hasMagic()` is true, it errors "Cannot combine a glob expression with a
   mutation range" (`:128-129`). Our entries are exact file paths (no
   `* ? [ ] { } !( +(`), so `hasMagic()` is false — safe. Our real file
   paths also contain no `:` other than the range separator, so the
   non-greedy split lands correctly.
5. **Range validation.** `options-validator.js:132-140`: `start = parseInt
   (startLine)`, `end = parseInt(endLine)`; errors if `start < 1` (`:135-136`)
   or `start > end` (`:138-139`). Our parser only emits `start>=1` and
   `end>=start` (see the awk below), so both hold.
6. **CLI list parsing.** `-m, --mutate <filesToMutate>` uses the `list`
   parser (`dist/src/stryker-cli.js:65`), where `list = createSplitter(',')`
   (`:20`) and `createSplitter(sep) = (val) => val.split(sep).filter(Boolean)`
   (`:21-23`). So a single `--mutate=a:1-2,a:5-6,b:3-4` splits into
   `['a:1-2','a:5-6','b:3-4']`, each processed (and same-file entries merged)
   exactly like separate config entries. The CLI help text itself documents
   the postfix `:startLine[:startColumn]-endLine[:endColumn]` with example
   `src/index.js:1:3-1:5` (`stryker-cli.js:65`).

No discrepancy found between behavior and the pinned source (docs cross-check
unavailable, see note above).

### Design

#### 1. Computing changed-line hunks

Per changed file, run `git diff --unified=0 <merge_base> HEAD -- <file>` and
parse the `@@ -a,b +c,d @@` hunk headers, taking the **NEW** side (`+c,d`):
lines `c .. c+d-1`. Handle the three real header forms this repo emits
(verified on `src/currency/currency/currency.ts`):

- `@@ -a,b +c,d @@` → range `c-(c+d-1)`
- `@@ -a +c @@` (bare `+c`, no comma) → `d` defaults to 1 → range `c-c`
- `@@ -a,b +c,0 @@` (pure deletion, `d=0`) → **skip** (no new-side lines)

`--unified=0` gives zero context lines, so each hunk's `+c,d` is exactly the
changed/added new-side lines — the tightest possible scope.

Verified bash-3.2-safe sketch (pure `awk`, no associative arrays / namerefs —
per CLAUDE.md's bash 3.2 constraint). This exact sketch was run against a real
changed file and produced correct `file:start-end` entries:

```bash
# emits one "<file>:<start>-<end>" per non-deletion hunk (1-based, NEW side)
git diff --unified=0 "$merge_base" HEAD -- "$file" | awk -v f="$file" '
  /^@@/ {
    match($0, /\+[0-9]+(,[0-9]+)?/); s = substr($0, RSTART+1, RLENGTH-1)
    n = split(s, a, ","); start = a[1]; cnt = (n > 1 ? a[2] : 1)
    if (cnt == 0) next                 # pure-deletion hunk: nothing to mutate
    printf "%s:%s-%s\n", f, start, (start + cnt - 1)
  }'
```

(Loop this over each file in the existing `$changed` list; concatenate all
emitted lines, then `tr '\n' ','` into the CSV, same as today.)

#### 2. Replace or augment? — AUGMENT (opt-in)

Keep the current whole-changed-FILE path (`mutation.sh:80-94`) as the
**default**. Add changed-LINE as an OPT-IN behind a new env flag. Rationale:
the default `check:deep` is the pre-merge release gate and must stay
conservative (see the tradeoff below); changed-line is a cheaper inner-loop
mode a developer opts into while iterating.

#### 3. Flag + exact wiring

- **Flag name:** `KIKO_MUTATION_CHANGED_LINES=1` — matches the existing
  `KIKO_MUTATION_FULL` / `KIKO_MUTATION_BASE` naming already in
  `mutation.sh:77,82`.
- **Precedence:** `KIKO_MUTATION_FULL` wins over everything (whole project),
  exactly as today. `KIKO_MUTATION_CHANGED_LINES` only refines the
  already-computed changed-FILE set into changed-LINE ranges; it never
  changes WHICH files, only which lines within them. An unresolvable
  merge-base still falls back to the whole project (unchanged). An empty
  changed set still exits 0 (unchanged).
- **Wiring point:** inside the existing `if [ -z "${KIKO_MUTATION_FULL:-}" ]`
  block (`mutation.sh:81-94`), only the CSV-building tail changes. Today
  (`:91-92`):

  ```bash
  csv="$(printf '%s' "$changed" | tr '\n' ',')"
  mutate_arg="--mutate=${csv%,}"
  ```

  Proposed: when the flag is set, expand each changed file into per-hunk
  range entries instead of a bare path; otherwise keep the bare-path CSV.

  ```bash
  if [ -n "${KIKO_MUTATION_CHANGED_LINES:-}" ]; then
    ranges=""
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      hunks="$(git -C "$ROOT" diff --unified=0 "$merge_base" HEAD -- "$file" \
        | awk -v f="$file" '
            /^@@/ {
              match($0, /\+[0-9]+(,[0-9]+)?/); s = substr($0, RSTART+1, RLENGTH-1)
              n = split(s, a, ","); start = a[1]; cnt = (n > 1 ? a[2] : 1)
              if (cnt == 0) next
              printf "%s:%s-%s\n", f, start, (start + cnt - 1)
            }')"
      # A file with only pure-deletion hunks yields no ranges; fall back to
      # the whole file so a deletion-only change is never silently unmutated.
      [ -z "$hunks" ] && hunks="$file"
      ranges="${ranges}${hunks}
"
    done <<< "$changed"
    csv="$(printf '%s' "$ranges" | tr '\n' ',')"
  else
    csv="$(printf '%s' "$changed" | tr '\n' ',')"
  fi
  mutate_arg="--mutate=${csv%,}"
  ```

  Everything downstream (`:96-165` — the tee/ETA/streaming, exit-code parse,
  history append, fingerprint) is untouched: `$mutate_arg` stays a single
  space-free token, so its unquoted expansion at `:125` is still safe.

### 4. Tradeoff (stated explicitly)

- **The core miss:** changed-line scope only mutates lines this branch
  touched. A surviving mutant on an **UNCHANGED** line that a changed line
  now newly DEPENDS on is NOT generated — so the gate can pass while a real
  regression path introduced by the change (but sitting on an old line) goes
  untested. Whole-changed-file scope catches that; changed-line does not.
  This is why the default release gate stays whole-file.
- **Line-granularity edges:** with `-U0`, a changed line that shares a
  statement with unchanged logic (e.g. editing one arm of a multi-line
  ternary, or one property of an object whose siblings are unchanged) mutates
  only the hunk's lines — an operator on the same statement but a different
  line is out of range. `git`'s hunk boundaries also occasionally split a
  logical block.
- **Mitigation lever:** widen context with `git diff -U<n>` (e.g. `-U2`)
  before parsing — the same awk consumes the wider `+c,d` and emits wider
  ranges, trading a few more mutants for fewer misses. This is a one-token
  change (`--unified=0` → `--unified=2`) if the tight scope proves too
  narrow in practice.
- **Decision:** changed-line is opt-in for the fast inner loop; the
  merge/release `check:deep` runs the default whole-changed-file (or
  `KIKO_MUTATION_FULL=1`) scope.

---

## Part 2 — excess-exclusion audit

Current mutate excludes (`stryker.conf.json:6-15`): tests, `__tests__`,
`ios`, `**/i18n/locales/**`, `**/*.d.ts`. CLAUDE.md's "Stryker mutate-set
exclusions" documented-exception section explicitly records that these
currently **STAY IN SCOPE on purpose**: *"src/design-system/palette.ts,
theme.ts, entity-tint.ts, every *.styles.ts, src/i18n/index.ts, the mixed
const+function modules, and the barrels all stay IN scope."* Part 2
RECONSIDERS two of those categories (barrels, pure-static styles) and
proposes to override that note — each with a concrete reason and an explicit
acknowledgement of the prior decision. It REJECTS the theme-token files and
the i18n barrel as candidates, confirming they must remain in scope.

Sample = this branch's 69 mutable changed files (contains every target
category). Repo-wide checks were also run where a category spans the tree
(all 130+ `src/**/index.ts`).

### Candidate table

| Candidate (glob class) | Verdict | Why no meaningful mutant | Test coverage lost? | Mechanism |
|---|---|---|---|---|
| **Barrels — `**/index.ts`** (pure re-exports) | EXCLUDE + 1 re-include | Every one is a single `export ... from './x'` re-export. Only mutable token is the module-path string literal; no branch, no arithmetic, no logic. Repo scan: 130+ `src/**/index.ts` are all 1-line barrels; the **sole** exception is `src/i18n/index.ts` (26 lines, an `i18next.init(...)` side-effect module). | No test imports the 7 changed barrels directly (`grep` for `components/<name>'` in `*.test.tsx` → none). | `stryker.conf.json` `mutate`: add `"!**/index.ts"`, then re-include `"**/i18n/index.ts"`. |
| **Pure-static styles — `**/*.styles.ts`** | EXCLUDE + 2 re-includes | Pure `StyleSheet.create((theme) => ({...}))` objects: string/number/object-literal tokens only, no conditionals or arithmetic. 9 of the 11 changed styles files are exactly this. **No test imports any `.styles` file** (`grep "\.styles'"` in tests → none), so their mutants are pure denominator noise. | None — zero test asserts on a `.styles` value. | `stryker.conf.json` `mutate`: add `"!**/*.styles.ts"`, then re-include the 2 logic-bearing ones. |
| `bottom-sheet.styles.ts` | **RE-INCLUDE (keep in scope)** | Not pure-static: `sheet: (bottomInset, maxHeight) => ({ ... paddingBottom: theme.spacing(SHEET_PADDING_STEP) + bottomInset ... })` and `scrollContent: (gap) => ({...})` are runtime style functions with real arithmetic (`+`). A `+`→`-` mutant is meaningful. `bottom-sheet.component.test.tsx` covers this file. | Would lose real arithmetic-mutant coverage. | Positive re-include after the styles negation. |
| `entity-icon-tile.styles.ts` | **RE-INCLUDE (keep in scope)** | Exports a real function `iconTileSize = (theme) => theme.spacing(9)` consumed at runtime by the component; not a pure style object. | Keep to be safe (exported logic helper). | Positive re-include after the styles negation. |
| `src/i18n/index.ts` | **RE-INCLUDE (keep in scope)** | Side-effect module: `i18next.use(initReactI18next).init({...})` calling `deviceLanguage()`, with config booleans/strings. Not a barrel. CLAUDE.md says stays in scope — confirmed. | Keep. | Positive re-include after the barrel negation. |
| `src/design-system/theme.ts` | **REJECTED — has logic, stays in scope** | Contains real arithmetic: `spacing = (m) => m * 4`, `iconSize = (fs) => Math.round(fs * ICON_TO_TEXT_RATIO)`, and the derived `iconSizes`. A `*`→`/` mutant on `spacing` would break layout math. Tested by `theme.test.ts`. | Excluding would lose genuine coverage. | None — no change. |
| `src/design-system/entity-tint.ts` | **REJECTED — heavy logic, stays in scope** | WCAG relative-luminance/contrast math, hex parsing with a throw, `resolveEntityColor` branching, gradient derivation. Densely logic-bearing; tested by `entity-tint.test.ts`. | Excluding would gut real coverage. | None — no change. |
| `src/design-system/palette.ts` | **REJECTED — tested, stays in scope** | Pure color record (zero logic tokens) — looked like a candidate — BUT it is directly asserted by `palette.test.ts`, and its hexes feed `entity-tint`'s `parseHex` (which throws on a mutated-empty string), so a string-literal mutant there is genuinely killable, not pure noise. Also referenced by `theme.test.ts` / `entity-tint.test.ts`. | Excluding WOULD lose test-caught coverage. | None — no change. |

### Mechanism notes (order matters)

`mutate` patterns are applied in array order (`project-reader.js:56-75`): a
positive pattern sets `mutate:true`, a `!`-negation sets `mutate:false`, and
a later positive re-enables a file a prior negation disabled. So the
"exclude a category, then re-include the logic-bearing members" shape is
valid and must keep the re-includes AFTER their negations.

Each new negation needs a CLAUDE.md "Documented exceptions" entry (per the
kiko-linter skill's "every new ignore/exclude entry needs a CLAUDE.md
exception" rule) recording: the exact glob, the re-includes, and the
verified reason (barrels = pure re-exports, no test imports them;
`*.styles.ts` = pure StyleSheet objects, no test imports any of them; the
re-includes carry logic). This override supersedes the current
"stays in scope" note for the barrel and pure-static-styles categories only;
the theme-token files and `i18n/index.ts` remain in scope as before.

---

## Recommended config diff (APPLIED in b5fdc600)

### `stryker.conf.json` — `mutate[]` additions

```jsonc
"mutate": [
  "**/*.ts",
  "**/*.tsx",
  "!**/*.test.ts",
  "!**/*.test.tsx",
  "!__tests__/**",
  "!ios/**",
  "!**/i18n/locales/**",
  "!**/*.d.ts",

  // NEW — barrels: pure re-exports, no logic; re-include the one non-barrel index.
  "!**/index.ts",
  "**/i18n/index.ts",

  // NEW — pure-static StyleSheet objects; re-include the 2 logic-bearing styles.
  "!**/*.styles.ts",
  "**/bottom-sheet.styles.ts",
  "**/entity-icon-tile.styles.ts"
]
```

(These are config-level negations, so they apply to BOTH the whole-project
fallback and the diff-scoped `--mutate` run — Stryker intersects the
`--mutate` list with the config `mutate` filter. No `mutation.sh` change is
needed for Part 2; the negations live entirely in the config.)

### `scripts/checks/mutation.sh` — Part 1 flag sketch (opt-in)

Replace only the CSV-building tail at `mutation.sh:91-92` with the
`KIKO_MUTATION_CHANGED_LINES` branch shown in Part 1 §3 above (the awk
hunk-parser expands each changed file into `file:start-end` range entries;
default path unchanged). `KIKO_MUTATION_FULL` still wins; empty changed set
still exits 0; unresolvable merge-base still falls back to whole project.

### Suggested rollout

1. Part 2 first (config-only, low risk, immediate denominator reduction on
   every run) — with its CLAUDE.md exception entry.
2. Part 1 as a separate, TDD'd change to `mutation.sh` (extend the hermetic
   `__tests__/mutation-stream.test.ts` diff-scope test with a changed-lines
   case asserting the emitted `--mutate` ranges), since it touches gate logic.
