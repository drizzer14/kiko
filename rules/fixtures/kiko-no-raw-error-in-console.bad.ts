// Semgrep fixture (POSITIVE): kiko-no-raw-error-in-console MUST report a
// finding on every pinned line below. Never "fix" this file — see
// kiko-compliance's "5.1.5 / data storage".
export const runTask = async (task: () => Promise<void>): Promise<void> => {
  try {
    await task();
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a failed background task has no UI surface; log it so a device log shows what failed
    // EXPECT-FINDING
    console.warn('[probe] task failed', error);
  }
};

export const reportRejection = (step: string, reason: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a rejected step has no UI surface; log it so a device log shows which step failed
  // EXPECT-FINDING
  console.error(`[probe] ${step} rejected`, String(reason));
};

export const reportConcatenated = (reason: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a rejected step has no UI surface; log it so a device log shows which step failed
  // EXPECT-FINDING
  console.warn('[probe] failed: ' + reason);
};
