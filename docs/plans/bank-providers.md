# Bank Provider Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generalize Kiko's Monobank-only bank sync into a provider abstraction, add PrivatBank AutoClient as the second native (stored-credential) provider, and add one free aggregator for the foreign banks displaced Ukrainian users now hold accounts at — all surfaced through a single, honestly-labeled "add a bank" catalog screen.

**Architecture:** A `BankProvider` interface generalizes what `src/monobank/sync/sync.ts` already does today; Monobank becomes its first implementation with minimal file churn (a registry wrapper, not a rewrite of its battle-tested engine). PrivatBank is a new, independently-scoped `single-bank` implementation modeled directly on Monobank's Keychain/client/sync shape. A `multi-bank` provider shape is added to the same interface so a consent-based aggregator (one connection -> many underlying banks -> many Kiko Accounts) fits without a second interface. A provider-catalog data module drives the user-facing "which bank, how it connects, who it's for" copy for every option, hand-authored for the three top-level providers and templated for an aggregator's individual underlying banks.

**Tech Stack:** React Native + TypeScript, op-sqlite + Drizzle (`src/db/schema.ts`), `react-native-keychain` (Keychain-only credential storage), `fnts` (network/error handling), `ts-pattern` (exhaustive mapping), i18next (`src/i18n/locales/{en,uk}.ts`), Jest + RNTL, Maestro (`.maestro/`).

**Spec:** `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md` (domain model, storage, sync); this doc extends it. Read `kiko-architecture`, `kiko-domain`, `kiko-code-style`, `kiko-design-system` (project skills) before implementing any task below — they are the source of truth for the conventions this plan follows, not restated here.

## Global Constraints

- Every credential (Monobank token, PrivatBank token+clientId, an aggregator's per-connection secret) lives ONLY in the iOS Keychain via `react-native-keychain`, hardened `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no `accessControl` — never in `.env`, SQLite, `settings`, `holdings.metadata`, or a log (`CLAUDE.md` "`.env` is public-only"; `kiko-architecture`'s Monobank sync section).
- Every DB write goes through `db.transaction()` (`kiko-architecture`); a bulk holding upsert is one transaction, not N.
- A synced transaction's `externalId` is namespaced `` `${accountId}:${providerStatementId}` `` so the GLOBAL `(source, external_id)` unique index never collides across two connections of any provider (`kiko-architecture`'s "Namespaced synced externalId").
- `accounts.institution` is a free-text column (`text('institution')`, `src/db/schema.ts:18`) with **no** DB or TS enum — adding a new provider id needs **no migration**. `transactions.source`'s enum (`src/db/schema.ts:125`) **is** a Drizzle TS-only enum — adding a member is a one-line `schema.ts` change, still no migration (`kiko-domain`: "A Drizzle `text({ enum: [...] })` is a TS-only compile-time hint, not a DB constraint").
- Every new bank sync fails closed: a fetch/mapping error must never leave an account half-connected (mirror `markMonobankAccount`'s ordering — mark `institution` only after the first successful fetch) and must never advance a sync cursor on a partial failure (mirror `runSyncInner`'s cursor-freeze-on-failure in `src/monobank/sync/sync.ts:1222-1233`).
- `npm run check:all` after every task; `npm run check:deep` before the phase is declared done (root `CLAUDE.md`).
- Every external-API fact below not already verified against this repo's own code is marked **[VERIFY LIVE]** and must be confirmed against the provider's current docs before its task is implemented — the coordinator owns that verification pass, not this plan.

---

## Grounding: what already exists

Read directly, not restated in full here:

- **Monobank client** — `src/monobank/client/monobank.client.ts`: `fetchClientInfo`/`fetchStatement`, timeout (`MonobankTimeoutError`) + bounded-429-retry (`MonobankRateLimitError`) wrapper.
- **Per-account Keychain token** — `src/monobank/token/token.ts`: `serviceFor(accountId) = 'kiko.monobank.token.<accountId>'`, `hardenedFor` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no `accessControl`), `saveToken`/`readToken`/`clearToken`/`hasToken`.
- **Per-account TWO-FIELD credential blob** — `src/crypto-sync/binance/binance.credentials.ts`: `BinanceCredentials = { apiKey, secret }` stored as ONE JSON Keychain item under `kiko.binance.credentials.<accountId>`. This is the exact template for PrivatBank's `{ token, clientId }` pair (below).
- **Monobank sync engine** — `src/monobank/sync/sync.ts` (`runSync`/`runSyncInner`, ~1250 lines): per-connection `sync_state` cursor, balance-diff skip, changed-first queue, crash-safe `syncedBalanceMinorUnits` marker, force-retry set (`failedSyncMonobankIds`), full-fetch graduation, a per-token request gate (`src/monobank/throttle/`), and the cross-provider progress/spinner signals (`src/monobank/sync-status/`, already shared with crypto sync — see `kiko-architecture`'s "Three sync signals"). This is heavily invariant-laden and device-verified; **do not** mechanically rewrite it to be generic — wrap it (Phase 0).
- **An abstraction already exists, for balances only** — `src/crypto-sync/provider/provider.ts`: `BalanceProvider<Deps> { id, metadataField, fetchBalances(deps, target) }`, implemented by `bitcoinWalletProvider` (`src/crypto-sync/btc-wallet/btc-wallet.provider.ts`) and `binanceProvider`. It has no statement/date-range fetch and is insufficient for a bank that must import a transaction ledger — a new, sibling `BankProvider` interface is needed (section A), not a reuse of this one.
- **The fan-out seam** — `src/sync/sync-jobs/sync-jobs.ts`'s `syncJobsFor`: branches on `account.institution === 'monobank'` vs `isBalanceProviderId(institution)`. This is the exact seam every new provider must plug into.
- **Domain schema** — `src/db/schema.ts`: `accounts` (`kind: 'bank'|'cash'|'crypto'`, `institution: text`, no `metadata` column), `holdings` (`metadata: json`, the per-holding provider-key store — `monobankId`/`walletAddress`/`binanceAsset` today, `src/holdings/holding-metadata/holding-metadata.ts:57`), `transactions` (`source` enum, namespaced `externalId`), `syncState` (per-connection cursor, `accountId` PK).
- **The connect UI** — `src/screens/account-detail/account-detail.screen.tsx`: `showActionButton = isBankAccount` unconditionally renders `MonobankConnectField` (`src/screens/account-detail/monobank-connect-field/`) when `!isConnectedToMonobank`. This is the seam the new provider-catalog sheet (Priority 1) replaces.
- **Fail-closed precedent (cited per the task's ask)** — `src/rates/history-backfill/history-backfill.ts:220` documents the crypto-price all-or-nothing debt directly: *"an all-or-nothing `Promise.all` would... discard the NBU fiat rates too"* — fixed there with `Promise.allSettled` so one source's failure doesn't sink the other. The BALANCE side of Binance sync is the fail-**closed** counterpart (`kiko-architecture`'s Binance section): Spot's fetch failure fails the WHOLE sync because "its balance must be trusted," while Funding/Earn fail independently and are omitted, never zeroed. Every new provider's sync engine follows the Spot rule for its own connection: a failed fetch must never write a fabricated balance or advance a cursor — section E generalizes this.
- **Money** — `src/currency/money/money.ts`: `Money.of`/`fromMajor`, integer minor units only. **Currency mapping** — `src/monobank/currency-code/currency-code.ts`: `currencyFromCode`/`codeFromCurrency`, ISO 4217 numeric <-> `Currency`. This module's content is generic ISO 4217, not Monobank-specific; PrivatBank (and any other numeric-code provider) reuses it directly from `src/monobank/currency-code` — precedent for cross-provider reuse of a `src/monobank/*` module already exists (`src/crypto-sync/binance/binance.transactions.ts` reuses `src/monobank/throttle`'s `createRequestGate`).

