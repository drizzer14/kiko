import either, { bifoldMap } from 'fnts/either';

import { logFailure } from './log-failure';

// Runs a step whose failure is logged and swallowed, and says whether it
// succeeded so a caller that must report the failure can. The thunk is
// `async` so a task that throws before it returns a promise is caught too.
export const logOnFailure = async (tag: string, task: () => Promise<unknown>): Promise<boolean> => {
  const attempt = await either<unknown, unknown>(async () => task());

  return bifoldMap(
    attempt,
    (error): boolean => {
      logFailure(tag, error);

      return false;
    },
    (): boolean => true,
  );
};
