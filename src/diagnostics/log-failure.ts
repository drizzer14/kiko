type FailureCode = string | number | undefined;

const codeOf = (error: unknown): FailureCode => {
  if (typeof error !== 'object' || error === null || !Object.hasOwn(error, 'code')) {
    return undefined;
  }

  const { code } = error as { code: unknown };

  return typeof code === 'string' || typeof code === 'number' ? code : undefined;
};

// An error's message, cause, and own fields can carry user data (a
// DrizzleQueryError's message holds the SQL params), and React Native logs
// every console level to os_log in a Release build. So a swallowed failure
// logs only what identifies its kind.
export const logFailure = (tag: string, error: unknown): void => {
  const name = error instanceof Error ? error.name : typeof error;

  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) the one console sink for a swallowed failure; it logs only the error's name and code, never its message, cause, or params
  console.warn(tag, { name, code: codeOf(error) });
};
