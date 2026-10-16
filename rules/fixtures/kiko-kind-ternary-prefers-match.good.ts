// Semgrep fixture (NEGATIVE): a union read through `match`, and ternaries that are not a test of
// one `kind` literal, are out of the rule's reach. `kiko-kind-ternary-prefers-match` must draw
// ZERO findings from this file.
import { match } from 'ts-pattern';

type Step = { kind: 'idle' } | { kind: 'running'; pct: number } | { kind: 'done' };

declare const step: Step;
declare const flag: boolean;
declare const other: { kind: string };

export const label = match(step)
  .with({ kind: 'idle' }, () => 'Idle')
  .with({ kind: 'running' }, () => 'Running')
  .with({ kind: 'done' }, () => 'Done')
  .exhaustive();

// A plain condition, a different property, and a comparison of two values are no literal test.
export const plain = flag ? 'a' : 'b';

export const otherProperty = other.kind.length === 3 ? 'a' : 'b';

export const twoKinds = step.kind === other.kind ? 'same' : 'different';

// An inequality is a different shape from the equality the rule names.
export const notEqual = step.kind !== 'idle' ? 'busy' : 'idle';

// A kind read in a statement `if`, not a ternary.
export const viaIf = (): string => {
  if (step.kind === 'done') {
    return 'done';
  }

  return 'not done';
};
