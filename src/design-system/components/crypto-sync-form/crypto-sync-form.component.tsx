import type { FC } from 'react';
import { match } from 'ts-pattern';
import type { BinanceWriteToken } from '@kiko/crypto-sync/binance';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';
import type { ExchangeCatalogId } from '@kiko/crypto-sync/exchange-catalog';

import WalletAddressField from '../wallet-address-field';
import BinanceCredentialsField from '../binance-credentials-field';

type CryptoSyncFormProps = {
  // The account the entered credential/address belongs to. On the detail screen
  // this is the existing account's id; on the create form it is the id the
  // screen pre-generated for the row it will insert on Connect (see
  // account-form.screen's ensureAccount). Either way the field binds its
  // Keychain write and first sync to this id.
  accountId: string;
  // The exchange or wallet whose field to mount; the caller picks it.
  source: ExchangeCatalogId;
  onConnectWallet: (address: string) => Promise<boolean>;
  onConnectBinance: (stored: BinanceWriteToken) => Promise<boolean>;
  // Each source's field takes its own reminder: only the picked source's field is mounted.
  walletReminder?: ConnectReminder;
  binanceReminder?: ConnectReminder;
  // Forwarded to the Binance field: runs when it unmounted during the write that stored its pair,
  // with the token of that write.
  onBinanceStoredWhileUnmounted?: (stored: BinanceWriteToken) => Promise<void>;
};

// The "not yet connected" crypto sync entry form: the entry field of the exchange or wallet the
// caller picked. Shared by the account-detail screen (against an existing account) and the account
// create form (against a pre-generated id), so the create form reuses this one form instead of
// hand-rolling a second copy — each field's own Connect runs the first sync.
const CryptoSyncForm: FC<CryptoSyncFormProps> = ({
  accountId,
  source,
  onConnectWallet,
  onConnectBinance,
  walletReminder,
  binanceReminder,
  onBinanceStoredWhileUnmounted,
}) => {
  return match(source)
    .with('btc_wallet', () => (
      <WalletAddressField onConnect={onConnectWallet} reminder={walletReminder} />
    ))
    .with('binance', () => (
      <BinanceCredentialsField
        accountId={accountId}
        onConnect={onConnectBinance}
        reminder={binanceReminder}
        onStoredWhileUnmounted={onBinanceStoredWhileUnmounted}
      />
    ))
    .with('other', () => null)
    .exhaustive();
};

export default CryptoSyncForm;
