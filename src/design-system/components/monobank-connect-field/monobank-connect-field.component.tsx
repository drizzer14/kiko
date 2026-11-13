import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type FC, useEffect, useState } from 'react';
import { fetchClientInfo } from '@kiko/monobank/client';
import { isMonobankSyncRunning } from '@kiko/monobank/sync';
import { useIsMounted } from '@kiko/design-system/use-is-mounted';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';

import Box from '../box';
import Button from '../button';
import InfoHint from '../info-hint';
import ErrorNotice from '../error-notice';
import MonobankTokenInput from '../monobank-token-input';
import SyncStatusLine, { type SyncStatus, syncErrorMessage } from '../sync-status-line';

import { styles } from './monobank-connect-field.styles';

type MonobankConnectFieldProps = {
  // The account the screen's `onConnect` syncs; the field reads it only to stop a Connect while a
  // sync of that account is still running.
  accountId: string;
  // Runs the connect: store the validated token to the Keychain (keyed by the
  // account id the screen owns) and start the first Monobank sync. Resolves
  // whether it succeeded. The field passes the RAW token here and holds it only
  // for the duration of this call — never to the DB or a log.
  onConnect: (token: string) => Promise<boolean>;
  // Lets a form that saves without this connection remind the user to press Connect first.
  reminder?: ConnectReminder;
};

// The bank-create counterpart of WalletAddressField: the shared MonobankTokenInput
// (link + secure token field + paste icon) plus an explicit Connect button and a
// live status line. It validates the token in place with fetchClientInfo (so it
// can show "Connected as {name}") and then hands the RAW token to `onConnect`,
// which stores it and starts the sync. The field takes the account id only to check for a
// running sync and writes no Keychain item itself — the secret's storage stays in the screen
// closure keyed by the account id (the create form's pre-generated id, or the existing account's
// id on the detail screen), so a validated-but-unstorable token surfaces
// as a `false` result here rather than an unhandled rejection.
const MonobankConnectField: FC<MonobankConnectFieldProps> = ({
  accountId,
  onConnect,
  reminder,
}) => {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });
  // Shown only after a Connect press finds a blank token — Connect is always
  // enabled now (kiko-code-style's form validation model), so this surfaces
  // the token-required reason on press rather than a standing disabled state.
  const [showTokenRequiredError, setShowTokenRequiredError] = useState(false);
  const onDraftChange = reminder?.onDraftChange;
  const isMounted = useIsMounted();
  const errorMessage = syncErrorMessage(status);

  // The typed token goes with the field, so a draft it reported must not outlive it.
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

  const handleChangeToken = (value: string): void => {
    setToken(value);
    setStatus({ kind: 'idle' });
    setShowTokenRequiredError(false);
    onDraftChange?.(value.trim() !== '');
  };

  const handleConnect = (): void => {
    reminder?.onConnectPress();

    const trimmed = token.trim();

    if (trimmed === '') {
      setShowTokenRequiredError(true);

      return;
    }

    // A run of this account outlives a Disconnect, and the sync's join would hand this Connect that
    // run: it would report a connection whose token the run never read.
    if (isMonobankSyncRunning(accountId)) {
      setStatus({ kind: 'saveError', message: t('accountDetail.monobankSyncStillRunning') });

      return;
    }

    setStatus({ kind: 'checking' });
    // The token check catches into a status, and every onConnect caller catches its own save and
    // sync.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    (async () => {
      let clientName: string;
      try {
        const clientInfo = await fetchClientInfo(trimmed);
        clientName = clientInfo.name;
      } catch {
        setStatus({ kind: 'invalid', message: t('accountDetail.invalidToken') });

        return;
      }

      // A fold or a kind or bank switch removed the field during the check. Connecting now would
      // insert the account row after the form that replaced this one already decided what to
      // write, so the checked token is dropped and the user presses Connect again.
      if (!isMounted()) {
        return;
      }

      const connected = await onConnect(trimmed);

      if (connected) {
        // SECURITY: drop the raw token from state once connected so the bank
        // secret is not parked in the React tree.
        setToken('');
        onDraftChange?.(false);
        setStatus({
          kind: 'success',
          message: t('accountDetail.connectedAs', { name: clientName }),
        });

        return;
      }

      // On failure the user keeps the entered token to retry, so it stays in state.
      setStatus({ kind: 'saveError', message: t('accountDetail.couldNotConnectMonobank') });
    })();
  };

  return (
    <Box gap={3}>
      <MonobankTokenInput
        value={token}
        onChangeText={handleChangeToken}
        error={showTokenRequiredError ? t('accountDetail.tokenRequiredError') : undefined}
      />

      <View ref={reminder?.ref}>
        <Box gap={2}>
          <Box direction="row" gap={2} style={styles.statusLine}>
            <Button
              variant="secondaryTonal"
              size="small"
              fullWidth={false}
              onPress={handleConnect}
              disabled={status.kind === 'checking'}
              icon="lock"
            >
              {t('accountDetail.connectMonobank')}
            </Button>

            <SyncStatusLine status={status} />
          </Box>

          {errorMessage !== undefined && <ErrorNotice message={errorMessage} />}

          {reminder?.message !== undefined && <InfoHint message={reminder.message} />}
        </Box>
      </View>
    </Box>
  );
};

export default MonobankConnectField;
