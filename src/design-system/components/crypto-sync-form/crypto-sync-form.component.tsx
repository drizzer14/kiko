import type { FC } from 'react';
import { match } from 'ts-pattern';
import type { BinanceWriteToken } from '@kiko/crypto-sync/binance';
import type { WriteToken } from '@kiko/crypto-sync/exchange/credentials';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';
import type { ExchangeCatalogId } from '@kiko/crypto-sync/exchange-catalog';

import WalletAddressField from '../wallet-address-field';
import BybitCredentialsField from '../bybit-credentials-field';
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
  onConnectBybit: (stored: WriteToken) => Promise<boolean>;
  // Each source's field takes its own reminder: only the picked source's field is mounted.
  walletReminder?: ConnectReminder;
  binanceReminder?: ConnectReminder;
  bybitReminder?: ConnectReminder;
  // Forwarded to the Binance field: runs when it unmounted during the write that stored its pair,
  // with the token of that write.
  onBinanceStoredWhileUnmounted?: (stored: BinanceWriteToken) => Promise<void>;
  // The same hand-over for the Bybit field.
  onBybitStoredWhileUnmounted?: (stored: WriteToken) => Promise<void>;
  // Forwarded to the Bybit field: whether the account keeps a holding of a Bybit account, so
  // Connect refuses a key of another one. The design system cannot read holdings, so the screen
  // that owns them tells it.
  keepsBybitHoldings?: boolean;
  // Forwarded to the Bybit field: the text of a failed Connect, which a screen that keeps no
  // error line of its own passes so the user reads the refusal and not only that Connect failed.
  bybitConnectError?: string;
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
  onConnectBybit,
  walletReminder,
  binanceReminder,
  bybitReminder,
  onBinanceStoredWhileUnmounted,
  onBybitStoredWhileUnmounted,
  keepsBybitHoldings,
  bybitConnectError,
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
    .with('bybit', () => (
      <BybitCredentialsField
        accountId={accountId}
        onConnect={onConnectBybit}
        reminder={bybitReminder}
        onStoredWhileUnmounted={onBybitStoredWhileUnmounted}
        keepsBybitHoldings={keepsBybitHoldings}
        connectError={bybitConnectError}
      />
    ))
    .with('other', () => null)
    .exhaustive();
};

export default CryptoSyncForm;
