// Starling Bank v2 public API wire shapes. COORDINATOR-VERIFIED against
// Starling's own developer docs (not a guess) — see the task brief. Every
// amount is an integer in MINOR units, never a decimal string, so a holding
// or a feed item's amount maps straight onto Kiko's Money minor-units model
// with no decimal parsing.

/** An Amount, as every Starling money field shapes it: `{ currency, minorUnits }`. */
export interface StarlingAmount {
  currency: string;
  minorUnits: number;
}

export interface StarlingAccount {
  accountUid: string;
  /**
   * The category id the feed endpoints require to page one account's feed
   * (`GET /api/v2/feed/account/{accountUid}/category/{categoryUid}`). Kept
   * on the holding's metadata (`starlingCategory`) once synced.
   */
  defaultCategory: string;
  currency: string;
  createdAt: string;
}

export interface StarlingAccountsResponse {
  accounts: StarlingAccount[];
}

export interface StarlingBalance {
  /** Settled money only — excludes anything still pending. Used as the holding balance. */
  clearedBalance: StarlingAmount;
  /** Includes pending transactions; NOT used for the holding balance (see `sync.ts`). */
  effectiveBalance: StarlingAmount;
  availableToSpend?: StarlingAmount;
}

export interface StarlingFeedItem {
  feedItemUid: string;
  categoryUid: string;
  amount: StarlingAmount;
  direction: 'IN' | 'OUT';
  /** ISO 8601. A parse failure must THROW per-item (fail-closed) — see `mapFeedItem` in `sync.ts`. */
  transactionTime: string;
  status: string;
  counterPartyName?: string;
  counterPartyType?: string;
  reference?: string;
  spendingCategory?: string;
}

export interface StarlingFeedResponse {
  feedItems: StarlingFeedItem[];
}