---

## A. Bank provider abstraction

### A.1 Provider catalog (user-facing provider information) — PRIORITY

This is the data that drives the "add a bank" screen. It exists **before** any sync-engine code, because the UI it feeds is the first thing a user sees, and every provider (including an aggregator's individual underlying banks) must be describable through it.

```ts
// src/bank-sync/provider-catalog/provider-catalog.ts

/** How the app authenticates to this provider. */
export type ConnectionMethod = 'stored-token' | 'consent-flow';

/** Whether one connection yields exactly one bank, or can yield several. */
export type ProviderShape = 'single-bank' | 'multi-bank';

export type ProviderCatalogEntry = {
  id: BankProviderId;
  /** Title shown on the catalog row, e.g. 'Monobank'. */
  displayName: string;
  /** (a) Which bank/API this is, in plain language. i18n key, 1 sentence. */
  aboutKey: string;
  connectionMethod: ConnectionMethod;
  shape: ProviderShape;
  /** (b) What data it provides and how it connects/refreshes. i18n key. */
  dataProvidedKey: string;
  /** (c) Who it works for, stated plainly. i18n key. */
  eligibilityKey: string;
  /**
   * Country/bank coverage, shown only for a multi-bank provider — a
   * single-bank provider's coverage is implicit in its `aboutKey`.
   * `countries` is ISO 3166-1 alpha-2; `bankCount` is the provider's own
   * marketing figure, always shown as approximate.
   */
  coverage?: { countries: string[]; bankCount?: string };
};
```

Filled-in entries (the actual copy — English source; `src/i18n/locales/uk.ts` carries the Ukrainian translation of the same keys, per `en.uk.parity.test.ts`'s enforced parity):

```ts
export const providerCatalog: ProviderCatalogEntry[] = [
  {
    id: 'monobank',
    displayName: 'Monobank',
    connectionMethod: 'stored-token',
    shape: 'single-bank',
    aboutKey: 'addBank.monobank.about',
    // "Monobank is a Ukrainian mobile-only bank. Kiko connects with a
    //  personal API token you generate in the Monobank app."
    dataProvidedKey: 'addBank.monobank.dataProvided',
    // "Balances, jars, and transaction history, refreshed automatically
    //  and on pull-to-refresh. Read-only — Kiko cannot move money."
    eligibilityKey: 'addBank.monobank.eligibility',
    // "Works with any personal Monobank account. No business or FOP
    //  account needed."
  },
  {
    id: 'privatbank',
    displayName: 'PrivatBank',
    connectionMethod: 'stored-token',
    shape: 'single-bank',
    aboutKey: 'addBank.privatbank.about',
    // "PrivatBank is Ukraine's largest bank. Kiko connects through its
    //  AutoClient API using a token and client ID from Privat24."
    dataProvidedKey: 'addBank.privatbank.dataProvided',
    // "Balances and transaction statements, refreshed the same way as
    //  Monobank. Read-only — Kiko cannot send payments."
    eligibilityKey: 'addBank.privatbank.eligibility',
    // "Requires a Privat24 business or individual-entrepreneur (FOP)
    //  account with API access enabled from the 'API for developers'
    //  menu. A personal retail Privat24 account does not have this
    //  option."
  },
  {
    id: 'gocardless',
    displayName: 'Connect another bank',
    connectionMethod: 'consent-flow',
    shape: 'multi-bank',
    aboutKey: 'addBank.gocardless.about',
    // "A secure bank-connection service. Kiko redirects you to your
    //  own bank's login page — your bank password is never seen or
    //  stored by Kiko."
    dataProvidedKey: 'addBank.gocardless.dataProvided',
    // "Balances and up to 24 months of transaction history for every
    //  account you choose. Access renews automatically about every 90
    //  days, per EU banking rules. Read-only."
    eligibilityKey: 'addBank.gocardless.eligibility',
    // "Covers banks in the United Kingdom, Ireland, and the EU/EEA —
    //  for example Poland, Germany, and Czechia. Does not cover
    //  Ukrainian banks (use Monobank or PrivatBank for those) or banks
    //  in the United States or Canada."
    coverage: { countries: ['GB', 'IE', 'PL', 'DE', 'CZ', /* full EEA list, VERIFY LIVE */], bankCount: '2,500+ banks [VERIFY LIVE]' },
  },
];
```

**Per-underlying-bank copy is generated, not hand-authored.** Once a `multi-bank` provider's consent flow returns its account list, each distinct underlying institution renders through one shared template — `t('addBank.aggregatorBankFound', { bankName, country })` — interpolating the provider's own institution name + ISO country returned by `fetchAccounts` (below). Kiko does not maintain separate catalog entries for GoCardless's 2,500+ individual banks; only the 3 top-level rows above are hand-authored.

### A.2 The `BankProvider` interface

Sibling to `src/crypto-sync/provider/provider.ts`'s `BalanceProvider`, but adds date-ranged statement fetch and the `shape` discriminant multi-bank support requires (Priority 2b).

```ts
// src/bank-sync/provider/provider.ts

export const bankProviderIds = ['monobank', 'privatbank', 'gocardless'] as const;
export type BankProviderId = (typeof bankProviderIds)[number];

export const isBankProviderId = (value: string | null): value is BankProviderId =>
  value !== null && (bankProviderIds as readonly string[]).includes(bankProviderIdOf(value));

/** Strips a multi-bank provider's `<providerId>:<externalInstitutionId>` suffix. */
export const bankProviderIdOf = (institution: string): string => institution.split(':', 1)[0];

export type ProviderInstitution = {
  /** The provider's own bank id, e.g. GoCardless's 'REVOLUT_REVOGB21'. Absent for a single-bank provider (there is only ever one). */
  externalInstitutionId?: string;
  name: string;
  /** ISO 3166-1 alpha-2, e.g. 'PL'. Absent for a single-bank provider (Ukraine is implicit). */
  countryCode?: string;
};

export type ProviderAccount = {
  externalAccountId: string;
  institution: ProviderInstitution;
  kind: 'card' | 'jar' | 'account';
  name: string;
  /** `undefined` = a currency Kiko cannot represent; caller skips it (mirrors `isUnrepresentableCurrency`). */
  currency: Currency | undefined;
  balanceMinorUnits: number;
  iban?: string;
  maskedPan?: string;
};

export type ProviderStatementItem = {
  externalAccountId: string;
  externalStatementId: string;
  amountMinorUnits: number;
  timeSeconds: number;
  description?: string;
  mcc?: number;
  hold?: boolean;
  counterIban?: string;
  comment?: string;
};

export interface BankProvider<Credentials, Deps> {
  id: BankProviderId;
  /**
   * 'single-bank': Monobank/PrivatBank — one stored credential targets one
   * already-existing Kiko Account (`targetAccountId`), same as today.
   * 'multi-bank': an aggregator — one credential/connection can surface
   * accounts across SEVERAL institutions; the sync engine creates one Kiko
   * Account PER distinct `ProviderInstitution` it has not seen before
   * (see A.3), never merging two banks under one Account.
   */
  shape: 'single-bank' | 'multi-bank';
  /** `null` when the API has no meaningful per-credential rate limit (a consent-based aggregator typically doesn't; Monobank/PrivatBank do). */
  rateLimit: { intervalMs: number } | null;
  /** The API's max statement window, for windowed paging (mirrors `MAX_WINDOW_SECONDS`). */
  maxWindowSeconds: number;
  fetchAccounts: (deps: Deps, credentials: Credentials) => Promise<ProviderAccount[]>;
  fetchStatement: (
    deps: Deps,
    credentials: Credentials,
    externalAccountId: string,
    fromSeconds: number,
    toSeconds: number,
  ) => Promise<ProviderStatementItem[]>;
}
```

A **registry** ties a `BankProviderId` to its concrete `runSync`/credential functions, so `syncJobsFor` and the account-detail screen never hardcode a provider list:

```ts
// src/bank-sync/registry/registry.ts
export type BankProviderRegistryEntry = {
  id: BankProviderId;
  catalog: ProviderCatalogEntry;
  runSync: (overrides?: { targetAccountId?: string }) => Promise<{ importedTransactions: number }>;
  hasCredentials: (accountId: string) => Promise<boolean>;
  disconnect: (accountId: string) => Promise<void>;
};

export const bankProviderRegistry: Record<BankProviderId, BankProviderRegistryEntry> = {
  monobank: { id: 'monobank', catalog: providerCatalog[0], runSync: monobankRunSync, hasCredentials: hasToken, disconnect: disconnectMonobank },
  privatbank: { /* Phase 1 */ },
  gocardless: { /* Phase 2 */ },
};
```

### A.3 Refactoring Monobank into the first implementation

**Deliberately thin, not a rewrite** — `src/monobank/sync/sync.ts`'s engine keeps its ~1250 lines and every invariant unchanged (balance-diff skip, force-retry set, full-fetch graduation are Monobank-specific optimizations for its 1-req/60s limit; PrivatBank does not inherit them at v1 — see D, Phase 1). Files touched:

- **Modify** `src/sync/sync-jobs/sync-jobs.ts`: replace the hardcoded `account.institution === 'monobank'` branch with `isBankProviderId(account.institution)` -> `bankProviderRegistry[bankProviderIdOf(account.institution)].runSync({ targetAccountId: account.id })`. Behavior-preserving for Monobank; `sync-jobs.test.ts` must still pass unmodified in assertions, only its setup wiring changes.
- **Create** `src/bank-sync/provider/provider.ts`, `src/bank-sync/provider-catalog/provider-catalog.ts`, `src/bank-sync/registry/registry.ts` (A.1/A.2 above), each with an `index.ts` barrel and a co-located test per `kiko-code-style`'s folder-per-thing rule.
- **No change** to `src/monobank/sync/sync.ts`, `src/monobank/client/`, `src/monobank/token/`, `src/monobank/throttle/`, `src/monobank/sync-status/`, `src/monobank/currency-code/` — Monobank's registry entry wraps its existing exports as-is.
- **Modify** `src/db/schema.ts:125`: add `'privatbank'` (Phase 1) to `transactions.source`'s enum tuple. TS-only, no migration (Global Constraints).
- **Modify** `src/holdings/holding-metadata/holding-metadata.ts:57`: add `'privatbankId'` to `syncedMetadataFields` (Phase 1). Drives `isSyncedHolding`/creatable-type gating per `kiko-domain`'s "Sync-only holding types."

### A.4 Multi-bank mapping (Priority 2b): one connection, many banks, split cleanly

This is new behavior no existing provider needs (Monobank/crypto always sync into one already-known target). The generic bank-sync engine (used by any `shape: 'multi-bank'` provider) does:

1. Call `provider.fetchAccounts(deps, credentials)` once. Its result may span N distinct `ProviderInstitution`s.
2. **Group** the returned `ProviderAccount[]` by `institution.externalInstitutionId`.
3. For each group, find an existing Kiko `Account` created by THIS connection for THIS institution: scan the connection's known holdings for `metadata.gocardlessConnectionId === connectionId && metadata.externalInstitutionId === group.id` (mirrors how `monobankIdOf` re-associates a holding by its stored key). None found -> **create** a new `accounts` row: `kind: 'bank'`, `institution: 'gocardless'`, `name: group.institution.name` (e.g. `'PKO Bank Polski'`, user-renamable afterward, same as any account).
4. Upsert that group's `ProviderAccount[]` as holdings **under that Account only** — `metadata: { gocardlessConnectionId, externalInstitutionId, externalAccountId, iban? }`, mirroring `{ monobankId, iban, maskedPan }`'s shape exactly.
5. Fetch and import that group's statements the same way Monobank imports a card's — namespaced `externalId` = `` `${accountId}:${externalStatementId}` `` (Global Constraints), landing under the correct per-bank Account's holdings.

No new `accounts` column is needed: `institution = 'gocardless'` alone identifies the provider; the underlying bank identity and the connection reference live on `holdings.metadata`, the same layer that already carries every other provider-specific key. This keeps step A.3's "no migration for a new provider id" property true even for the multi-bank case — the only new migration in this whole plan is the one in Phase 2 (D) for a `syncState`-shaped need, if any, discovered once GoCardless's actual refresh model is confirmed **[VERIFY LIVE]**.

**Entry point differs by shape**, because a multi-bank provider doesn't target one pre-existing empty "bank" Account the way Monobank/PrivatBank do:

- `single-bank` (Monobank, PrivatBank): unchanged — the user creates an empty `kind: 'bank'` Account first (`src/screens/forms/account-form/account-form.screen.tsx`), then connects it from its own `AccountDetail` screen (current `MonobankConnectField` seam).
- `multi-bank` (GoCardless): initiated from the **Accounts list** screen's own "Add" affordance (`src/screens/accounts/accounts.screen.tsx`), not from an existing account's detail screen — there is no single pre-existing Account to target. After consent, the engine creates 0..N Accounts per step 3 above and the user lands back on the Accounts list seeing them appear live (`useLiveQuery` on `accountsRepo.listQuery()`), with a one-time summary sheet ("Found 3 accounts across 2 banks: PKO Bank Polski, Revolut") shown between consent-return and the first sync commit.

---

## B. PrivatBank AutoClient integration design

**[VERIFY LIVE]** flags every wire-shape fact below against Privat24's current "API for developers" documentation before implementation — none of it is confirmed against a live response in this repo.

### Credential storage

Mirrors `src/crypto-sync/binance/binance.credentials.ts` exactly (two-field JSON blob), not `src/monobank/token/token.ts` (single string) — new file `src/privatbank/credentials/credentials.ts`:

```ts
export type PrivatbankCredentials = { token: string; clientId: string };

export const PRIVATBANK_CREDENTIALS_SERVICE = 'kiko.privatbank.credentials';
export const serviceFor = (accountId: string): string => `${PRIVATBANK_CREDENTIALS_SERVICE}.${accountId}`;
export const hardenedFor = (service: string): Keychain.SetOptions => ({
  service,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

export const saveCredentials = (accountId: string, credentials: PrivatbankCredentials): Promise<void> => /* Keychain.setGenericPassword('privatbank', JSON.stringify(credentials), hardenedFor(serviceFor(accountId))) */;
export const readCredentials = (accountId: string): Promise<PrivatbankCredentials | undefined> => /* parse + validate, mirrors binance.credentials.ts's isCredentials guard */;
export const clearCredentials = (accountId: string): Promise<void> => /* Keychain.resetGenericPassword */;
export const hasCredentials = (accountId: string): Promise<boolean> => /* Keychain.hasGenericPassword */;
```

No global/legacy transitional item is needed — unlike Monobank/Binance, PrivatBank has no pre-multi-account era to migrate from. Both `token` and `clientId` go to the Keychain, **never** to `.env`, SQLite, or a log (Global Constraints) — the dispatcher's brief calls this out explicitly and it is the one rule this section must never relax.

### Fetch-statements request/response shape (best-effort — VERIFY LIVE)

```ts
// src/privatbank/monobank... /* placeholder shape, confirm against Privat24 docs */
export type PrivatbankAccount = {
  acc: string;         // IBAN or internal account id — confirm which
  currency: string;    // alphabetic ISO 4217 ('UAH') or numeric — confirm
  balance: string;     // decimal string in MAJOR units — confirm scale/format
  name?: string;
};

export type PrivatbankStatementItem = {
  id: string;           // unique per account — confirm global vs per-account uniqueness
  date: string;          // confirm format (likely 'DD.MM.YYYY HH:mm:ss')
  amount: string;        // decimal string, signed — confirm
  currency: string;
  description?: string;
  counterIban?: string;
};
```

Client (`src/privatbank/client/privatbank.client.ts`), modeled on `src/monobank/client/monobank.client.ts`'s shape:

- `fetchAccounts(credentials, fetchImpl?)` -> the AutoClient balances/accounts call, header-authenticated with `token`+`clientId` (exact header names TBD — Monobank uses `X-Token`; PrivatBank's AutoClient docs must confirm its own header/auth scheme).
- `fetchStatement(credentials, accountId, fromDate, toDate, fetchImpl?)` -> the date-ranged statement call.
- Reuse the same timeout (`REQUEST_TIMEOUT_MS`-equivalent) + bounded-retry wrapper shape as Monobank's `request()`, renamed `PrivatbankTimeoutError`/`PrivatbankRateLimitError`.
- New `.env` entry: `PRIVATBANK_API_ENDPOINT=<base url>` (public, non-secret base URL — same class as `MONOBANK_API_ENDPOINT`, `BINANCE_API_ENDPOINT` in `.env.example`).

### Mapping to domain

- `PrivatbankAccount` -> `NewHolding` mirrors `mapAccountToHolding` (`src/monobank/sync/sync.ts:261`): `type: 'card'`, `currency` via `currencyFromCode` (reused from `src/monobank/currency-code/`, **VERIFY** whether PrivatBank's `currency` field is numeric ISO 4217 like Monobank's or an alphabetic code needing a different, trivial mapper), `metadata: { privatbankId, iban }`.
- `PrivatbankStatementItem` -> `NewTransaction` mirrors `mapStatementItem` (`src/monobank/sync/sync.ts:232`): `source: 'privatbank'`, `externalId: \`${accountId}:${item.id}\`` (Global Constraints' namespacing rule), `hold` likely always `false`/absent (**VERIFY** whether AutoClient exposes a pending-authorization concept at all).

### Rate limits — VERIFY LIVE

Monobank's 1-req/60s-per-token limit is documented in its own API docs; PrivatBank AutoClient's equivalent is **not known** and must be confirmed before Phase 1's sync engine picks an interval for `createRequestGate`. Until verified, design the engine to accept the interval as a named constant (`PRIVATBANK_RATE_LIMIT_MS`) in one place, exactly where Monobank's `RATE_LIMIT_MS` lives (`src/monobank/sync/sync.ts:37`), so a wrong initial guess is a one-line fix, not a re-architecture.

### The FOP/business-account caveat

PrivatBank's AutoClient token issuance (per the dispatcher's brief) is scoped to a business or individual-entrepreneur (FOP) Privat24 account, not a personal retail one. This is **the single most important eligibility fact** a user must see before typing a token — surfaced twice:

1. In the provider catalog (A.1)'s `addBank.privatbank.eligibility` copy, shown on the "add a bank" picker before the user even opens the token field.
2. Inline on `PrivatbankConnectField` itself (mirroring `MonobankTokenInput`'s "link + field" layout), as a `Text tone="textSecondary"` caption above the token inputs, so a user who skipped the picker's copy still sees it right before entering a token — `t('accountDetail.privatbankFopNotice')`.

---

## C. Aggregator evaluation

### Framing: who needs this, and for what

Kiko's users are Ukrainian, but since 2022 many now live displaced across the EU, the UK/Ireland, and — to a lesser extent — North America. **Ukraine is already served natively** (Monobank today, PrivatBank in Phase 1, and further Ukrainian banks are cheap to add the same way if ever requested). The aggregator's job is therefore **not** to re-cover Ukraine — it is to cover the **host countries** a displaced user now banks in. That reframes the free-tier question: an aggregator only needs to win on EU/UK/host-country coverage and price, not on Ukrainian coverage, because Ukraine is not what it needs to solve.

### Candidates

| Candidate | Ukraine | UK/Ireland | EU/EEA (Poland, Germany, Czechia, ...) | North America | Free tier | Consent + refresh model | Notes |
|---|---|---|---|---|---|---|---|
| **GoCardless Bank Account Data** (ex-Nordigen) | No **[VERIFY LIVE]** — not a PSD2/UK-Open-Banking market | Yes — strong, native UK Open Banking support | Yes — 2,500+ banks across the full EEA, historically its core strength | No — product is UK/EEA Open-Banking-only, no US/Canada rails | **Yes** — historically a genuinely free self-serve tier with a monthly free-request/free-end-user allowance, no card required to start **[VERIFY LIVE current terms]** | OAuth-style redirect: app requests a "requisition" -> user picks their bank -> redirected to the bank's own login -> returns an `access_token`/`requisition_id`; SCA re-consent roughly every 90 days per PSD2 | No official React Native SDK; plain REST + an in-app `WebView`/`ASWebAuthenticationSession` redirect |
| **Salt Edge** | Yes — explicitly markets CIS/Eastern-Europe coverage including Ukraine | Yes | Yes — broad, comparable to GoCardless | Partial — some North American connectors exist but this is not its core strength **[VERIFY LIVE]** | **No confirmed self-serve free tier** — public pricing is opaque, contact-sales / per-connection pricing **[VERIFY LIVE — this is the deciding weakness]** | Salt Edge Connect (hosted widget) + Salt Edge manages background refresh itself | The only candidate that would let an aggregator also touch Ukraine, but at a real, undetermined cost |
| **TrueLayer** | No | Yes — UK-strong | Partial — UK-first, EU coverage growing but narrower than GoCardless/Salt Edge | No | No meaningful free self-serve tier — historically fintech/payments-revenue-oriented pricing, not free read-only data access | Similar OAuth/redirect model | Weaker EU breadth than GoCardless for the "displaced across the EU" population; ruled out |
| **Tink** (mentioned for completeness) | No | Partial | Yes — strong Nordics/Western Europe, owned by Visa | No | No free self-serve tier | Similar OAuth/redirect model | Enterprise-oriented pricing; ruled out for the same reason as TrueLayer |

### Recommendation: GoCardless Bank Account Data, paired with native Ukrainian coverage

**Prioritizing a free tier per the brief, and given the reframing above, no paid aggregator is needed at all.** The split — Ukraine handled natively (Monobank + PrivatBank), the EU/UK host countries handled by GoCardless's free tier — gives adequate coverage of exactly the population Kiko actually serves (Ukraine + the EU/UK/Ireland countries most displaced Ukrainians live in) without taking on Salt Edge's undetermined cost or a backend built just to afford it.

This recommendation is explicitly **not** "GoCardless covers everything" — it does not, and must not be marketed to the user as if it does (A.1's eligibility copy states the Ukraine/North-America gaps plainly). Two residual gaps, tracked but out of scope now:

- **North America.** No candidate here covers it (PSD2/Open Banking has no US/Canada equivalent these four aggregators use). Plaid is the standard US/Canada aggregator; it is a **future candidate**, not evaluated here — flag for a later plan once a meaningful number of users report banking in North America.
- **A UA bank beyond Monobank/PrivatBank.** If a third Ukrainian bank is ever requested, the cheaper path is very likely another native, Monobank-shaped integration (section B's pattern), not paying for Salt Edge just to reach one more UA bank — revisit only if the number of requested UA banks grows past what's cheap to hand-integrate.

### The backend-secret problem (applies to every consent-flow candidate, including the recommendation)

GoCardless (like Salt Edge/TrueLayer/Tink) authenticates every API call — including "create a requisition for this end user" — with an **app-level secret key**, not a per-user bearer token the way Monobank's personal token works. Kiko today has **no backend**: it is fully local (op-sqlite), and every existing integration (Monobank, Binance) calls the provider directly from the device with a credential scoped to that one user's own account. An app-level GoCardless secret embedded in the compiled iOS bundle is extractable by reverse-engineering the IPA — this is a materially different risk class from "a user's own token sits in their own Keychain," and it does not fit this repo's own secret-handling rule by analogy (`.env` is public-only; a secret belongs in the Keychain, and an app-wide API secret compiled into every install is neither).

**This is a phase-gating architectural prerequisite, not a coding detail**: Phase 2 (D) needs a minimal backend/serverless function (e.g. one Cloudflare Worker or AWS Lambda endpoint) whose only job is to hold the GoCardless secret and proxy exactly two calls — "create a requisition" and "list this requisition's accounts/transactions" — so the app itself never sees the secret, only a short-lived requisition URL and the (non-secret) `requisition_id`/`connection_id` it can safely store in `holdings.metadata` per A.4. Confirm with the coordinator/user whether standing up this backend is in scope before Phase 2 is scheduled — it is a first for this project.

### Consent flow, token refresh, and mapping (assuming the backend above exists)

1. App calls its own backend: "start a GoCardless connection for institution X" (institution picked from GoCardless's bank-selection list, fetched once and cached).
2. Backend calls GoCardless with its app secret, returns a `requisition_id` + a redirect URL.
3. App opens the redirect URL in an `ASWebAuthenticationSession`; the user logs in at their own bank; GoCardless redirects back into the app (a custom URL scheme / universal link) once consent completes.
4. App calls its backend: "list accounts for this requisition" -> backend proxies to GoCardless, returns `ProviderAccount[]` (A.2's shape) with no secret attached.
5. The generic multi-bank mapping (A.4) runs: group by institution, create/reuse Accounts, upsert holdings + statements.
6. **Refresh**: GoCardless requires SCA re-consent roughly every 90 days **[VERIFY LIVE exact interval]** — the app must detect an expired requisition (a specific error code from the backend proxy) and re-run step 1-3 for that same institution, re-attaching to the SAME Kiko Account (matched by `metadata.externalInstitutionId` + the stored `metadata.gocardlessConnectionId`, replaced with the new one on success) rather than creating a duplicate Account.

---

## D. Phased plan

### Phase 0 — Provider abstraction scaffolding (prerequisite, no user-visible change)

Files: create `src/bank-sync/provider/`, `src/bank-sync/provider-catalog/`, `src/bank-sync/registry/` (A.2/A.3, each folder gets `.ts` + `.test.ts` + `index.ts`); modify `src/sync/sync-jobs/sync-jobs.ts`.

- [ ] Add `bankProviderIds`/`isBankProviderId`/`bankProviderIdOf` (A.2). Test: unit tests for the id-splitting helper (`'monobank'` -> `'monobank'`; `'gocardless:REVOLUT_REVOGB21'` -> `'gocardless'`).
- [ ] Add `providerCatalog` with the `monobank` + `privatbank` entries only (A.1) — `gocardless`'s entry is added in Phase 2, once its exact coverage list is verified.
- [ ] Add `bankProviderRegistry` wired to Monobank's existing `runSync`/`hasToken`/`disconnectMonobank` (A.3). Test: `registry.test.ts` asserts `bankProviderRegistry.monobank.runSync === monobankRunSync` (identity, not a re-implementation).
- [ ] Modify `syncJobsFor` to branch through the registry (A.3). Test: `sync-jobs.test.ts`'s existing Monobank assertions must still pass unmodified in expectation, only the module's internal wiring changes.
- [ ] Check: `npm run check:all`.

### Phase 1 — PrivatBank + the catalog-driven add-bank sheet (the 1.1-sized slice)

Deliberately **simpler** than Monobank's engine: no balance-diff skip, no changed-first queue, no force-retry set, no full-fetch graduation. Every triggered sync re-fetches every connected PrivatBank account's statements for `[lastSyncAt ?? defaultLookback, now]`, capped at `maxWindowSeconds` per page. This is an explicit, documented scoping choice — PrivatBank's account count for a FOP user is typically small (unlike Monobank's many-card households), so the throughput problem Monobank's optimizations solve may not exist here; **[VERIFY LIVE]** PrivatBank's actual rate limit before shipping — if it turns out as tight as Monobank's 1-req/60s, promote the balance-diff skip into a fast-follow rather than blocking this slice on it.

Files:

- **Create** `src/privatbank/credentials/credentials.ts` (+ test) — B's Keychain module.
- **Create** `src/privatbank/client/privatbank.client.ts` (+ test) — B's client, with its own `.d.ts` for the placeholder wire types.
- **Create** `src/privatbank/sync/sync.ts` (+ test) — the simplified engine: resolve target account -> `syncStateRepo.ensure(accountId)` -> `readCredentials` -> `fetchAccounts` -> mark `institution: 'privatbank'` only after that call succeeds (mirrors `markMonobankAccount`'s ordering) -> upsert holdings in one `db.transaction()` (a new `holdingsRepo.upsertPrivatbankMany`, added alongside `upsertMonobankMany` rather than generalizing it — do not touch Monobank's proven function) -> per account, page statements via a `createRequestGate` reused from `src/monobank/throttle` -> `transactionsRepo.addManyDedup` -> advance `syncState.lastSyncAt` only on a fully clean run (Global Constraints' fail-closed rule) -> participate in the shared progress session (`beginProgressSession`/`registerWork`/`commitWork`/`commitHolding`/`endProgressSession`/`setFastPhaseDone`, reused from `src/monobank/sync-status`, already cross-provider). Own per-account single-flight `Map`, keyed by `accountId` (a small local module-level map, not shared with Monobank's — the two providers' account ids are disjoint so nothing is gained by sharing).
- **Create** `src/privatbank/disconnect/disconnect.ts` (+ test) — mirrors `src/monobank/disconnect/disconnect.ts`: `accountsRepo.disconnect(accountId)` then `clearCredentials(accountId)`.
- **Modify** `src/db/schema.ts`: add `'privatbank'` to `transactions.source`'s enum.
- **Modify** `src/holdings/holding-metadata/holding-metadata.ts`: add `'privatbankId'` to `syncedMetadataFields`.
- **Modify** `src/bank-sync/provider-catalog/provider-catalog.ts`: add the `privatbank` entry (already drafted in A.1).
- **Modify** `src/bank-sync/registry/registry.ts`: add the `privatbank` entry.
- **Create** `src/screens/account-detail/add-bank-sheet/` (`.component.tsx` + `.props.d.ts` + `.styles.ts` + `.component.test.tsx` + `index.ts`) — a `BottomSheet` (per `kiko-design-system`) listing `providerCatalog` entries as tappable rows (title + about + eligibility caption), replacing the current unconditional `<MonobankConnectField>` render in `account-detail.screen.tsx` when `!account.institution`.
- **Create** `src/screens/account-detail/privatbank-connect-field/` (`.component.tsx` + `.component.test.tsx` + `index.ts`) — mirrors `monobank-connect-field.component.tsx`: two `TextField`s (token, client id) each with the paste-icon-only ghost `Button` convention (`kiko-design-system`'s "paste-icon-only ghost Button"), the FOP notice caption (B), a Connect button, `SyncStatusLine`.
- **Modify** `src/screens/account-detail/account-detail.screen.tsx`: add `connectPrivatbank` (mirrors `connectMonobank`: `saveCredentials(accountId, {token, clientId})` then `privatbankRunSync({targetAccountId: accountId})`); branch the connected-state block and its Disconnect action on `account.institution` via the registry (`bankProviderRegistry[bankProviderIdOf(account.institution)]`) instead of hardcoding Monobank; render `AddBankProviderSheet` in place of the current unconditional `MonobankConnectField` when disconnected.
- **Modify** `src/i18n/locales/en.ts` and `uk.ts`: add every `addBank.*` key from A.1 plus `accountDetail.privatbankFopNotice`, `accountDetail.connectPrivatbank`, `accountDetail.disconnectPrivatbank*`, `accountDetail.invalidPrivatbankCredentials`, `accountDetail.noPrivatbankCredentials` (mirroring the existing Monobank key set at `en.ts:274-303`). Check: `en.uk.parity.test.ts`.

Tests (Jest + RNTL):

- [ ] `src/privatbank/credentials/credentials.test.ts` — save/read/clear round trip (mirrors `binance.credentials.test.ts`).
- [ ] `src/privatbank/client/privatbank.client.test.ts` — timeout + bounded-retry behavior (mirrors `monobank.client.test.ts`).
- [ ] `src/privatbank/sync/sync.test.ts` — injected-deps: first sync creates holdings + imports transactions; re-sync dedupes via `(source, external_id)`; a fetch failure leaves `sync_state.lastSyncAt` unchanged and the account's `institution` unset until a first success (fail-closed); single-flight join. Mirrors `src/monobank/sync/sync.test.ts`'s deps-injection style.
- [ ] `src/screens/account-detail/add-bank-sheet/add-bank-sheet.component.test.tsx` — renders both catalog rows with their eligibility copy; selecting one closes the sheet and reports the choice.
- [ ] `src/screens/account-detail/privatbank-connect-field/privatbank-connect-field.component.test.tsx` — mirrors `monobank-connect-field.component.test.tsx`'s validate-then-connect flow.
- [ ] `account-detail.screen.test.tsx` — extend to cover: the picker sheet opening for a disconnected bank account, the PrivatBank-connected status branch, Disconnect routed to `disconnectPrivatbank`.

Maestro: no PrivatBank credential can be safely embedded in the repo's regression flow (same constraint that already keeps Monobank connect out of `.maestro/regression.yaml` — confirmed no `monobank`/token references exist there today). No new Maestro flow in this phase; note it as a manual QA checklist item instead (see `docs/harness/screenshots-check.md`'s pattern for why a live-credential flow stays out of the automated suite).

Checkpoints: `make gate` after the schema/registry/credentials/client tasks land; `make gate` again after the UI tasks land; `make deep` before Phase 1 is declared done.

### Phase 2 — GoCardless aggregator (gated on the backend prerequisite in C)

Not sized for 1.1 — schedule only once C's backend question is answered.

- [ ] Confirm with the coordinator/user: is standing up a minimal backend (Cloudflare Worker/Lambda) in scope? If no, this phase is blocked indefinitely — do not attempt a client-side-secret workaround.
- [ ] Stand up the backend proxy (2 endpoints: create-requisition, list-accounts-and-transactions for a requisition). Out of this repo's own harness scope (no `check:*` wrapper covers a separate service) — track its own repo/deploy story.
- [ ] Add `gocardless` to `bankProviderIds`, `providerCatalog` (A.1, with a verified `coverage` list), and `bankProviderRegistry`.
- [ ] Implement the `multi-bank` sync engine per A.4: group-by-institution, create-Account-if-new, per-bank holding/statement upsert. New module: `src/gocardless/sync/sync.ts`.
- [ ] Implement the consent flow: `ASWebAuthenticationSession` launch, redirect handling (a custom URL scheme registered in `ios/Kiko/Info.plist`), the post-consent "found N accounts across M banks" confirmation screen.
- [ ] Implement refresh-expiry detection and re-consent, re-attaching to the existing Account(s) (C's refresh design).
- [ ] Tests: the backend proxy is mocked at the `fetchAccounts`/`fetchStatement` boundary the same way Monobank's `fetchImpl` is injected; a dedicated multi-bank-mapping unit test (`gocardless/sync/sync.test.ts`) asserts that two institutions in one `fetchAccounts()` response produce two distinct `accounts` rows with disjoint holdings.
- [ ] `make deep` before done.

---

## E. Security posture

- **Keychain-only credentials, always.** Monobank token (existing), PrivatBank `{token, clientId}` (Phase 1), and any GoCardless per-connection reference (Phase 2) all live in `react-native-keychain` items hardened `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, keyed per-account (`serviceFor(accountId)`), never in `.env`, SQLite, `settings`, `holdings.metadata`, or a log — the one rule every provider shares, per Global Constraints and the dispatcher's explicit instruction.
- **The aggregator's app-level secret never reaches the device at all** (C) — a strictly *stronger* posture than the stored-token providers, since there is no per-user bearer secret on-device to protect in the first place; only a non-secret connection/requisition id lives in `holdings.metadata`, the same layer as `monobankId`.
- **Read-only wherever the API allows it.** Every fetch call in this plan is a read (balances/statements); no provider's payment-sending capability (PrivatBank AutoClient's docs mention one) is ever wired up — the eligibility copy (A.1) explicitly tells the user Kiko cannot move money/send payments, for every provider.
- **Fail closed on fetch errors**, generalizing the two precedents already in the codebase (Grounding, above):
  - Binance's Spot rule ("its balance must be trusted" — a failure fails the WHOLE sync rather than writing a fabricated number): every new provider's engine must never write a holding balance it didn't actually receive, and must never mark `institution` before the first fetch succeeds (mirrors `markMonobankAccount`).
  - The crypto-price `Promise.allSettled` pattern (`history-backfill.ts:220`, one source's failure must not sink an unrelated one): applies at the FAN-OUT level (`sync-jobs.ts`'s `Promise.allSettled` across accounts) — one provider's or one connection's failure must never abort another connection's sync, exactly as today's per-card fault isolation in `runSyncInner` already guarantees for Monobank.
  - A partial failure must never advance a sync cursor (`sync_state.lastSyncAt`), so a retried sync re-covers the missed window idempotently via the `(source, external_id)` upsert (Global Constraints).
- **Every new schema surface stays additive.** No column is ever renamed or dropped; `transactions.source`'s new enum members are TS-only; `accounts.institution` needing no migration at all is a direct, checked consequence of it already being unconstrained free text.

---

## Self-review

- **Spec coverage.** A (interface + Monobank refactor + multi-bank mapping) — D Phase 0/A.3/A.4. B (PrivatBank design) — full section, Phase 1. C (aggregator eval + recommendation + consent design) — full section, Phase 2. D (phased plan, files, UI, tests, risks) — present per phase. E (security posture, fail-closed, cited pattern) — present. Priority 1 (provider catalog, real copy, eligibility) — A.1, hand-authored text included. Priority 2a (free-first aggregator recommendation) — C, explicit. Priority 2b (multi-bank mapping) — A.2/A.4, explicit grouping algorithm. Geographic framing (Ukraine + EU/UK/Ireland + North America) — C's framing paragraph and coverage table.
- **Type consistency.** `BankProviderId`/`ProviderAccount`/`ProviderStatementItem`/`ProviderCatalogEntry`/`BankProviderRegistryEntry` are each defined once (A.1/A.2) and referenced by the same names throughout B/C/D — no renamed field slipped through a later section.
- **No placeholders left unresolved as fact.** Every unverified external-API detail (PrivatBank's exact wire shape, its rate limit, GoCardless's exact coverage list/free-tier terms/refresh interval) is explicitly marked **[VERIFY LIVE]** rather than asserted as confirmed.
