---
name: kiko-code-style
description: Invoke when writing any .ts or .tsx file in Kiko — before writing new code, when reviewing existing code for style issues, or when unsure how to structure imports, types, currency mapping, or composition. Covers conventions not derivable from biome.json alone, and when to use OOP vs functional vs procedural style.
---

# Code style for Kiko

Adapted from the sibling project's skill at
`~/Developer/Projects/ovpn-ui/.claude/skills/ovpn-ui-code-style/SKILL.md`.
That skill assumes Prettier; **this project formats with Biome**
(`biome.json` at the repo root), so every formatting rule below comes
from that file, not from ovpn-ui's Prettier settings. Do not port
Prettier-specific numbers (4-space indent, 100-char width happens to
match, but verify against `biome.json` if it ever changes — don't
assume the two files stay in sync).

## Formatting — enforced by Biome, don't hand-manage

From `biome.json`:

- Single quotes.
- 2-space indentation (not 4 — this differs from ovpn-ui).
- 100-character line width.
- Trailing commas everywhere (`"all"`).
- Arrow function parens are always required (`arrowParentheses:
  "always"`) — write `(x) => x + 1`, never `x => x + 1`. This
  **reverses** the earlier "asNeeded" setting: `biome.json` must be
  set to `"always"`, and a repo-wide `biome format --write` pass
  applies it everywhere at once, not file by file.

Run `npm run check:lint` to verify (see the project harness in the
root `CLAUDE.md`). Never hand-tune something Biome already owns.

### Blank lines before statement blocks

Biome does **not** enforce this, but the pre-write guard does
(`kiko-blank-line-separation` in `scripts/checks/pre-write-guard.js`'s
`NODE_RULES`, plus the project-wide `npm run check:blank-line-separation`):
put a blank line
before every `return`, and before every `if`, `for`, and `while`
statement (`switch` is banned outright by `kiko-no-switch`; read
`STATEMENT_KEYWORD` in `scripts/checks/blank-line-separation.js` for the
checked set). It visually separates that block from whatever
led up to it, the same way a blank line already separates import
groups. A pre-write-guard deny on this points back here.

Exceptions: a statement that is the first line of its block (directly
after `{`), and a statement directly under a comment line (the comment
already separates it). `node scripts/checks/blank-line-separation.js
--write <file>` inserts missing blank lines.

```ts
export const toHex = (color: string): string => {
  const match = color.match(RGBA_PATTERN);

  if (!match) {
    return color;
  }

  const bytes = parseBytes(match);

  return formatBytes(bytes);
};
```

### Arrow body: block form for a genuinely hard-to-scan expression

Judgment call, not mechanized — there is no Biome/Semgrep rule for
this, and none is planned. A syntactically faithful rule (flag every
arrow whose concise body contains `&&`/`||`/`?:`) was tried during
review and matched 62 arrows against the ~15 actually worth
converting, with identical shapes intentionally treated oppositely
(`isSyncedAccount` in `src/holdings/` was converted to a
block body; `isBalanceProviderId` in `src/crypto-sync/`
stayed concise) — no low-false-positive syntactic rule exists, so
this stays a human/agent judgment call, applied in code and in
review.

Convert an arrow's concise body to a block body with an explicit
`return` when the expression is genuinely hard to scan — a nested
logical/ternary expression, including one hidden inside an
object-literal property value or a template-literal interpolation.
Leave it concise when it is a short idiomatic predicate, a
type-guard, a one-line ternary, or a single `as const` narrowing on a
literal — those always stay concise.

### Blank line between adjacent JSX sibling nodes

Now mechanized the same way (see above) — Biome and the formatter are
whitespace-insensitive inside JSX, so this check lives in the
pre-write guard's `NODE_RULES` and `check:blank-line-separation`
instead. Separate adjacent JSX sibling expression nodes with a blank
line, the same way statement blocks get one.

Exceptions: a parent with exactly two child elements, siblings
separated by a comment line, and siblings at different indentation.
Read `scripts/checks/blank-line-separation.js` for the exact test.

### `.concat` over a multi-part template literal

When building a string from many parts with no separators between
them — assembling an `#RRGGBBAA` hex string from four byte-hex parts,
for example — prefer `String.prototype.concat` over a template
literal with many interpolations; it reads better than a long run of
`${...}${...}${...}${...}`. A simple one- or two-part interpolation
with separators (`` `${base}:${quote}` ``) stays a template literal.

### Wrap comments at 100 columns

Biome cannot wrap a comment, so a long one stays long until its author
wraps it. Shell scripts (`scripts/**/*.sh`) follow the same 100-column rule for their `#` comments, pinned by
`__tests__/shell-comment-width.test.ts`. The pre-write guard (`kiko-comment-line-width`) denies a new
physical line over 100 columns that holds comment text: a `//` comment,
any line of a `/* */` or `/** */` block, a JSX `{/* */}` comment, or a
trailing comment after code. Break the comment at a space and continue on
the next line at the same indentation, or move a trailing comment above
its code. A long code line with no comment is Biome's, not this rule's.

- Columns are Unicode code points of the line without its trailing
  whitespace, so a Cyrillic letter is one column, as Biome counts it.
  Biome counts a wide East Asian character or an emoji as two; the check
  counts one.
- Only a real comment counts. A string, template, or regex literal that
  holds `//` or `/*` is not a comment.
