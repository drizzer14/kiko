// Semgrep fixture (NEGATIVE, NESTED): mirrors sync-example.bad.ts's own
// path (kiko-linter's "Semgrep facts" — see that fixture's own header). Every
// throw here resolves its message through `i18n.t(...)` (silent for this
// rule) or forwards an already-built value that is neither a string nor a
// template literal.
import { i18n } from '@kiko/i18n/init';

export const readClientStatus = (status: number): number => {
  if (status !== 200) {
    throw new Error(i18n.t('accountDetail.monobankRequestFailed', { status }));
  }

  return status;
};

export const rethrowWithOriginalMessage = (error: Error): never => {
  throw new Error(error.message);
};
