import { BTC_EXPLORER_ENDPOINT } from '@env';
import { guard } from 'fnts';

/** The Esplora `/address/:address` payload fields this client reads. */
type EsploraAddress = { chain_stats: { funded_txo_sum: number; spent_txo_sum: number } };

/**
 * Read an Esplora address body, or throw on a non-ok response. The ok-check is
 * a `guard` validator/executor pair rather than an imperative `if (!ok) throw`,
 * matching the Monobank and CoinGecko clients for consistency.
 */
const readAddress = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`Block explorer request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<EsploraAddress> => response.json(),
);

/**
 * Fetch a BTC address's confirmed on-chain balance in satoshis: total funded
 * minus total spent, from the explorer's `chain_stats`. Unconfirmed mempool
 * activity is deliberately excluded so the holding never shows a pending
 * amount that could still drop out of the chain.
 */
export const fetchAddressBalance = async (
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> => {
  const response = await fetchImpl(
    `${BTC_EXPLORER_ENDPOINT}/address/${encodeURIComponent(address)}`,
  );
  const data = await readAddress(response);

  return data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
};
