---
name: pff-code-style
description: Invoke when writing any .ts or .tsx file in PFF — before writing new code, when reviewing existing code for style issues, or when unsure how to structure imports, types, currency mapping, or composition. Covers conventions not derivable from biome.json alone, and when to use OOP vs functional vs procedural style.
---

# Code style for PFF

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

### Blank lines before statement blocks — apply by hand

Biome does **not** enforce this, it recurs in review, and it is a
**hard rule**: put a blank line before every `return`, and before
every `if`, `for`, `while`, and `switch` statement. It visually
separates that block from whatever led up to it, the same way a
blank line already separates import groups.

Exception: a statement that is the first line of its block (directly
after `{`) needs no blank line before it — there is nothing above it
to separate from.

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

### `.concat` over a multi-part template literal

When building a string from many parts with no separators between
them — assembling an `#RRGGBBAA` hex string from four byte-hex parts,
for example — prefer `String.prototype.concat` over a template
literal with many interpolations; it reads better than a long run of
`${...}${...}${...}${...}`. A simple one- or two-part interpolation
with separators (`` `${base}:${quote}` ``) stays a template literal.

## Linting rules that shape how you write code

From `biome.json`'s `linter.rules`:

- `noExplicitAny` is an error — there is no untyped escape hatch.
  Model the type properly; if a third-party boundary is genuinely
  untyped, that needs a justified `OVERRIDE(...)` comment (see the
  root `CLAUDE.md` "Override protocol"), not a stray `any`.
  `unknown` + narrowing is the fallback, not `any`.
- `noUnusedVariables` / `noUnusedImports` are errors — no unused
  bindings, ever, not even during a work-in-progress edit.
- `noExcessiveCognitiveComplexity` caps at 15 — decompose a
  complicated branch into named helper functions rather than one
  large function; this pairs naturally with the functional style
  below.
- `complexity.noVoid` is an error — never use the `void` operator. To
  fire-and-forget a promise that already captures its own errors (an
  `either(...)` call), call it as a plain expression statement; do
  not prefix it with `void`.

## Style choice: functional-first, OOP for data models

Default to functional or procedural code. Reach for OOP only when
modeling a **data type with behavior attached to it** — the
canonical example is the `Money` value object (see `pff-domain`):
immutable, with methods like `add`/`subtract`/`convert` that must
enforce invariants (no currency mismatch, no float drift) every time
the value is touched. A class earns its place when the invariant
needs enforcing at every call site, not just at construction.

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
  classes (see `pff-architecture`).
- The Monobank sync pipeline is a functional pipeline of transform
  steps, not a class hierarchy.
- Use procedural code (a straight-line function, a loop) where it is
  simply clearer than a functional-composition chain — don't force a
  `pipe` for its own sake on a two-step transform.

## `ts-pattern` for exhaustive mapping

Any place that maps over a closed set of literals — currency codes,
account/holding `kind`/`type`, Monobank statement kinds, ISO 4217
numeric codes — uses `ts-pattern`'s `match(...).exhaustive()` rather
than a `switch` or an `if`/`else` chain. Exhaustiveness checking means
adding a new currency or a new holding type is a compile error at
every mapping site that hasn't been updated, not a silent runtime gap.

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

## `fnts` for composition

Use `fnts` (github.com/drizzer14/fnts) to compose functional
transform pipelines — e.g. chaining the Monobank statement-item ->
Transaction mapping steps. Don't hand-roll a `pipe`/`compose` helper;
use the library's.

`fnts` also owns network and error-handling code — reach for it
instead of hand-rolled `try`/`catch` plus manual `Error` normalization:

- `either(() => Promise<R>)` / `eitherSync(() => R)` capture a thrown
  error as a `Left`; route the result with `isLeft` / `isRight` /
  `bifold`. Normalize the left channel with the **two-argument**
  `first(result, toError)` — the curried `first(toError)(result)` has
  nothing to infer `RightValue` from and silently collapses the right
  side to `unknown`.
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
- Inference gotcha: annotate a `bifold` result's type explicitly
  wherever a narrowed `Right` value leaves nothing for TypeScript to
  infer `LeftValue` from.

## Import ordering and `import type`

Two groups, separated by a blank line: external + path-aliased
imports first, then local (relative) imports.

