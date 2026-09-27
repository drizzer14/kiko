import {
  type BalanceProviderId,
  balanceProviderIds,
  providerDisplayName,
} from '@kiko/crypto-sync/provider';
import type { TFunction } from 'i18next';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../box';
import FieldLabel from '../field-label';
import SegmentedControl from '../segmented-control';
import WalletAddressField from '../wallet-address-field';
import BinanceCredentialsField from '../binance-credentials-field';

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
      {/* Wallet vs Binance swaps which credential field renders below
          (WalletAddressField / BinanceCredentialsField), so this is a mode
          toggle, not a same-form value pick — a SegmentedControl, matching
          the amount/currency mode selectors. SegmentedControl carries no
          visible label of its own (only the non-visual accessibilityLabel),
          so the caller composes its own FieldLabel above it, the same way
          ChipRow/BondIsinSection do. */}
      <Box gap={1}>
        <FieldLabel label={t('accountDetail.sourceLabel')} />

        <SegmentedControl<BalanceProviderId>
          options={balanceProviderIds}
          selected={source}
          onSelect={setSource}
          labels={sourceLabels(t)}
          accessibilityLabel={t('accountDetail.sourceLabel')}
        />
      </Box>

      {source === 'btc_wallet' && <WalletAddressField onConnect={onConnectWallet} />}

      {source === 'binance' && (
        <BinanceCredentialsField accountId={accountId} onConnect={onConnectBinance} />
      )}
    </Box>
  );
};

export default CryptoSyncForm;
