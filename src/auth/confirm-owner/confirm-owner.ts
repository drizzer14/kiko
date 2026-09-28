import { match } from 'ts-pattern';

import { authenticate } from '../biometrics';

type OwnerConfirmation =
  | { kind: 'confirmed' }
  // No owner authentication exists on this device — iOS itself asks for the
  // old passcode before it removes one, so there is nothing left to confirm
  // here. A caller that treats this as a refusal (see export-data) must say
  // so explicitly; this type does not fold it into `confirmed`.
  | { kind: 'noPasscode' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; hintKey: 'auth.hint.failed' | 'auth.hint.lockout' };

/**
 * Re-confirms the device owner before a sensitive action (turning the app
 * lock off, exporting saved credentials). Wraps `authenticate` and folds its
 * five `AuthResult` kinds down to what a caller actually needs to branch on.
 */
export const confirmOwner = async (reason: string): Promise<OwnerConfirmation> => {
  const result = await authenticate(reason);

  return match(result)
    .with({ kind: 'success' }, (): OwnerConfirmation => ({ kind: 'confirmed' }))
    .with({ kind: 'passcodeNotSet' }, (): OwnerConfirmation => ({ kind: 'noPasscode' }))
    .with({ kind: 'cancelled' }, (): OwnerConfirmation => ({ kind: 'cancelled' }))
    .with(
      { kind: 'lockout' },
      (): OwnerConfirmation => ({ kind: 'failed', hintKey: 'auth.hint.lockout' }),
    )
    .with(
      { kind: 'failed' },
      (): OwnerConfirmation => ({ kind: 'failed', hintKey: 'auth.hint.failed' }),
    )
    .exhaustive();
};
