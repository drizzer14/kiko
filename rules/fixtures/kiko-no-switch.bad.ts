// Semgrep fixture (POSITIVE): a `switch` statement over a closed-set literal
// is banned in this codebase, with no exception — kiko-code-style's
// ts-pattern section. `kiko-no-switch` MUST report a finding on the pinned
// line below. Never "fix" this file to use `match(...).exhaustive()" — that
// belongs in the `.good.ts` fixture instead.
type Frequency = 'monthly' | 'quarterly' | 'annually';

export const periodsPerYear = (frequency: Frequency): number => {
  // EXPECT-FINDING
  switch (frequency) {
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
    case 'annually':
      return 1;
  }
};
