import { flat } from '../breakdown-parts';
import { holdingsRepo } from '../../repo/holdings.repo';
import type { HoldingDescriptor } from '../holding-descriptor.d';
import { entityColorsDark } from '../../../design-system/palette';

type BalanceDescriptorConfig = Pick<HoldingDescriptor, 'symbol' | 'defaultColor'> & {
  exchange: HoldingDescriptor['exchange'];
};

// `card`, `cash`, `crypto_asset` and `jar` all share the same shape: a
// non-ledgerless type whose value is simply its stored balance and which
// derives no lifecycle entries (every ledger row it has is its OWN manual
// transaction, never a derived one). They differ only in symbol/color/exchange
// eligibility, which each descriptor below supplies.
const balanceDescriptor = (config: BalanceDescriptorConfig): HoldingDescriptor => ({
  ...config,
  side: 'asset',
  ledgerless: false,
  timeExempt: false,
  fixedCurrency: null,
  priced: null,
  breakdown: (holding) => flat(holding.currency, holdingsRepo.balanceOf(holding).minorUnits),
  entries: () => [],
});

export const cardDescriptor: HoldingDescriptor = balanceDescriptor({
  symbol: 'creditcard',
  defaultColor: entityColorsDark.white,
  exchange: { receivePath: 'plain', source: true, createSource: false, createDestination: false },
});

export const cashDescriptor: HoldingDescriptor = balanceDescriptor({
  symbol: 'banknote',
  defaultColor: entityColorsDark.khaki,
  exchange: { receivePath: 'plain', source: true, createSource: true, createDestination: true },
});

export const cryptoAssetDescriptor: HoldingDescriptor = balanceDescriptor({
  symbol: 'bitcoinsign.circle',
  defaultColor: entityColorsDark.yellow,
  exchange: {
    receivePath: 'plain',
    source: false,
    createSource: false,
    createDestination: false,
  },
});

export const jarDescriptor: HoldingDescriptor = balanceDescriptor({
  symbol: 'rectangle.portrait',
  defaultColor: entityColorsDark.violet,
  exchange: {
    receivePath: 'excluded',
    source: false,
    createSource: false,
    createDestination: false,
  },
});
