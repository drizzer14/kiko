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
- Arrow function parens only when needed (`arrowParentheses:
  "asNeeded"`) — write `x => x + 1`, not `(x) => x + 1`, unless the
  parameter needs a type annotation or destructuring.

Run `npm run check:lint` to verify (see the project harness in the
root `CLAUDE.md`). Never hand-tune something Biome already owns.

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

## Style choice: functional-first, OOP for data models

Default to functional or procedural code. Reach for OOP only when
modeling a **data type with behavior attached to it** — the
canonical example is the `Money` value object (see `pff-domain`):
immutable, with methods like `add`/`subtract`/`convert` that must
enforce invariants (no currency mismatch, no float drift) every time
the value is touched. A class earns its place when the invariant
needs enforcing at every call site, not just at construction.

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

## `fnts` for composition

Use `fnts` (github.com/drizzer14/fnts) to compose functional
transform pipelines — e.g. chaining the Monobank statement-item ->
Transaction mapping steps. Don't hand-roll a `pipe`/`compose` helper;
use the library's.

## Import ordering and `import type`

Two groups, separated by a blank line: external + path-aliased
imports first, then local (relative) imports.

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

Note: the Drizzle schema's own column names (`externalId`, `mcc`)
follow ordinary camelCase per Drizzle/SQL convention, not this rule
— this rule governs names you choose in application code, not
database column identifiers already fixed by `pff-domain`.
