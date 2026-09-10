/**
 * Test helper: a fake `write`-transaction handle that captures the payload of
 * a single `update(...).set(...).where(...)` chain. Repo methods that issue one
 * such update (e.g. `setIcon`, `updateName`) run against this so a test can
 * assert both the `set` values and that a `where` clause was applied — without
 * a native database. Shared by the account and holding repo tests, whose
 * capture setup is otherwise identical.
 */
type SetCapture = {
  set?: Record<string, unknown>;
  whereCalled: boolean;
};

export const captureSetTx = (): { captured: SetCapture; tx: unknown } => {
  const captured: SetCapture = { whereCalled: false };
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        captured.set = values;
        return {
          where: () => {
            captured.whereCalled = true;
            return Promise.resolve();
          },
        };
      },
    }),
  };
  return { captured, tx };
};
