import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import { writeExecutable } from './mutation-repository';

export const HIGH_LOAD = '{ 1.50 12.25 3.00 }';
export const LOW_LOAD = '{ 1.50 4.25 3.00 }';

// The stub answers `highCalls` times with `high`, then with `low` forever, and counts every call
// in its own file, so a test drives a load that drops without a clock. It fails any invocation
// but `-n vm.loadavg`, so a script that asked sysctl for something else cannot pass by accident.
export const writeSysctlStub = (
  directory: string,
  high: string,
  low: string,
  highCalls: number,
): void => {
  writeExecutable(
    join(directory, 'sysctl'),
    [
      '#!/usr/bin/env bash',
      '[ "$*" = "-n vm.loadavg" ] || exit 1',
      `calls="${join(directory, 'sysctl-calls')}"`,
      'count="$(cat "$calls" 2>/dev/null || echo 0)"',
      'printf %s "$((count + 1))" > "$calls"',
      `if [ "$count" -lt ${highCalls} ]; then printf '%s\\n' '${high}'; else printf '%s\\n' '${low}'; fi`,
      '',
    ].join('\n'),
  );
};

export const sysctlCallCount = (directory: string): number => {
  try {
    return Number(readFileSync(join(directory, 'sysctl-calls'), 'utf8'));
  } catch {
    return 0;
  }
};
