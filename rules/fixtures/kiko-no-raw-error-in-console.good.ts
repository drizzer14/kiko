// Semgrep fixture (NEGATIVE): kiko-no-raw-error-in-console must report
// nothing here. A failure goes through logFailure, and console.* gets only
// literals: a string or template tag and an object literal of counts.
import { logFailure } from '@kiko/diagnostics';

export const runTask = async (task: () => Promise<void>): Promise<void> => {
  try {
    await task();
  } catch (error) {
    logFailure('[probe] task failed', error);
  }
};

export const reportCounts = (fetched: number, skipped: number): void => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a sync summary of counts only, so a device log shows how much each run fetched
  console.warn('[probe] done', { fetched, skipped });
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a count only, so a device log shows how much each run fetched
  console.warn(`[probe] ${fetched} fetched`);
};
