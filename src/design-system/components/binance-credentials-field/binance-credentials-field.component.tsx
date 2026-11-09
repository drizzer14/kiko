import type { FC } from 'react';
import {
  type BinanceWriteToken,
  fetchAccount,
  isBinanceCoolingDown,
  saveCredentials,
} from '@kiko/crypto-sync/binance';
import { useTranslation } from 'react-i18next';
import either, { bifoldMap } from 'fnts/either';
import { BINANCE_API_MANAGEMENT_URL } from '@env';
import { isBinanceSyncRunning } from '@kiko/crypto-sync/run-crypto-sync';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';

import ExchangeKeyForm from '../exchange-key-form';

type BinanceCredentialsFieldProps = {
  // The account this field's credentials belong to. The pair is a PER-ACCOUNT
  // Keychain item, so the Save write is keyed by this id — a second Binance
  // account stores and reads its own credentials.
  accountId: string;
  /**
   * Runs the Binance Connect sync once the pair is verified and stored; resolves whether it
   * succeeded. Receives the token of the write that stored the pair, so a caller that gives up can
   * clear that write's pair and no other; the pair itself stays in this field.
   */
  onConnect: (stored: BinanceWriteToken) => Promise<boolean>;
  // Lets a form that saves without this connection remind the user to press Connect first.
  reminder?: ConnectReminder;
  /**
   * Runs instead of `onConnect` when the field unmounted during the Keychain write that stored the
   * verified pair, so the screen that owns the account decides what happens to the pair; it must
   * not reject. It receives the token of that write, which clears that write's pair and no other.
   * Without it the pair stays where it was stored.
   */
  onStoredWhileUnmounted?: (stored: BinanceWriteToken) => Promise<void>;
};

// The Binance counterpart of the Monobank token field: two secure inputs for a
// read-only ("Enable Reading" only) key pair, over the shared `ExchangeKeyForm`. Connect verifies
// the pair with one account call BEFORE it is written to the biometric Keychain, then runs the
// first sync. The pair never leaves the form except into `fetchAccount` (the check) and
// `saveCredentials`; the callbacks get only the token of that write.
const BinanceCredentialsField: FC<BinanceCredentialsFieldProps> = ({
  accountId,
  onConnect,
  reminder,
  onStoredWhileUnmounted,
}) => {
  const { t } = useTranslation();

  // Any failure of the account call reads as a pair Binance did not accept.
  const verifyPair = async (apiKey: string, secret: string): Promise<string | undefined> =>
    bifoldMap(
      await either<unknown, unknown>(() => fetchAccount(apiKey, secret)),
      (): string | undefined => t('accountDetail.invalidApiKeyOrSecret'),
      (): string | undefined => undefined,
    );

  return (
    <ExchangeKeyForm
      accountId={accountId}
      onConnect={onConnect}
      reminder={reminder}
      onStoredWhileUnmounted={onStoredWhileUnmounted}
      managementUrl={BINANCE_API_MANAGEMENT_URL}
      copy={{
        openLink: t('accountDetail.openBinanceLink'),
        apiKeyPlaceholder: t('accountDetail.binanceApiKeyPlaceholder'),
        apiSecretPlaceholder: t('accountDetail.binanceApiSecretPlaceholder'),
        disclosure: t('accountDetail.binanceKeychainDisclosure'),
        connect: t('accountDetail.connectBinance'),
        connected: t('accountDetail.binanceConnected'),
        couldNotConnect: t('accountDetail.couldNotConnectBinance'),
        coolingDown: t('accountDetail.binanceCoolingDown'),
        syncStillRunning: t('accountDetail.binanceSyncStillRunning'),
      }}
      isCoolingDown={isBinanceCoolingDown}
      isSyncRunning={isBinanceSyncRunning}
      verify={verifyPair}
      save={saveCredentials}
    />
  );
};

export default BinanceCredentialsField;
