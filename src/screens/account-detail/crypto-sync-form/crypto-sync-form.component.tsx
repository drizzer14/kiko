import type { TFunction } from 'i18next';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type BalanceProviderId,
  balanceProviderIds,
  providerDisplayName,
} from '../../../crypto-sync/provider';
import Box from '../../../design-system/components/box';
import ChipRow from '../../forms/chip-row';
import BinanceCredentialsField from '../binance-credentials-field';
import WalletAddressField from '../wallet-address-field';

type CryptoSyncFormProps = {
  // The account the entered credential/address belongs to. On the detail screen
  // this is the existing account's id; on the create form it is the id the
  // screen pre-generated for the row it will insert on Connect (see
  // account-form.screen's ensureCryptoAccount). Either way the field binds its
  // Keychain write and first sync to this id.
  accountId: string;
  onConnectWallet: (address: string) => Promise<boolean>;
  onConnectBinance: () => Promise<boolean>;
};

// A function (not a module-level constant) so its labels re-resolve against
// the active language on every render, rather than freezing to whatever
// language was active when this module first loaded.
const sourceLabels = (t: TFunction): Record<BalanceProviderId, string> => ({
  btc_wallet: providerDisplayName('btc_wallet', t),
  binance: providerDisplayName('binance', t),
});

// The "not yet connected" crypto sync entry form: a Wallet/Binance source
// picker and the matching entry field. Shared by the account-detail screen
// (against an existing account) and the account create form (against a
// pre-generated id), so the create form reuses this one form instead of
// hand-rolling a second copy — each field's own Connect runs the first sync.
const CryptoSyncForm: FC<CryptoSyncFormProps> = ({
  accountId,
  onConnectWallet,
  onConnectBinance,
}) => {
  const { t } = useTranslation();
  const [source, setSource] = useState<BalanceProviderId>('btc_wallet');

  return (
    <Box gap={3}>
      <ChipRow
        label={t('accountDetail.sourceLabel')}
        options={balanceProviderIds}
        selected={source}
        onSelect={setSource}
        labels={sourceLabels(t)}
      />

      {source === 'btc_wallet' && <WalletAddressField onConnect={onConnectWallet} />}

      {source === 'binance' && (
        <BinanceCredentialsField accountId={accountId} onConnect={onConnectBinance} />
      )}
    </Box>
  );
};

export default CryptoSyncForm;