- Exempt only a comment that cannot be wrapped. Take it alone on its own
  line (a trailing comment moved to its line, at the line's indentation).
  Drop its opener (`//`, `/*`, `/**`, a leading `*`) and a closing `*/`;
  what remains are its words, split on whitespace. A wrap point exists
  when there are at least two words and the first word ends at column 100
  or earlier. The line is exempt when the comment alone is over 100
  columns and has no wrap point: one long URL after the opener.
  `// see https://...` still fails, because the words before the URL wrap;
  after the wrap, `// https://...` is exempt. A JSX `{/* */}` comment is
  measured with its braces, both for the 100 columns and for the exemption.
- A short trailing comment on a long code line that Biome has not yet
  formatted is denied: the guard measures the line as written, before
  Biome wraps the code. Run the formatter first, or move the comment
  above its code.
- A tool directive (`// biome-ignore`, `// nosemgrep`, `// kiko-override`)
  must stay on the line directly above its code, so it cannot continue on
  a second line (Biome reports a suppression followed by another comment
  line as unused). Put the prose in a plain comment above the directive and
  keep the directive's own justification short enough to fit in 100
  columns.
- There is no inline override: the guard ignores a `nosemgrep` or
  `kiko-override` comment that names `kiko-comment-line-width`, and the
  finding still denies. `scripts/checks/comment-line-width.js` holds the
  exact test.

## Linting rules that shape how you write code

From `biome.json`'s `linter.rules`:

- `noExplicitAny` is an error — there is no untyped escape hatch.
  Model the type properly; if a third-party boundary is genuinely
  untyped, that needs a justified `OVERRIDE(...)` comment (see the
  root `CLAUDE.md` "Override protocol"), not a stray `any`.
  `unknown` + narrowing is the fallback, not `any`.
- `noUnusedVariables` / `noUnusedImports` are errors — no unused
  bindings, ever, not even during a work-in-progress edit.
- `noExcessiveCognitiveComplexity` caps at 15 — measured PER FUNCTION
  DECLARATION, not per file. **Real extraction is the fix — moving a
  branch, effect, or piece of state into its own named function, hook,
  or component (something with its own top-level `const .../function
  ... = (...) => {...}` binding) removes that code from the caller's
  score entirely, because Biome measures each declared function
  independently and does not walk into what it CALLS.** This is why a
  custom hook (`useBondIsinMode`,
  `src/screens/forms/holding-form/bond/use-bond-isin-mode/`) or a
  sibling section component
  (`MetalSection`/`PropertySection`/`BondIsinSection`/
  `ManualBondFields`) is the right fix for a screen that is exhausting
  its budget: pull the state/effects/JSX that belong to one concern
  into their own file, not just their own local variable. When the
  budget is exhausted by several independent JSX `{cond && <X />}`
  gates rather than by one concern's own state — each `&&` is its own
  binary-logical-operator increment — a `match(type).with(a, () =>
  <A />).with(b, () => <B />)…exhaustive()` chain does not add to the
  score at all (Biome only counts if/else, ternary, `&&`/`||`, `??`,
  `catch`, switch/case and loops; a chained method call is none of
  those), so collapsing the gates into one match is the fix instead of
  another extraction (`holding-form.screen.tsx`'s own per-type
  form-block dispatch).
- `complexity.noVoid` is an error — never use the `void` operator.
- `nursery.noFloatingPromises` is an error — a promise statement must be
  awaited, returned, or given a rejection handler (`.catch(handler)` or a
  two-argument `.then`). In tests, `await` every `fireEvent.*` and
  `rerender` call (RNTL returns a promise). A deliberate fire-and-forget
  of a total function (an `either(...)` call, `refreshMarketData`,
  `runLoanAutoLink`, a hook's shared `sync`) stays a plain expression
  statement with a justified override on the line above:
  `// biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) <callee> never rejects`.
  Verify the callee never rejects before you write that; if it can
  reject, handle the rejection instead. For `logOnFailure(...)` (never
  rejects): in an event handler make the handler `async` and
  `await logOnFailure(...)`; in a `useFocusEffect`/`useEffect` callback,
  which must not return a Promise, use the expression statement with the
  override above. Its log tag is `'[module] message'`. Biome does not flag a promise
  returned from an expression-bodied arrow (`onDelete={(day) =>
  repo.remove(day)}`), so a void-typed callback prop that drops a
  promise stays a review item.

## Comments: WHY only, never history

A comment explains only WHY, and only when the code cannot show it on
its own — never restate what the code already does. This applies to
tests and skills too, not only application code.

No history in a comment: no task id (`T28`), no review-round id (`I1`),
no spec section number (`spec 6.2`), no plan citation (`per the plan`),
and no "changed because …" narrative (the full set is the regexes of
`kiko-no-history-id-comment` and `kiko-no-history-word-comment` in
`rules/semgrep-prewrite.yml`). That belongs in the commit message that
made the change, or in the skill section that owns the rule — never
in a comment left behind in the code. Mechanized in `src/**` by the
`kiko-no-history-id-comment` Semgrep rule (ERROR) — see the
kiko-linter skill's own section on it for the rule's design.

The "changed because …" narrative words are mechanized too, by the
`kiko-no-history-word-comment` Semgrep rule (WARNING until its sweep
lands): read the phrases in that rule's `pattern-regex` and `message` in
`rules/semgrep-prewrite.yml` (they include a `was:` label before an old value,
`// was: 30`). Write
how the code works today and why ("matches the holding", "a card absent
from the snapshot"), never what it did before.

When you reword a history comment into the present tense, re-derive its
reason from the current code; never only swap the verb ("was" to
"would", "no longer" to "does not"), because the old reason can
describe behavior the code does not have. When you delete or rename a
label inside a comment, grep for pointers to it ("see X's ... comment").

A comment carries no date of a ruling, a finding, or a plan ("user-approved
2026-10-08", "Device finding", "(multi-account plan, 2026-09-11)", a dated docs path):
that is history too. The `kiko-no-history-date-comment` Semgrep rule (ERROR) mechanizes
those shapes; a date that is data (a fixture day, a DST day) stays.

A comment names no task, step, finding, or spec id (`item 6`, `DEVICE BUG`,
`Bug A2`, `Feature 1`, `SEC-C1`, `(A1)`): it states the reason itself. The
`kiko-no-task-id-comment` Semgrep rule (WARNING until its sweep lands)
mechanizes the shapes listed in its kiko-linter section.

Documented exception: the data-provenance date comment in
`src/rates/fiat-rate-seed/fiat-rate-seed.ts` stays — it records WHEN
the seed values were captured, which the code cannot show on its own,
not a history narrative about a task or review round.

## Split a `useEffect` per logical concern, before it ships

A single `useEffect` combining two or more unrelated "when X changes,
do Y" rules under one shared dependency array lets an unrelated
dependency change re-fire the whole effect and cross-talk into
another rule's side effect. `useBondIsinMode`
(`src/screens/forms/holding-form/bond/use-bond-isin-mode/`) originally merged found-ISIN-terms
apply + purchase-date default + register refresh into one effect: a
picked date or a mode flip re-ran the whole thing, silently
overwriting a typed name/currency, and the same re-fire put the form
in a Manual/ISIN loop on repeated taps.
The fix was splitting into three effects, each with its own narrow
dependency array — not narrowing the dependency array on the merged
effect. Split BEFORE it ships, not after a review catches the
cross-talk.

## Style choice: functional-first, OOP for data models

Default to functional or procedural code. Reach for OOP only when
modeling a **data type with behavior attached to it** — the
canonical example is the `Money` value object (see `kiko-domain`):
immutable, with methods like `add`/`subtract` that must enforce
invariants (no currency mismatch, no float drift) every time the
value is touched. A class earns its place when the invariant needs
enforcing at every call site, not just at construction.

A value object's internals use native private fields and methods
(`#field`, `#method`), not the TS `private` keyword — TS `private` is
erased at compile time and still visible/settable from plain
JavaScript or a type-cast, native `#` is enforced by the runtime
itself. The one exception is the constructor: JavaScript has no
native private constructor syntax, so a `private constructor` used to
force construction through a static factory keeps the TS `private`
keyword — document why at that one site so it doesn't read as an
inconsistency.

Annotate every public class field explicitly, including its type —
`public readonly currency: Currency`, not a bare `readonly currency`
left to inference. A public field is part of the class's contract;
state it the same way a function signature would.

Everything else defaults to plain functions and modules:

- Repositories are functional modules of exported functions, not
  classes (see `kiko-architecture`).
- The Monobank sync pipeline is a functional pipeline of transform
  steps, not a class hierarchy.
- Use procedural code (a straight-line function, a loop) where it is
  simply clearer than a functional-composition chain — don't force a
  `pipe` for its own sake on a two-step transform.

## `ts-pattern` for exhaustive mapping

Any place that maps over a closed set of literals — currency codes,
account/holding `kind`/`type` (including the `loan`, `metal`, and
`property_item` holding types, see `src/holdings/holding-type/holding-type.ts` for
the current full set), Monobank statement kinds, ISO 4217 numeric
codes — uses `ts-pattern`'s `match(...).exhaustive()` rather than a
`switch` or an `if`/`else` chain. Exhaustiveness checking means adding
a new currency or a new holding type is a compile error at every
mapping site that hasn't been updated, not a silent runtime gap. See
`kiko-domain`'s "Adding a holding type" section for the full
descriptor/form/detail-spec checklist a new holding type needs.

A single boolean guard used exactly once (an `if`/`else` with no
closed-set enum behind it) may stay as-is. Every branch over a closed
literal set uses `ts-pattern`'s `match(...).exhaustive()` (or a typed
`Record` for a pure lookup) — no `switch`, with no exception; mechanized
by the `kiko-no-switch` Semgrep rule (see kiko-linter's own
`kiko-no-switch` section for the rule itself, and its
`.otherwise()`-vs-`.exhaustive()` guidance for a closed set sourced from
persisted or external data rather than constructed locally).

Per-mode behavior chosen by booleans derived from one union (`isExchange
= mode === 'exchange'`, `isSplit = mode === 'split'`, plus an override
flag such as `converting`) goes into ONE typed table
`Record<ActiveMode, Behavior>`, keyed by a resolved union value (resolve
the override first: `converting ? 'converting' : mode`) — not parallel
`if`-chains over the `isX` booleans. A new mode is then a compile error
in one table. See `MODE_BEHAVIOR` in
`src/screens/forms/transaction-form/validation/validation.ts`; this
closes the open note of finding U5 in
`docs/reviews/2026-09-codebase-review.md` that this section did not cover
booleans derived from a union. A judgment rule, not mechanized.

In a per-row or per-keystroke hot path (rule matching over every transaction), use a typed `Record` table, not `match(...).exhaustive()`: the ts-pattern matcher cost 952 ms against 10 ms for the same lookup over 10 000 rows x 200 rules (`src/categories/category-rules`). Exhaustiveness stays in the Record's key type. Judgment rule, not mechanized.

The set itself needs exactly one source of truth. Derive the literal
union type from a `const` tuple, instead of hand-maintaining a union
type and a separate `Set` literal that can drift apart:

```ts
const currencies = ['BTC', 'USD', 'EUR', 'UAH'] as const;
type Currency = (typeof currencies)[number];
```

For a small closed set like this, a parallel runtime `Set` for
membership is redundant — two variables doing the same job. Test
membership on the tuple directly instead:

```ts
export const isCurrency = (value: string): value is Currency =>
  (currencies as readonly string[]).includes(value);
```

Only add a derived `Set` when the set is large or membership is
checked on a hot path where O(1) lookup measurably pays off — and
even then, build it from the tuple, never from a second hand-written
literal.

Colocate a type derived from a `const` this way — including a
Drizzle `$inferSelect` row type — directly after the `const` it comes
from, not stacked together at the end of the file. The reader should
never have to jump away from a declaration to see what it produces.

## Banned: the nullable-map ternary

`x === undefined ? undefined : f(x)` — and its `null`/`== null`
variants — is banned. This smells badly: it hand-rolls exactly what a
`Maybe` mapping already does, without the type making the "might be
absent" case visible at the call site.

Use `fnts`'s `maybe` + `foldMap` instead — `foldMap` maps and unwraps
in one step, which is the common case (compare to `fmap`, which stays
wrapped as a `Maybe` when the result needs to flow into more `Maybe`
operators):

```ts
// wrong
const label = holding.nickname === undefined ? undefined : holding.nickname.trim();

// correct
import maybe, { foldMap } from 'fnts/maybe';

const label = foldMap(maybe(holding.nickname), (nickname) => nickname.trim());
```

Reach for `fmap`/`bind`/`fold` instead of `foldMap` only when the
result itself needs to stay a `Maybe` — chaining into another
`maybe` operator, or returning a `Maybe` from the enclosing function.

The list-or-empty form of the same smell — `x === null ? [] : [f(x)]`
— is a nullable map too, and is banned the same way, with no
exception. Convert it with the same `maybe` + `foldMap`, wrapping the
mapped value in the singleton array and falling back to `[]` since
`foldMap` returns `NextValue | undefined`:

```ts
// wrong
const tags = holding.category === null ? [] : [toTag(holding.category)];

// correct
import maybe, { foldMap } from 'fnts/maybe';

const tags = foldMap(maybe(holding.category), (category) => [toTag(category)]) ?? [];
```

The empty-object spread form — `...(x === undefined ? {} : { key: x })`,
either branch order — is a nullable map too. Spread a `foldMap`
instead (spreading `undefined` adds nothing):

```ts
// wrong
const input = { ...(note === undefined ? {} : { note }) };

// correct
const input = { ...foldMap(maybe(note), (value) => ({ note: value })) };
```

## `fnts` FIRST

`fnts` (github.com/drizzer14/fnts, the user's own library) is the
FIRST thing to reach for, before hand-rolling a `pipe`, a nullable
check, an error boundary, or a throw contract. Readability stays the
criterion for which piece to use, and where composition genuinely
reads worse than plain code — see the carve-outs below — but check
`fnts` before writing the hand-rolled version, not after.

- **`pipe`/`compose`** — for a transform pipeline of two or more
  steps. Don't hand-roll a `pipe` helper; use the library's:

  ```ts
  import { pipe } from 'fnts';

  const toDisplayAmount = pipe(
    (minorUnits: number) => minorUnits / 100,
    (major: number) => major.toFixed(2),
  );
  ```

  No worked example from this codebase is quoted here on purpose. The
  Monobank statement-item mapping used to be it, and its `pipe` was
  deleted when that pipeline's JS-side dedup filter moved into SQL
  (see `kiko-architecture`), which left this rule citing code that no
  longer existed. `grep -rn "from 'fnts'" src` for the live uses
  instead. The rule still governs the next pipeline that needs one.

- **`maybe`** — for a nullable value, in place of a hand-rolled
  `!= null` check or a nullable ternary (see "Banned: the nullable-map
  ternary" below):

  ```ts
  import maybe, { fmap, fold } from 'fnts/maybe';

  const displayName: string | undefined = fold(
    fmap(maybe(account.nickname), (nickname) => nickname.trim()),
  );
  ```

- **`either`/`eitherSync` + `bifoldr`/`bifoldMap`/`bifold`** — for a
  throwable operation's error channel (verified against the installed
  `fnts` 3.0.5). Reach for `bifoldr` or `bifoldMap` first; `bifold`
  itself takes ONE argument and unwraps whichever side the `Either`
  actually holds, with no left/right handler of its own, so it is only
  the right tool once the Left side has already been ruled out by an
  `isLeft` early return (see below) — checking `isLeft`/`isRight`
  around every `bifold` call is not the general pattern.

  `bifoldr(result)` returns the Right value, or `undefined` when the
  `Either` is a Left — the common "value or undefined" shape:

  ```ts
  import either, { bifoldr } from 'fnts/either';

  const result = await either<Error, Rates>(() => fetchRates());
  const rates: Rates | undefined = bifoldr(result);
  ```

  `bifoldMap(result, onLeft, onRight)` folds BOTH sides, each through
  its own handler, in one call — reach for this when the Left and
  Right sides need their own transform, not just a fallback:

  ```ts
  import { bifoldMap } from 'fnts/either';

  const message = bifoldMap(
    result,
    (error) => `failed: ${error.message}`,
    (rates) => `ok: ${rates.usd}`,
  );
  ```

  `isLeft` + an early return, then `bifold` for the remaining Right
  value, is for the one case above: the Left branch itself throws or
  returns early, not merely "give me the Right value or undefined"
  (`bifoldr`'s job) — see `decryptEnvelope`
  (`src/data-transfer/crypto/envelope.ts`):

  ```ts
  import { bifold, isLeft } from 'fnts/either';

  if (isLeft(attempt)) {
    throw new Error('data-transfer/decrypt: wrong key or corrupted file');
  }

  return bifold(attempt);
  ```

- **`guard`** — for a function whose own contract is to throw (an
  HTTP ok-check, for example): replace an `if (!ok) throw` chain with
  a `guard` validator/executor pair directly; do not wrap-and-rethrow
  it through `either` first, that's pure overhead on a function that
  was never meant to return an `Either`.

  ```ts
  import { guard } from 'fnts';

  const readBody = guard(
    [
      (response: Response) => !response.ok,
      (response: Response): never => {
        throw new Error(`request failed: ${response.status}`);
      },
    ],
    (response: Response): Promise<Body> => response.json(),
  );
  ```
- **`curry`/`tap`/`identity`** — reach for these where they read
  better than the hand-rolled equivalent (a `tap` side effect inside a
  pipeline instead of breaking the pipeline to log a value, for
  example); they are not mandatory the way `pipe`/`maybe`/`either`/
  `guard` are above, just worth checking before hand-rolling.

`fnts` also owns network and error-handling code — reach for it
instead of hand-rolled `try`/`catch` plus manual `Error` normalization:

- `either(() => Promise<R>)` captures a **rejection** of the returned
  promise as a `Left` — it calls the thunk OUTSIDE its own promise
  chain (`value().then(right).catch(left)`), so a thunk that can throw
  SYNCHRONOUSLY, before it returns a promise, must itself be `async`
  (`either(async () => …)`); otherwise that throw escapes `either`
  entirely instead of becoming a Left. `eitherSync(() => R)` has no
  such gap — it wraps the call in a real `try`/`catch`, so a plain
  synchronous thunk is fine. The other way round: when the function is
  itself `async`, it already turns its own throw into a rejection, so
  pass it directly (`either(drainReminderResponses)`, not
  `either(async () => drainReminderResponses())` or
  `either(async () => await drainReminderResponses())`). Keep the
  wrapper for a plain function that can throw synchronously
  (`account-form.screen.tsx`'s `ensureAccount`), for a call that passes
  arguments, and for a method call (`either(repo.load)` loses `this`).
  The Semgrep rule `kiko-no-needless-async-either-thunk` enforces this
  when the function is declared `async` in the same file
  (`async function f`, `const f = async ...`, or
  `const f = useCallback(async ...)`). It cannot see whether an
  imported function or a parameter is async, so review those by hand. Unwrap the result with `bifoldr`/
  `bifoldMap` first (see above); reach for `isLeft` + `bifold` only
  once the Left branch itself throws or returns early. Normalize the
  left channel with the **two-argument** `first(result, toError)` —
  the curried `first(toError)(result)` has nothing to infer
  `RightValue` from and silently collapses the right side to
  `unknown`.
- Reach for `guard` (a validator/executor pair) instead when the
  function's own contract is to throw — an HTTP ok-check, for
  example. Replace the `if (!ok) throw` chain with `guard` directly;
  do not wrap-and-rethrow it through `either` first, that's pure
  overhead on a function that was never meant to return an Either.
- `maybe` / `just` / `nothing` / `fold` for nullable results, the same
  way `either` handles throwable ones.
- Fold the Either/Maybe back to the call site's existing external
  contract at its boundary, so callers outside that module don't all
  have to change shape.
- Don't force this where idiomatic code already reads better — a
  React early-return guard (`migrations-gate`) was correctly left as
  plain JSX rather than routed through `maybe`/`fold`. A screen's
  async UI-action handler that must preserve local component state or
  show an `Alert` on failure is the same carve-out — it stays plain
  `try`/`catch` (see `contribution-form.screen.tsx`,
  `account-detail.screen.tsx`); `either`/`guard` is for the data
  layer, not for a handler whose job is UI feedback.
- Inference gotcha: `bifoldr` and `bifoldMap` both infer their result
  type from the full `Either<LeftValue, RightValue>` with no
  annotation needed (verified with `tsc`). `bifold` is the one
  exception — called on a value TypeScript has already narrowed down
  to just `Right<RightValue>` (after an `isLeft` early return, for
  example), there is no `LeftValue` left in the type for `bifold`'s
  generic to infer, and it silently collapses to `unknown`; annotate
  that call site's result type explicitly.

### When to convert a `try`/`catch` to `either`/`eitherSync` + `bifold`

A triage of every `try`/`catch` in the app settled on a short rule,
rather than converting on sight: convert a data-layer "attempt this,
then translate the failure" site — see `decryptEnvelope`
(`src/data-transfer/crypto/envelope.ts`, translate-and-rethrow a
clearer error, not a fall-back), `loadFiatWithFallback`
(`src/rates/rates-refresh/rates-refresh.ts`, falls back to the NBU
source), `parseFormatSafely`/`applyMappingSafely`
(`statement-import.screen.tsx`/`column-mapping.screen.tsx`, a fixed
twin pair, falls back to `undefined`), and `accountEnsured`
(`account-form.screen.tsx`, `isRight(await either(async () => …))` —
a shared "did it succeed" boolean, replacing three identical `try`/`catch`
blocks) for the converted shape. Five categories stay plain
`try`/`catch` on purpose — a site that matches one of these is a
KEEP, not an oversight:

- **Rethrow-after-cleanup.** A `finally` (or an inline reset) that
  must run before the error propagates reads worse once hoisted out
  of `try`/`finally` into a bare post-`await` call — see
  `requestOnce` (`src/monobank/client/monobank.client.ts`, a timeout
  classification tied to a `finally`-cleared abort timer) and
  `account-form.screen.tsx`'s `accountCreate.current` insert
  (`.catch((error) => { <reset the latch>; throw error; })`).
- **Loop control/retry.** A retry loop's own `try`/`catch` decides
  whether to `continue`/retry or give up — see `withRetry`
  (`rates-refresh.ts`) and the Monobank sync's per-card `try`/`catch`
  (`src/monobank/sync/sync.ts`).
- **The async-UI-handler carve-out**, now in two shapes: a handler
  that shows an `Alert` on failure (routed through the shared
  `alertOnCatch` helper below), and a handler that instead returns a
  plain success boolean/status for the caller's own local state — see
  `connectMonobank` (`account-form.screen.tsx`,
  `bank-sync-section.component.tsx`) and
  `binance-credentials-field`/`monobank-connect-field`'s own connect
  handlers (a fixed twin pair, both kept). `account-form.screen.tsx`'s
  sibling `connectWallet`/`connectBinance` no longer have their own
  `try`/`catch` at all — they call the shared `accountEnsured` above
  instead.
- **Decode-or-fall-back-to-original.** A single `decodeURIComponent`
  attempt whose only failure path returns the pre-decode string
  unchanged already reads at its clearest as a two-line try/catch —
  wrapping it in `eitherSync`/`bifoldMap` adds ceremony with no error
  inspection to justify it. See `normalizeFilePathForDelete`
  (`read-statement-file.ts`), `fileNameFrom`
  (`import-data.screen.tsx`), and `toFilePath` (`import-data.ts`).
- **Documented carve-outs already decided** — `db/client.ts` +
  `run-migrations.ts`'s reset-then-rethrow.

### The shared catch-and-Alert helper

`alertOnCatch(t, titleKey, messageKey)`
(`src/design-system/alert-on-catch/`) is the one place every
"translated `Alert`, no dynamic content, no custom buttons" catch
body calls into — `Alert.alert(t(titleKey), t(messageKey))` — instead
of repeating that shape at every write-failure `catch` across the
forms and sync screens. Reach for it first; hand-write `Alert.alert`
directly only when the copy needs a dynamic value the two static keys
can't express (see `src/screens/settings/import-data/import-data.screen.tsx`'s
`runImport`, which folds the caught error into one of two DIFFERENT
message keys before calling `Alert.alert` itself).

## Form validation model

Every Kiko form (`account-form.screen.tsx` and its siblings) follows
one validation model — don't hand-roll a different one:

- The Save is the form's nav-bar item from `useFormHeaderItems`
  (`src/screens/forms/use-form-header-items/`), never a footer button
  (Import on the statement import screen stays a footer button). It is **always enabled**, never a standing
  `disabled={!isValid}` gate. Validate on press instead: the submit
  handler checks its own guard (e.g. `canSave = trimmedName !== ''`)
  and returns early when it fails, only then revealing the error.
  Save disables only while a submit is in flight, or when an edit's
  saved value depends on data still loading: the holding form's edit
  waits for the price book. See `kiko-design-system`'s FieldError
  entry.
- A native bar-button press does not blur the focused field, so a value
  derived on blur (for example the TransactionForm category auto-pick)
  is settled synchronously in the save path, by the same function the
  blur handler calls (see `useCategoryPick` in
  `src/screens/forms/transaction-form/use-category-pick/use-category-pick.ts`).
  Pin it with a test that presses Save without a blur.
- A blocked field shows its message via the shared `FieldError`
  component (`src/design-system/components/field-error/`), not a
  hand-rolled `Box`+`Text` caption — see that component's own doc
  comment for the rationale.
- The shared attempted-submit flag is its own piece of state (`attemptedSave` in the forms under
  `src/screens/forms/`; the connect fields and the import screens keep their own, for example `showTokenRequiredError`
  in `monobank-connect-field.component.tsx`, `attemptedConnect` in
  `binance-credentials-field.component.tsx`, `attemptedImport` in `column-mapping.screen.tsx` and
  `statement-import.screen.tsx`), set true only after a failed submit attempt, so a
  fresh form shows no error before the user has tried to save.
- Every field's error is computed from ONLY that field's own inputs,
  gated by that form's attempted-submit flag — never by comparing
  against a single shared "first failing field" reason. That shape
  hides every error but one until the fields ahead of it are fixed one
  at a time, and un-hides the next one instead of clearing once fixed.
  Every condition that blocks Save must have its own visible field
  error; the first-invalid field (in the form's top-to-bottom order)
  is used ONLY to pick the scroll target, never to decide which
  fields' errors show.

## Import ordering and `import type`

Import grouping and ordering is mechanized by a dedicated check, not
by Biome: `organizeImports` cannot express this project's convention
— it forces a natural within-group sort — so `biome.json`'s
`assist.actions.source.organizeImports.level` stays `"off"`, and
`npm run check:lint` does **not** check import order. Instead,
`scripts/checks/import-order.sh` (+ its `import-order.js` analyzer)
mechanizes the exact rule below: fast-tier per-file on every
`Edit`/`Write`/`MultiEdit`, and project-wide via
`npm run check:import-order` (part of `check:all`). See the
kiko-linter skill's "Import length-sort — a hand-rolled checker (and
fixer)" section for the scanner's design, its "file-header comment"
pinning rule, and the `--write` auto-fix mode used for the repo-wide
sweep.

The convention (handwritten, Prettier-only exemplar:
`~/Developer/Projects/ovpn-ui`):

- Keep 3 import GROUPS in this order, each separated by a blank line:
  (1) external packages and path aliases (`@kiko/...`, the most
  common import after B2), (2) `../**` parent-relative, (3) `./**`
  sibling-relative.
- WITHIN each group, sort by LENGTH ASCENDING. The sort key is the
  length of the statement's ENDING physical line: the whole line for
  a single-line import; the `} from '...';` closing line for a
  wrapped/multiline import (NOT the `import {` first line, NOT the
  flattened statement). Example from ovpn-ui: a wrapped
  `@floating-ui/react` import sorts by its 28-char
  `} from '@floating-ui/react';` closing line, so it lands right
  after `import clsx from 'clsx';` (24 chars).
- Within a group, VALUE imports come before `import type` imports
  only as an equal-length tiebreaker — length dominates.
- A bare side-effect import (e.g.
  `import '@kiko/design-system/unistyles';`) is an ordering BARRIER:
  never move a VALUE import from after it to before it: that runs a
  module before the side effect. Moving an import from before it to
  after it is allowed only for an `import type` (Babel erases it) or a
  module with no module-scope side effect of its own (e.g. a test
  helper that only imports `react-native`); such a move removes a
  module from the pre-barrier set and adds nothing. The `--write`
  fixer never moves any import across a barrier.
- Two adjacent groups of the SAME kind (e.g. two `../**` groups back
  to back, with no other-kind group or side-effect barrier between
  them) is also a violation — they must merge into one group. The
  checker's `--write` mode does this merge itself (see the kiko-linter
  skill's "Import length-sort" section); it only asks a human to merge
  by hand when a comment glued to a non-first import blocks the fixer,
  or when the LATER group carries its own prefix or interior comment.
  The general rule: `--write` re-checks its own output afterward and
  reports ANY violation it could not fix — a blocked merge or a group
  left untouched alike — as "left for hand fix: <file> <reason>",
  exiting non-zero rather than leave the violation unreported.

Use `import type` when the entire import is types:

```ts
import type { AccountRow } from '@kiko/db';
```

Use the inline `type` modifier when mixing types and values in one
import:

```ts
import { type FC, useState } from 'react';
```

One import declaration per module specifier. Never import one module
twice (value+value, type+type, or a `import type` beside a value
import); merge them into one declaration as above. A bare side-effect
import beside a VALUE import of the same module is redundant, because
the value import already runs the module: delete it, and keep the
value import at its position. Two exceptions. A bare side-effect
import beside only `import type` declarations of that module stays
(`import '@kiko/design-system/unistyles';` plus
`import type { AppThemes } from '@kiko/design-system/unistyles';`):
Babel erases `import type`, so the bare import is the only one that
runs the module. A namespace import (`import * as X`) cannot share a
declaration with named imports. The import-order check (`import-order.js`) enforces
this at the fast tier, in `check:import-order`, and in the pre-write
guard. Its `--write` mode never merges a duplicate, so merge it by
hand.

Never import a type without `type` — Biome's `noUnusedImports` plus
the project's `isolatedModules`-style TypeScript config both expect
the type/value distinction to be explicit.

**Whole-repo import re-sort — DONE.** Two separate `kiko:reviewer`
passes had flagged pre-existing length-sort violations under
`src/screens/` that predated this rule being written down (this was
previously a "recommended, not yet done" note). The mechanized
checker's `--write` mode fixed 203 of the 210 violating files in one
pass; the other 7 it declined to touch (a comment glued to a
non-first import — see the kiko-linter skill) were re-sorted by hand.
`npm run check:import-order` now reports zero violations across
`src/`, `__tests__/`, `e2e/`, and `App.tsx`, and (being fast-tier
per-file) catches new drift immediately rather than waiting for a
reviewer to notice it.

## Feature imports (B2)

A FEATURE is one folder with an `index.ts` barrel. A CONTAINER is a
folder whose subfolders are features. Read `CONTAINERS` in
`scripts/checks/feature-imports.js` for the declared set (e.g. `rates`,
`screens/forms`). A plain folder (e.g. `db`, `accounts`) is one feature
with a root barrel.

- Inside one feature: relative paths to files. Never import your own
  barrel (a test of the unit's public API may use `'.'`).
- Across features: `@kiko/<feature path>`, the barrel, never an inner
  file.
  Bad: `import type { FieldInstance } from '../../../design-system/scroll-to-field/scroll-to-field';`
  Good: `import type { FieldInstance } from '@kiko/design-system/scroll-to-field';`
- `../<sibling>` is allowed only between features of one non-screen
  container, from a feature-root file:
  `rates/rates-refresh/rates-refresh.ts` imports `'../conversion'`.
  Screens never use `../` to another screen; use
  `@kiko/screens/forms/date-field`.
- A container has no files of its own, except the ambient `.d.ts`
  files in `AMBIENT_LOOSE` (read the set in `feature-imports.js`). A new
  module there gets its own unit folder and `index.ts`.
- A barrel exports only its own feature. Never export a test, a test
  helper, a fixture, or another feature's module — neither through
  `export … from` nor in two statements (`import { b } from '…';` then
  `export { b };`).
- Shared form logic gets its own unit, apart from its component unit
  (precedent: `src/screens/forms/term-reasons/`,
  `src/screens/forms/property-ownership/`), so a logic module never
  loads component styles.
- A side-effect module has one path and no barrel re-exports it:
  `import '@kiko/design-system/unistyles';`, `import '@kiko/i18n/init';`.
- `jest.mock` names the file that owns the seam, e.g.
  `jest.mock('@kiko/db/client')`. Jest mocks by resolved file, so code
  that imports `@kiko/db` gets the mock. When you change a mock path,
  keep the resolved file the same. Exception: a test inside `src/db/`
  uses `jest.mock('./client')`, because B2 denies
  `alias-into-own-feature`.
- A test-only helper is deep-imported from tests only, and needs a
  `TEST_ONLY` entry with a reason in `feature-imports.js`.

Enforced by `kiko-feature-imports`: the pre-write guard, plus
`check:feature-imports` (per file, then `--tree` for layout and
feature-level value-cycle checks).

## Variable naming

Full, unabbreviated names — never shorten to save keystrokes:

```ts
// correct
const balanceMinorUnits = holding.balanceMinorUnits;

// wrong
const balMinorUnits = holding.balanceMinorUnits;
```

Uppercase abbreviations (`JSON`, `IBAN`, `MCC`, `ID`, `PAN`) keep
their casing wherever they appear in a name:

```ts
const maskedPAN = holding.metadata.maskedPAN; // correct
const maskedPan = holding.metadata.maskedPan; // wrong
```

**Exception — wire-mirror casing.** A type or field that mirrors an
external wire/API payload keeps that payload's own casing on purpose,
even where it disagrees with the acronym rule above. `maskedPan` and
`counterIban` (`src/db/schema.ts`, `src/monobank/monobank-types/monobank.types.d.ts`,
`src/monobank/`) are the standing example: those are the
literal Monobank API JSON field names, not names chosen in application
code, so they stay lower-`an`/lower-`iban` rather than becoming
`maskedPAN`/`counterIBAN`. This is an intentional, allowed exception,
not drift to fix — do not "correct" a wire-mirrored field to match the
acronym rule.

This applies inside a compound name too, not just standalone —
`isBTCEntry` (`src/crypto-sync/binance/binance.provider.ts`), not
`isBtcEntry`, is a live example.

Note: the Drizzle schema's own column names (`externalId`, `mcc`)
follow ordinary camelCase per Drizzle/SQL convention, not this rule
— this rule governs names you choose in application code, not
database column identifiers already fixed by `kiko-domain`.

## Full words in identifiers

Do not shorten words in any identifier — a variable, parameter,
function, type, or prop. Write the full word every time; an
abbreviation saves a few keystrokes and costs the reader a lookup.

Denylist (not exhaustive — the same judgment extends to any other
shortened word):

| Abbreviation | Full word |
|---|---|
| `cond` | `condition` |
| `btn` | `button` |
| `idx` | `index` |
| `acc` | `accumulator` |
| `tx` | `transaction` |
| `err` | `error` |
| `val` | `value` |
| `prev` | `previous` |
| `cfg` | `config` |
| `e` | `event` or `error` |
| `res` | `result` or `response` |
| `msg` | `message` |
| `cb` | `callback` |
| `ctx` | `context` |
| `el` | `element` |
| `opts` | `options` |
| `tmp` | `temporary` |
| `num` | `number` |
| `arr` / `obj` / `str` | a descriptive name for what the array/object/string actually holds |

`tx` spells to `transaction` EXCEPT the one case that means the SQL/Drizzle
write-transaction handle (`write(async (tx) => ...)`'s parameter, and any
helper it is threaded through, e.g. a test's fake-handle factory) — that
one spells to `databaseTransaction` instead, never bare `transaction`:
`transaction` is this codebase's own domain word for a ledger row, and
`transaction.update(transactions)` or a fake-handle factory named
`makeCreateTransaction` both read as though the ledger were mutating
itself. A third-party API method that happens to be named `transaction`
(e.g. op-sqlite's own `rawDatabase.transaction(...)`) is a forced external
name per the exception list below and is never renamed either way — only
ITS callback parameter (the handle) follows this rule.

Explicit exceptions — these stay as they are, no rename:

- `id` — established short form, not an abbreviation of a longer word
  in practice.
- `i18n` — the standard numeronym for "internationalization"; there is
  no full-word form in use anywhere.
- `ISIN` — a financial-domain acronym (International Securities
  Identification Number), the canonical name for the identifier.
- `URL`, `API`, `UI`, and other established acronyms — kept in full
  caps per the "Variable naming" acronym rule above.
- React's `ref` term — the framework's own name for the concept, not
  an abbreviation chosen in this codebase.
- A name forced by a third-party API, a DB column, a persisted JSON
  key, an i18n key, or a testID — renaming any of these changes
  behavior (a wire contract, a schema, or a lookup key), not just
  style, so the abbreviated form stays even if it appears in the
  denylist above.

## Exports: default for components, named for everything else

A React component file uses a default export, keeping the underlying
function/const named so React DevTools still shows a display name
instead of `Anonymous`. Hooks, repositories, utilities, types, the
schema module, and the Monobank sync pipeline all stay **named**
exports — a named export is greppable and re-exportable, and a
default export only earns its keep where the framework (React,
React Navigation) expects one. This mirrors `@ovpn/ui`'s convention.

## No shared constants exported from a screen module

A `*.screen.tsx` must not `export` a runtime constant for another
module to import — a shared constant belongs in a domain or
design-system module. `KIND_ICON` exported from `accounts.screen.tsx`
and imported by `account-detail` was the seam that let it drift from
the domain's own glyph map (see `kiko-domain`'s "Entity glyphs" rule).

## File suffixes

- A React UI component file: `<name>.component.tsx`, its test
  `<name>.component.test.tsx`.
- A screen: `<name>.screen.tsx`.
- A repository: `<name>.repo.ts`.
- A navigation stack component: `<name>.stack.tsx` — the stacks under
  `src/navigation/`, each in its own `<name>-stack/` folder with an
  `index.ts` barrel (`home-stack/home.stack.tsx`,
  `accounts-stack/accounts.stack.tsx`, and their siblings), are
  components, just named for what React Navigation calls them rather
  than generically.
- A gate component: `<name>.gate.tsx` — an early-return guard component
  such as `migrations.gate.tsx` (`src/migration/`, the lock gate).

`.stack.tsx` and `.gate.tsx` are **component-bearing suffixes**,
admitted alongside `.component.tsx` and `.screen.tsx`: a file under
either one default-exports a component the same way (see "Exports"
above). This is a documentation amendment only — existing
`.stack.tsx`/`.gate.tsx` files are correct as they are; nothing needs
renaming.

An **infrastructural** React module that is none of the above — a
provider or context, for example — still does not take
`.component.tsx`; it isn't a UI building block, it's plumbing.
`@ovpn/ui` follows the same split: it names providers/contexts
`*.context.tsx` rather than `*.component.tsx`.

A type-only file — one that exports only types, no runtime value, no
ambient side effect — uses the `.d.ts` extension: `<name>.props.d.ts`,
not `<name>.props.ts`. A props file holding only a props type is the
canonical case. Import it with `import type` so the build erases it.
Exception: a file that also exports a runtime value or runs a side
effect stays `.ts` even if most of its content is types — for example
`src/statistics/holding-value-at/holding-value-at.ts` and
`src/design-system/unistyles/unistyles.ts`.

The repo-wide rename of existing type-only files to `.d.ts` is DONE —
every type-only props file under `src/design-system/components/` and
elsewhere is now `.props.d.ts`, not `.props.ts`. Don't trust that as
a fixed count restated here, though: check the actual suffix on the
file you're touching (`find src -name '*.props.ts'` should return
nothing; a stray hit means either a genuine runtime/side-effect file
exempted above, or new drift to fix).

## One component per file, each in its own folder

Define exactly one React component per file. When a file grows a
second component, move it to its own file.

Each component gets its own folder named after it, holding its
`.component.tsx`, `.props` (or `.props.d.ts`, see above), `.styles`,
and `.component.test.tsx`, plus an `index.ts` barrel that re-exports
the component as the folder's default export:

```
currency-breakdown/
  currency-breakdown.component.tsx
  currency-breakdown.component.test.tsx
  currency-breakdown.props.d.ts
  currency-breakdown.styles.ts
  index.ts
```

A function that returns JSX is a component, even a small "render row"
helper. Do not define such a helper inside another component's body;
extract it to its own file and folder. The extracted component reads
the theme through `useUnistyles()` itself, so it does not need the
parent's closure.

**Exception — a small local, non-reusable component.** A small
component that must be extracted out of its parent's body (for
readability, or so its own re-renders don't fire the parent's) but is
not a reusable module in its own right may stay in the same file as
its parent, as long as it is never `export`ed. The split criterion is
readability and consistency with the existing structure in that file
— line count is irrelevant. This applies to tests too: a mock
component or fixture used by one test goes to that test's co-located
test-helper file, not a new top-level component folder, unless it is
reused across multiple test files. An inline mock component defined
inside a `jest.mock()` factory body is exempt from the one-component-
per-file rule entirely — it lives with the mock it belongs to, not
as a separate file, because the rule governs app code and shared test
helpers, not a mock factory's own body.

A component uses an explicit `return` —
`(props) => { return (<...>); }` — never the arrow-shorthand implicit
return `(props) => (<...>)`.

## Folder-per-thing co-location

A "thing" — a component, a repository, a domain/logic unit — keeps
every file that belongs to it together in **one folder named after
it**. Never scatter a thing's implementation, test, and styles as
loose siblings in a shared flat folder; a folder that is a flat dump
of many unrelated files is hard to read and navigate (user directive).

The transaction-form screen follows this: `transaction-form.screen.tsx` keeps
the state, the hydrate effect, the save handlers and the layout; its helpers,
components and hooks live in unit folders under
`src/screens/forms/transaction-form/`.

Two shapes this takes today:

- A design-system **component** folder (see "One component per file"
  above) — implementation, test, props type, and styles together,
  with a barrel:

  ```
  currency-breakdown/
    currency-breakdown.component.tsx
    currency-breakdown.component.test.tsx
    currency-breakdown.props.d.ts
    currency-breakdown.styles.ts
    index.ts
  ```

- A **logic-unit** folder — a repository or other non-component
  module — pairs its implementation with its own test in that unit's
  feature folder, rather than a separate top-level layer folder (the
  old src/repositories/ split by kind, not by feature, and was
  co-located away):

  ```
  holdings/
    repo/
      index.ts
      holdings.repo.ts
      holdings.repo.test.ts
  ```

  (`holdings` is a container, so the repository is its own `repo/`
  unit with a barrel.)

  Read the feature folder you're touching (`src/holdings/`,
  `src/accounts/`, `src/rates/`, and their siblings) for the live
  pattern rather than trusting a restated file inventory here — it
  would only drift.

Deliberate exceptions that stay flat/loose — these are not violations
of the rule, they simply aren't "a thing" with an owner:

- None for containers: a container has no loose files (see "Feature
  imports (B2)").
- An ambient/global declaration `.d.ts` file (never imported). At a
  container root it needs an `AMBIENT_LOOSE` entry in
  `scripts/checks/feature-imports.js` (read the set there), or `--tree`
  reports it as a loose file. This is distinct from a component's own
  `.props.d.ts`, which lives in the component's folder.
- A cross-cutting shared test helper directory such as
  `src/test-support/` — its files are used by many things, not owned
  by any single one, so they don't belong inside any one thing's
  folder.

To move or rename a file (into a unit folder, for example), use
`git mv`; `git add` a new, untracked file first. Then change it with
Edit/Write, so the pre-write guard checks the change. `git mv` leaves
the content unchanged, and guard-replay follows the rename, so the
file's pre-existing findings keep their baseline. Never use a plain
`mv`/`cp` (the kill-guard denies it into `src/`, `__tests__/`, `rules/`, and
`e2e/`, and a plain move reads as a new file whose every finding
looks new), and never edit the moved file with sed or another Bash
write.

## Helper placement

A non-JSX helper function that closes over **no** local variable
belongs at module scope, not inside a function or component body. A
`byteToHex` used inside a formatter should be a module-level `const`,
not redefined in the body on every call. A helper that returns JSX is
a component instead, in its own file — see "One component per file"
above. A helper that genuinely closes over a local value (a `theme`
binding, say) may stay in the body.

A stored JSON value read as named fields goes through the one shared
`isRecord` (`@kiko/type-guards`), never a local copy. It rejects an
array as well as `null` and primitives, because a field read off an
array finds nothing instead of failing the parse.

## Repository type-safety: `satisfies`, not an annotation

Constrain a repository object with `satisfies Repository`, where
`type Repository = Record<string, (...args: never[]) => unknown>` —
never a `: Repository` type annotation. An annotation widens the
object to the annotation's own type immediately, so every method's
precise inferred parameter and return types are lost to callers;
`satisfies` checks the same shape constraint without touching the
inferred type at all.

## JSX spread: no `{}` fallback

A JSX spread never falls back to an empty object (`{...(x ?? {})}`,
`{...(x || {})}`, `{...(on ? x : {})}` in either branch order), because
TypeScript reads `X | {}` as X with every
prop optional and stops enforcing a discriminated union's
required-together props; fall back to a named literal that sets the
discriminant instead (`NO_SWITCH = { trailing: undefined }` in
`reminder-row.component.tsx`). Mechanized:
`kiko-no-empty-object-jsx-spread` (`rules/semgrep-prewrite.yml`). Not
mechanized: a spread of `X | undefined` with no fallback
(`{...foldMap(...)}`) loses the tie the same way but needs types to
spot, so it stays a review item.

## No Math.min/Math.max over a spread array

`Math.min(...xs)` and `Math.max(...xs)` pass every element as a call
argument, so a large enough array (a long ledger, a 200k-row statement
file, a full-history chart series) throws `RangeError: Maximum call
stack size exceeded`. `Math.max.apply(null, xs)` does the same. Use
`minOf(xs)`/`maxOf(xs)` from `@kiko/numbers`:

```ts
// wrong
const earliest = Math.min(...times);
const nextSortOrder = Math.max(-1, ...rows.map((row) => row.sortOrder)) + 1;

// correct
import { maxOf, minOf } from '@kiko/numbers';

const earliest = minOf(times);
const nextSortOrder = Math.max(-1, maxOf(rows.map((row) => row.sortOrder))) + 1;
```

They are exact drop-ins: an empty array gives `Infinity`/`-Infinity`,
a `NaN` element gives `NaN`, and `-0` sorts below `0`, the same as
`Math.min`/`Math.max`. So keep each call site's own empty guard; the
swap changes nothing else. A fixed argument list (`Math.max(left,
right)`, `Math.min(Math.max(value, 0), 1)`) stays as it is.

Mechanized: `kiko-no-math-min-max-spread` (`rules/semgrep-prewrite.yml`,
ERROR). Test files are out of scope, because a test that pins the
RangeError must spell out the spread.

## Externalize hardcoded config

A hardcoded config value — including a plain public URL, not just a
secret — belongs in `.env`, loaded through `react-native-dotenv`'s
`@env` module with a typed `@env` declaration, not inlined as a
string literal at its call site. `.env` itself is gitignored (never
committed, even though its values are genuinely public, not secret);
`.env.example` (the template) and `.env.test` (Jest's hermetic
default, via `jest.config.js`'s `ENVFILE`) are the tracked, public-only
files, so Jest and CI resolve `@env` with no mock setup required. The
`postinstall` step (`scripts/ensure-env.js`) copies `.env.example` to
a missing `.env`, and appends any key `.env.example` has gained that
an existing `.env` still lacks — an existing value is never
overwritten. A dependency this introduces (for example an
unused-looking `.env` import under knip or depcheck) gets documented
as an ignore entry in the root `CLAUDE.md`, per that file's
"Documented exceptions" convention — not silently suppressed.

## Testing a native/ESM dependency

Jest's React Native preset transforms only `node_modules` packages
matched by `jest.config.js`'s `transformIgnorePatterns` allow-list —
everything else in `node_modules` is assumed pre-transformed CommonJS
and skipped. A new dependency that ships raw TypeScript, a native
Fabric/Nitro binding, or an ESM-only build fails to parse under Jest
until it is added to that allow-list; a dependency with no software
renderer under `react-test-renderer` (an SVG host view, a native
symbol view) additionally needs a manual mock under `__mocks__/` so a
component test can render it at all. `__mocks__/react-native-svg.tsx`
is the template: it renders every primitive the app imports as a
passthrough `View` that preserves `testID` and props, picked up
automatically by Jest with no `jest.mock()` call needed. Read
`jest.config.js`'s current `transformIgnorePatterns` regex before
assuming a package is already covered — a package added to
`package.json` without also being added there will fail its first
test with an unhelpful parse error, not an obviously-related one.

## A jest.requireActual call takes no type argument

Write `jest.requireActual('module') as { ... }`, or bind the result to an annotated const
(`const actual: Shape = jest.requireActual('module')`); never `jest.requireActual<Shape>('module')`,
and the same for `jest.requireMock`, `jest.createMockFromModule` and `jest.genMockFromModule`.
Jest finds the tests to run for a changed file
(`--findRelatedTests`, which Stryker's per-test coverage also uses) by a regex over each file's
text. jest-haste-map's dependency extractor reads only those four names with optional
whitespace, then a string literal. A type argument between the name and the `(` hides the module,
so a change to that module does not select the test. The rule covers every
file that calls it (a test, a `__mocks__` file, a test-support helper): a typed call in a helper cuts
the chain from the test through the helper to the real module too.

Semgrep `kiko-no-typed-jest-require-actual` (`rules/semgrep-prewrite.yml`) denies the typed form at
write time; a comment or a string that spells the typed form is flagged too (a test builds the text at runtime or keeps it under `rules/fixtures/`); its known limits are in kiko-linter's "`kiko-no-typed-jest-require-actual`".

## Tests read a module, never a source file's text

A test never reads a `.ts`/`.tsx` source file's text to derive what it
expects. Stryker rewrites every mutable source in its sandbox, so the
text the test reads is instrumented code, and a parse of it breaks the
dry run (`settings-columns.test.ts` split `schema.ts`'s text;
`title-keys.call-sites.test.ts` read literal call arguments). Import
the module and read its structure instead: drizzle's
`getTableColumns(settings)` for a table's columns, an exported list
for a set of keys.

A data fixture is fine: name it by its own non-TypeScript extension in
the path (`join(__dirname, '__fixtures__/sample.csv')`, or a `const`
bound to that join), or read it from `drizzle/migrations/`.

Semgrep `kiko-no-source-text-read-in-test` (`rules/semgrep-prewrite.yml`)
enforces this in every `*.test.ts(x)` and `src/test-support/**`. It
flags a `readFileSync`/`readFile`/`createReadStream` call whose path it
cannot prove is a non-TypeScript file, so a walked or computed path is
flagged too. Four tests keep one text read each by a documented
per-line override (`// nosemgrep: kiko-no-source-text-read-in-test
OVERRIDE(<reason>)` on the line above that read), never a whole-file
exclude, so a new read in the same file is still denied. Three search
src text for a word or a literal that Stryker's instrumentation keeps
(`settings-columns.test.ts`, `title-keys.call-sites.test.ts`,
`0044-move-crypto-cash-holdings.test.ts`), and
`generate-demo-kiko.test.ts` reads its `.kiko` fixtures by a name from a
table. Harness tests under `__tests__/` are out of scope: they read
rules, scripts, docs, and temp projects.

Known limits:

- A harness test that walks `src/` (`one-component-per-file.test.ts`)
  is not checked.
- A join rooted at `drizzle/migrations` is not extension-checked, so
  `join(MIGRATIONS_ROOT, '..', '..', 'src', 'db', 'schema.ts')` passes.
  Never climb out of the migrations folder in a path.
- A template path (`` `${__dirname}/x.csv` ``) fires even with a
  non-TypeScript extension: the rule reads only a string literal or a
  join. A safe false positive: write `join(__dirname, 'x.csv')`.

## Reviewed, and deliberately not changed

Two review comments were raised and rejected during a past review —
recorded here so they aren't re-proposed:

- The inline `type` modifier on a mixed import
  (`import { View, type ViewProps }`) stays. Biome's `useImportType`
  requires it; dropping it fails `check:lint`.
- The Monobank sync pipeline stays functional. Converting it to a
  class was considered and rejected — see "Style choice" above for
  why a class is reserved for a data type with behavior attached, not
  a transform pipeline.