Within each group, sort import statements by line length, shortest
first (this matches `@ovpn/ui`). For a component file's local group,
this puts the `.styles` import before the `.props` import, because
the styles line is shorter:

```ts
import { Text, View } from 'react-native';
import { Children, isValidElement, type ReactElement } from 'react';
```

Biome's import-organizing assist (`organizeImports`) is deliberately
**disabled** in `biome.json` so this length-first order can hold —
Biome's own `organizeImports` sorts by module path instead, and would
fight this rule if it ran. Because it is disabled, no check enforces
any of this: the two-group split and the shortest-first order within
each group are both a manual convention. Apply it by hand when you
write imports, and check it in review.

Use `import type` when the entire import is types:

```ts
import type { Account } from '../domain/account';
```

Use the inline `type` modifier when mixing types and values in one
import:

```ts
import { type FC, useState } from 'react';
```

Never import a type without `type` — Biome's `noUnusedImports` plus
the project's `isolatedModules`-style TypeScript config both expect
the type/value distinction to be explicit.

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

This applies inside a compound name too, not just standalone —
`fetchBtcPrice` was renamed to `fetchBTCPrice` during review (and its
callers, `loadBTC` and `RefreshDeps.fetchBTCPrice`, followed the same
rule).

Note: the Drizzle schema's own column names (`externalId`, `mcc`)
follow ordinary camelCase per Drizzle/SQL convention, not this rule
— this rule governs names you choose in application code, not
database column identifiers already fixed by `pff-domain`.

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
the domain's own glyph map (see `pff-domain`'s "Entity glyphs" rule).

## File suffixes

- A React UI component file: `<name>.component.tsx`, its test
  `<name>.component.test.tsx`.
- A screen: `<name>.screen.tsx`.
- A repository: `<name>.repo.ts`.

An **infrastructural** React module does not take `.component.tsx` —
it isn't a UI building block, it's plumbing. A migrations gate or a
navigator stays unsuffixed. `@ovpn/ui` follows the same split: it
names providers/contexts `*.context.tsx` rather than
`*.component.tsx`.

A type-only file — one that exports only types, no runtime value —
uses the `.d.ts` extension: `<name>.props.d.ts`, not `<name>.props.ts`.
A props file holding only a props type is the canonical case. Import
it with `import type` so the build erases it.

## One component per file, each in its own folder

Define exactly one React component per file. When a file grows a
second component, move it to its own file.

Each component gets its own folder named after it, holding the
component and its siblings:

```
currency-breakdown/
  currency-breakdown.component.tsx
  currency-breakdown.props.d.ts
  currency-breakdown.styles.ts
```

A function that returns JSX is a component, even a small "render row"
helper. Do not define such a helper inside another component's body;
extract it to its own file and folder. The extracted component reads
the theme through `useUnistyles()` itself, so it does not need the
parent's closure.

A component uses an explicit `return` —
`(props) => { return (<...>); }` — never the arrow-shorthand implicit
return `(props) => (<...>)`.

## Helper placement

A non-JSX helper function that closes over **no** local variable
belongs at module scope, not inside a function or component body. A
`byteToHex` used inside a formatter should be a module-level `const`,
not redefined in the body on every call. A helper that returns JSX is
a component instead, in its own file — see "One component per file"
above. A helper that genuinely closes over a local value (a `theme`
binding, say) may stay in the body.

## Repository type-safety: `satisfies`, not an annotation

Constrain a repository object with `satisfies Repository`, where
`type Repository = Record<string, (...args: never[]) => unknown>` —
never a `: Repository` type annotation. An annotation widens the
object to the annotation's own type immediately, so every method's
precise inferred parameter and return types are lost to callers;
`satisfies` checks the same shape constraint without touching the
inferred type at all.

## Externalize hardcoded config

A hardcoded config value — including a plain public URL, not just a
secret — belongs in `.env`, loaded through `react-native-dotenv`'s
`@env` module with a typed `@env` declaration, not inlined as a
string literal at its call site. Commit `.env` itself when its values
are genuinely public (not secret): that way Jest and CI resolve
`@env` with no mock setup required. Gitignore only `.env.local` for
anything that must stay private. A dependency this introduces (for
example an unused-looking `.env` import under knip or depcheck) gets
documented as an ignore entry in the root `CLAUDE.md`, per that file's
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
