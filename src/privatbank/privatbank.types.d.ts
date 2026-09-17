// PrivatBank AutoClient API wire shapes. VERIFIED against the official
// AutoClient docs (the coordinator's verification pass, task-6 brief) for the
// `/api/statements/transactions` statement fields and the shared pagination
// envelope (`status`/`type`/`exist_next_page`/`next_page_id`). The balance
// endpoint (`/api/statements/balance`) is NOT itemized field-by-field in that
// brief — `PrivatbankAccount` below models only the fields the brief
// describes in prose (an account number, an alpha-3 currency, and a
// decimal-string major-unit balance), named `CCY`/`balance` BY ANALOGY with
// the confirmed `CCY`/`SUM` naming on the transactions side, not itself a
// byte-for-byte confirmed field name — see the single
// `TODO(VERIFY LIVE)` in `client/privatbank.client.ts`'s `requestOnce`.

/**
 * One `/api/statements/balance` entry. `name` is deliberately NOT modeled —
 * the brief's balance-endpoint description never mentions a friendly account
 * name field, only the account number + currency + balance, so
 * `mapAccountToHolding` (`sync/sync.ts`) names every holding after `acc`
 * rather than guessing at an unconfirmed field.
 */
export interface PrivatbankAccount {
  acc: string;
  CCY: string;
  /** Decimal string, MAJOR units (e.g. '1234.56') — parsed decimal-safe, never via `parseFloat` (see `sync/sync.ts`'s `parseDecimalMajorToMinorUnits`). */
  balance: string;
}

/**
 * One `/api/statements/balance` page. Optional envelope fields keep test
 * fixtures lean (a fixture that omits `exist_next_page` behaves as "no more
 * pages", matching a falsy check) while still documenting the full CONFIRMED
 * envelope shape shared with the transactions endpoint.
 */
export interface PrivatbankBalancePage {
  status?: string;
  type?: string;
  exist_next_page?: boolean;
  next_page_id?: string;
  balances: PrivatbankAccount[];
}

/**
 * One `/api/statements/transactions` entry. VERIFIED field names (task-6
 * brief): `SUM` is an UNSIGNED decimal string in MAJOR units — the sign comes
 * from `TRANTYPE` ('C' = credit/+, 'D' = debit/-), never from `SUM` itself.
 * `DATE_TIME_DAT_OD_TIM_P` is `'DD.MM.YYYY HH:MM:SS'` (DOTS — the request's
 * own `startDate`/`endDate` query params use DASHES instead, see
 * `client/privatbank.client.ts`'s `formatPrivatbankDate`), assumed Kyiv local
 * time — see the client's single `TODO(VERIFY LIVE)`. `REF`+`REFN` together
 * are the doc's confirmed unique dedup key (`sync/sync.ts`'s `dedupKey`);
 * `ID` is also present as a fallback per the brief but unused here — REF+REFN
 * is what this client namespaces `externalId` from. `AUT_MY_ACC`/
 * `AUT_MY_NAM` (this connection's OWN account/name side of the transaction)
 * are modeled but not consumed by `mapStatementItem` — Kiko's domain has no
 * "own side" field to put them in, unlike `AUT_CNTR_NAM`/`AUT_CNTR_ACC`
 * (the counterparty), which map onto `description`'s counterpart,
 * `counterIban`.
 */
export interface PrivatbankStatementItem {
  ID?: string;
  REF: string;
  REFN: string;
  SUM: string;
  CCY: string;
  TRANTYPE: 'C' | 'D';
  DATE_TIME_DAT_OD_TIM_P: string;
  OSND?: string;
  AUT_CNTR_NAM?: string;
  AUT_CNTR_ACC?: string;
  AUT_MY_ACC?: string;
  AUT_MY_NAM?: string;
}

/**
 * One `/api/statements/transactions` page. `exist_next_page`/`next_page_id`
 * drive REAL forward pagination now (`sync/sync.ts`'s `fetchAllStatements`
 * follows `next_page_id` as the next request's `followId` while
 * `exist_next_page` stays `true`) — see that module's own fail-closed
 * page-cap doc comment for what happens if a page reports more items than
 * this client can safely keep following.
 */
export interface PrivatbankStatementPage {
  status?: string;
  type?: string;
  exist_next_page?: boolean;
  next_page_id?: string;
  transactions: PrivatbankStatementItem[];
}
