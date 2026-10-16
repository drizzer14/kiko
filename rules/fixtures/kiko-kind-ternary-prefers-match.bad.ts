// Semgrep fixture (POSITIVE): kiko-code-style's "`ts-pattern` for exhaustive mapping" reads a
// discriminated union through `match`, so a new variant is a type error rather than a silent
// fall-through to the else branch. `kiko-kind-ternary-prefers-match` MUST report a finding on each
// pinned line below: a ternary on one `kind` literal.
type Step = { kind: 'idle' } | { kind: 'running'; pct: number } | { kind: 'done' };

declare const step: Step;
declare const holder: { step: Step };

// EXPECT-FINDING
export const label = step.kind === 'running' ? 'Running' : 'Other';

// EXPECT-FINDING
export const nested = holder.step.kind === 'done' ? 1 : 0;

// EXPECT-FINDING
export const asReturn = (): string => (step.kind === 'idle' ? 'Idle' : 'Busy');

// EXPECT-FINDING
export const asArgument = String(step.kind === 'done' ? 'yes' : 'no');

export const multiLine =
  // EXPECT-FINDING
  step.kind === 'running' ? { running: true, pct: step.pct } : { running: false, pct: 0 };
