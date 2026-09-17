import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SyncStatus } from '../sync-status-line';
import TokenConnectField from '../token-connect-field';
import { fetchAccounts } from '../../../starling/client';

type StarlingConnectFieldProps = {
  // Runs the connect: store the validated Personal Access Token to the
  // Keychain (keyed by the account id the screen owns) and start the first
  // Starling sync. Resolves whether it succeeded. The field passes the RAW
  // token here and holds it only for the duration of this call — never to
  // the DB or a log.
  onConnect: (token: string) => Promise<boolean>;
};

// The Starling counterpart of PrivatbankConnectField: ONE secure input (a
// Personal Access Token), same single-field shape as PrivatBank's own token,
// plus the "create a PAT" notice, an explicit Connect button, and a live
// status line. It validates the token in
// place with `fetchAccounts` BEFORE handing the RAW token to `onConnect`,
// which stores it and starts the sync — mirrors PrivatbankConnectField's
// validate-then-connect ordering. The field owns no account id and writes no
// Keychain item itself — the token's storage stays in the screen closure
// keyed by the pre-generated account id, so a validated-but-unstorable token
// surfaces as a `false` result here rather than an unhandled rejection.
const StarlingConnectField: FC<StarlingConnectFieldProps> = ({ onConnect }) => {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });

  const handleChangeToken = (value: string): void => {
    setToken(value);
    setStatus({ kind: 'idle' });
  };

  const handleConnect = (): void => {
    const trimmed = token.trim();
    setStatus({ kind: 'checking' });
    (async () => {
      try {
        await fetchAccounts(trimmed);
      } catch {
        setStatus({ kind: 'invalid', message: t('accountDetail.invalidStarlingToken') });

        return;
      }

      const connected = await onConnect(trimmed);
      if (connected) {
        // SECURITY: drop the raw token from state once connected so the
        // bank secret is not parked in the React tree.
        setToken('');
        setStatus({ kind: 'success', message: t('accountDetail.starlingConnected') });

        return;
      }

      // On failure the user keeps the entered token to retry, so it stays in state.
      setStatus({ kind: 'saveError', message: t('accountDetail.couldNotConnectStarling') });
    })();
  };

  return (
    <TokenConnectField
      notice={t('accountDetail.starlingTokenNotice')}
      label={t('accountDetail.tokenLabel')}
      value={token}
      onChangeText={handleChangeToken}
      placeholder={t('accountDetail.starlingTokenPlaceholder')}
      pasteAccessibilityLabel={t('accountDetail.pasteStarlingToken')}
      connectLabel={t('accountDetail.connectStarling')}
      onConnectPress={handleConnect}
      connectDisabled={status.kind === 'checking' || token.trim() === ''}
      status={status}
    />
  );
};

export default StarlingConnectField;
