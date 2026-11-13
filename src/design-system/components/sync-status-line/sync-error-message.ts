import { match, P } from 'ts-pattern';

import type { SyncStatus } from './sync-status-line.props';

// The text of a failed Connect/Save for the field's `ErrorNotice`: the row beside Connect keeps
// only `checking` and `success`, and a long error squeezed beside the button read as nothing.
export const syncErrorMessage = (status: SyncStatus): string | undefined =>
  match(status)
    .with({ kind: P.union('invalid', 'saveError') }, ({ message }) => message)
    .with({ kind: P.union('idle', 'checking', 'success') }, () => undefined)
    .exhaustive();
