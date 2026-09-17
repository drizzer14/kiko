import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SyncStatus } from '../sync-status-line';
import TokenConnectField from '../token-connect-field';

type BunqConnectFieldProps = {
  // Runs the connect: store the entered API key to the Keychain (keyed by
  // the account id the screen owns) and start the first bunq sync (which
  // itself runs the handshake and validates the key). Resolves whether it
  // succeeded. The field passes the RAW key here and holds it only for the
  // duration of this call — never to the DB or a log.
  onConnect: (apiKey: string) => Promise<boolean>;
};

// The bunq counterpart of PrivatbankConnectField: ONE secure input (an API
// key), same single-field shape as PrivatBank's own token, plus the "create
// the API key" notice, an explicit Connect button, and a live status line.
// UNLIKE Monobank/PrivatBank, this field does NOT
// pre-validate the key with a side-effect-free call before handing it to
// `onConnect`: bunq has no such call — every real request needs an actual
// session (the handshake itself), and re-running it twice in a row would
// burn `/session-server`'s own strict rate limit (~1 req/30s) for nothing.
// So Connect hands the raw key straight to `onConnect`, which stores it and
// runs the first sync; that sync's own success/failure IS the validation,
// surfaced through the SAME status line. The field owns no account id and
// writes no Keychain item itself — the key's storage stays in the screen
// closure keyed by the pre-generated account id, so a validated-but-
// unstorable key surfaces as a `false` result here rather than an
// unhandled rejection.
const BunqConnectField: FC<BunqConnectFieldProps> = ({ onConnect }) => {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });

  const handleChangeApiKey = (value: string): void => {
    setApiKey(value);
    setStatus({ kind: 'idle' });
  };

  const handleConnect = (): void => {
    const trimmed = apiKey.trim();
    setStatus({ kind: 'checking' });
    (async () => {
      const connected = await onConnect(trimmed);

      if (connected) {
        // SECURITY: drop the raw key from state once connected so the bank
        // secret is not parked in the React tree.
        setApiKey('');
        setStatus({ kind: 'success', message: t('accountDetail.bunqConnected') });

        return;
      }

      // On failure the user keeps the entered key to retry, so it stays in state.
      setStatus({ kind: 'saveError', message: t('accountDetail.couldNotConnectBunq') });
    })();
  };

  return (
    <TokenConnectField
      notice={t('accountDetail.bunqApiKeyNotice')}
      label={t('accountDetail.apiKeyLabel')}
      value={apiKey}
      onChangeText={handleChangeApiKey}
      placeholder={t('accountDetail.bunqApiKeyPlaceholder')}
      pasteAccessibilityLabel={t('accountDetail.pasteBunqApiKey')}
      connectLabel={t('accountDetail.connectBunq')}
      onConnectPress={handleConnect}
      connectDisabled={status.kind === 'checking' || apiKey.trim() === ''}
      status={status}
    />
  );
};

export default BunqConnectField;
