import {
  bybitKeyRefusalOf,
  isBybitCoolingDown,
  saveBybitCredentials,
} from '@kiko/crypto-sync/bybit';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BYBIT_API_MANAGEMENT_URL } from '@env';
import { isBybitSyncRunning } from '@kiko/crypto-sync/run-crypto-sync';
import type { WriteToken } from '@kiko/crypto-sync/exchange/credentials';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';

import Box from '../box';
import Text from '../text';
import ErrorNotice from '../error-notice';
import ExpandToggle from '../expand-toggle';
import ExchangeKeyForm from '../exchange-key-form';

type BybitCredentialsFieldProps = {
  // The account this field's credentials belong to. The pair is a PER-ACCOUNT Keychain item, so
  // the Save write is keyed by this id — a second Bybit account stores and reads its own pair.
  accountId: string;
  /**
   * Runs the Bybit Connect sync once the pair is verified and stored; resolves whether it
   * succeeded. Receives the token of the write that stored the pair, so a caller that gives up can
   * clear that write's pair and no other; the pair itself stays in this field.
   */
  onConnect: (stored: WriteToken) => Promise<boolean>;
  // Lets a form that saves without this connection remind the user to press Connect first.
  reminder?: ConnectReminder;
  /**
   * Runs instead of `onConnect` when the field unmounted during the Keychain write that stored the
   * verified pair, so the screen that owns the account decides what happens to the pair; it must
   * not reject. It receives the token of that write, which clears that write's pair and no other.
   * Without it the pair stays where it was stored.
   */
  onStoredWhileUnmounted?: (stored: WriteToken) => Promise<void>;
  /**
   * Whether the account keeps a holding of a Bybit account: Connect then refuses a key of another
   * Bybit account. A create form reads the holdings its first Connect wrote and passes this too.
   */
  keepsBybitHoldings?: boolean;
  /**
   * The text of a failed Connect, shown under the form: the form's own status only says that the
   * connection failed, and a refusal (a key Bybit ended, a cooldown) has a text of its own. A
   * screen with an error line of its own leaves this off.
   */
  connectError?: string;
};

// The Bybit counterpart of the Binance field, over the shared `ExchangeKeyForm`. Connect refuses a
// key that cannot read what Kiko reads BEFORE the pair is written to the biometric Keychain (a key
// that can do more than read, one that is no main key, one a shipped route refuses), then runs the
// first sync. The pair never leaves the form except into `bybitKeyRefusalOf` (the check) and
// `saveBybitCredentials`; the callbacks get only the token of that write.
const BybitCredentialsField: FC<BybitCredentialsFieldProps> = ({
  accountId,
  onConnect,
  reminder,
  onStoredWhileUnmounted,
  keepsBybitHoldings = false,
  connectError,
}) => {
  const { t } = useTranslation();
  const [introExpanded, setIntroExpanded] = useState(false);

  return (
    <Box gap={3}>
      <ExchangeKeyForm
        accountId={accountId}
        onConnect={onConnect}
        reminder={reminder}
        onStoredWhileUnmounted={onStoredWhileUnmounted}
        managementUrl={BYBIT_API_MANAGEMENT_URL}
        copy={{
          openLink: t('accountDetail.openBybitLink'),
          apiKeyPlaceholder: t('accountDetail.bybitApiKeyPlaceholder'),
          apiSecretPlaceholder: t('accountDetail.bybitApiSecretPlaceholder'),
          disclosure: t('accountDetail.bybitKeychainDisclosure'),
          connect: t('accountDetail.connectBybit'),
          connected: t('accountDetail.bybitConnected'),
          couldNotConnect: t('accountDetail.couldNotConnectBybit'),
          // The cooldown keeps no cause, and this text fits a rate refusal and a 403 alike.
          coolingDown: t('accountDetail.bybitForbidden'),
          syncStillRunning: t('accountDetail.bybitSyncStillRunning'),
        }}
        isCoolingDown={isBybitCoolingDown}
        isSyncRunning={isBybitSyncRunning}
        verify={(apiKey, secret) =>
          bybitKeyRefusalOf(apiKey, secret, keepsBybitHoldings ? { ownerCheck: { accountId } } : {})
        }
        save={saveBybitCredentials}
        intro={
          <Box gap={1}>
            <ExpandToggle
              expanded={introExpanded}
              onPress={() => setIntroExpanded((isExpanded) => !isExpanded)}
              collapsedLabel={t('components.bybitCredentialsField.connectionDetails')}
              testID="bybit-intro-toggle"
            />

            {introExpanded && (
              <>
                <Text variant="caption" tone="textSecondary">
                  {t('accountDetail.bybitConnectLimits')}
                </Text>

                <Text variant="caption" tone="textSecondary">
                  {t('accountDetail.bybitKinds')}
                </Text>
              </>
            )}
          </Box>
        }
      />

      {connectError !== undefined && <ErrorNotice message={connectError} />}
    </Box>
  );
};

export default BybitCredentialsField;
