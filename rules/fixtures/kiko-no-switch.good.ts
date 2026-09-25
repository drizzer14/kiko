import { match } from 'ts-pattern';

// Semgrep fixture (NEGATIVE): the same closed-set mapping as
// `kiko-no-switch.bad.ts`, written with `ts-pattern`'s `match(...).exhaustive()`
// instead of a banned `switch`. `kiko-no-switch` matches the AST shape
// `switch ($X) { ... }`, so none of the four shapes below — none of them a
// `switch` STATEMENT — draw a finding.
type Frequency = 'monthly' | 'quarterly' | 'annually';

export const periodsPerYear = (frequency: Frequency): number =>
  match(frequency)
    .with('monthly', () => 12)
    .with('quarterly', () => 4)
    .with('annually', () => 1)
    .exhaustive();

// 1. A comment merely naming the word, immediately followed by a paren:
// switch(frequency) — still just prose, not a statement.

// 2. A string literal containing the same text.
const exampleSnippet = 'switch (frequency) { ... }';

// 3. A template literal containing the same text.
const exampleTemplate = `switch (${exampleSnippet}) { ... }`;

// 4. A `.switch(...)` method call (an RxJS-observable-style chain, not a
// `switch` statement).
const stream = { switch: (mapper: (value: number) => number) => mapper(1) };
const mapped = stream.switch((value) => value + 1);
