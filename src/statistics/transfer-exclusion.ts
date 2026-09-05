import { ALWAYS_EXCLUDED_MCCS, OWN_ACCOUNT_TRANSFER_MCC } from '../monobank/mcc-category';

/**
 * The minimal transaction shape the MCC/IBAN exclusion rule needs. `mcc` is the
 * Monobank merchant-category code (null on manual rows and on synced rows saved
 * before the code was persisted); `counterIban` is the counterparty's IBAN
 * (null on manual rows, on non-transfer merchants, and on rows synced before
 * the column existed).
 */
type ExclusionTransaction = {
  mcc: number | null;
  counterIban: string | null;
};

const ALWAYS_EXCLUDED = new Set<number>(ALWAYS_EXCLUDED_MCCS);

/**
 * Whether a transaction is a cash-out or an OWN-account transfer that must not
 * count as spending on the category pie. Keyed on the immutable `mcc` (not the
 * mutable stored `category`, which a rename/override can drift), so a re-labeled
 * cash-out is still dropped:
 *
 *   - `mcc` ∈ {6011, 6012, 6540} (cash-out + card top-ups) → excluded ALWAYS;
 *   - `mcc` === 4829 AND `counterIban` ∈ the user's OWN card IBANs → excluded
 *     (an own-account transfer). A 4829 to a null/third-party IBAN STAYS as
 *     spending — it is a genuine P2P payment to another person.
 *
 * A null `mcc` (manual rows, legacy synced rows) is never excluded here; it
 * falls through to the matched-pair matcher in `internal-transfers.ts`.
 */
export const isMccExcludedTransfer = (
  transaction: ExclusionTransaction,
  ownIbans: ReadonlySet<string>,
): boolean => {
  const { mcc, counterIban } = transaction;
  if (mcc === null) {
    return false;
  }
  if (ALWAYS_EXCLUDED.has(mcc)) {
    return true;
  }

  return mcc === OWN_ACCOUNT_TRANSFER_MCC && counterIban !== null && ownIbans.has(counterIban);
};

/**
 * USER-TUNABLE. Lowercase description substrings that mark an internal money
 * movement between the user's OWN holdings — money that must NOT count as
 * spending. Some Monobank rows carry a plain description instead of a transfer
 * MCC, so the mcc rule above cannot see them; this list catches those.
 *
 * Each entry is a distinctive fragment of a real Monobank description, chosen to
 * catch the examples without over-matching ordinary merchant names. Matching is
 * case-insensitive (both sides are lowercased). Add a new fragment here as more
 * internal-transfer wordings surface:
 *   - 'депозит'       → "Поповнення депозиту", "Відкриття депозиту" (deposit)
 *   - 'чорну картку'  → "На чорну картку" (the user's own black card)
 *   - 'фоп'           → "На гривневий рахунок ФОП для переказу на картку"
 */
const INTERNAL_TRANSFER_DESCRIPTION_PATTERNS: readonly string[] = [
  'депозит',
  'чорну картку',
  'фоп',
];

/**
 * Whether a transaction's free-text description marks it as an internal transfer
 * (see `INTERNAL_TRANSFER_DESCRIPTION_PATTERNS`). Case-insensitive substring
 * match; a null/empty description is never excluded. This runs ALONGSIDE the mcc
 * rule and the matched-pair matcher — a row is dropped from the spending pie if
 * ANY of them catches it.
 */
export const isDescriptionExcludedTransfer = (description: string | null | undefined): boolean => {
  if (!description) {
    return false;
  }
  const haystack = description.toLowerCase();

  return INTERNAL_TRANSFER_DESCRIPTION_PATTERNS.some((pattern) => haystack.includes(pattern));
};

/**
 * The ids of every transaction the description rule excludes (see
 * `isDescriptionExcludedTransfer`). Unioned by the caller with the mcc/IBAN ids
 * and the matched-pair ids.
 */
export const descriptionExcludedTransferTxIds = (
  transactions: readonly { id: string; description: string | null | undefined }[],
): Set<string> => {
  const ids = new Set<string>();
  for (const transaction of transactions) {
    if (isDescriptionExcludedTransfer(transaction.description)) {
      ids.add(transaction.id);
    }
  }

  return ids;
};

/**
 * The ids of every transaction the MCC/IBAN rule excludes (see
 * `isMccExcludedTransfer`). The caller unions these with the matched-pair ids
 * from `internalTransferTxIds` to drop both cash-outs/own-transfers and the
 * structurally-paired self-transfers the mcc rule cannot see.
 */
export const mccExcludedTransferTxIds = (
  transactions: readonly ({ id: string } & ExclusionTransaction)[],
  ownIbans: ReadonlySet<string>,
): Set<string> => {
  const ids = new Set<string>();
  for (const transaction of transactions) {
    if (isMccExcludedTransfer(transaction, ownIbans)) {
      ids.add(transaction.id);
    }
  }

  return ids;
};
