import { match } from 'ts-pattern';

// Semgrep fixture (NEGATIVE): the same closed-set mapping as
// `kiko-no-switch.bad.ts`, written with `ts-pattern`'s `match(...).exhaustive()`
// instead of a banned `switch`. A comment merely NAMING the word "switch" (like
// this one) must not match `kiko-no-switch` — the rule matches the keyword
// followed by an opening paren, not the word in prose.
type Frequency = 'monthly' | 'quarterly' | 'annually';

export const periodsPerYear = (frequency: Frequency): number =>
  match(frequency)
    .with('monthly', () => 12)
    .with('quarterly', () => 4)
    .with('annually', () => 1)
    .exhaustive();
