# Crypto BTC Sync (Wallet + Binance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `crypto` account pull a live BTC balance into one `crypto_asset` holding — first from a pasted public Bitcoin address (no secret), then from a read-only Binance API key — through one generic `BalanceProvider` + `runBalanceSync` pipeline that mirrors the Monobank sync.

**Architecture:** A `BalanceProvider<Deps>` interface (`id`, `kind`, `metadataField`, `fetchBalances`) and one `runBalanceSync(provider, providerDeps, overrides)` driver resolve the target account, fetch one balance snapshot, mark the account `institution: provider.id`, and upsert the holding through a new `holdingsRepo.upsertExchange` (a metadata-key upsert sharing one internal helper with `upsertMonobank`). The wallet provider reads an Esplora block explorer; the Binance provider signs `GET /api/v3/account` with a pure-JS HMAC-SHA256 (`@noble/hashes`) and reads `{apiKey, secret}` from a biometric Keychain item. The account-detail screen gets a `CryptoSyncSection` (source chips, wallet-address / Binance-credentials fields, Sync now / Disconnect) driven by a `useCryptoSync` hook that reuses the Monobank hook's state machine.

**Tech Stack:** React Native 0.87, TypeScript, drizzle-orm + op-sqlite, fnts (`guard`, `either`, `eitherSync`), ts-pattern, react-native-keychain 10, react-native-dotenv (`@env`), `@noble/hashes` (new, pure JS), Jest + @testing-library/react-native, Biome.

**Spec:** `docs/superpowers/specs/2026-09-04-crypto-btc-sync-design.md`

## Global Constraints

- **BTC only.** `holdings.currency` stays the closed `BTC | USD | EUR | UAH` enum; no currency-model change; every non-BTC asset, multi-asset Binance, other exchanges, EVM wallets, IP allowlisting, and a crypto transaction ledger are OUT of scope.
- **Ship order:** provider abstraction + wallet provider (Tasks 1–6) before Binance (Tasks 7–10); UI last (Tasks 11–17).
- **No schema change** except widening the `transactions.source` TS enum to `'manual' | 'monobank' | 'btc_wallet' | 'binance'`. SQLite text enums are TypeScript-only and the drizzle snapshots do not record them (verified: `drizzle/migrations/meta/0005_snapshot.json` contains no enum values), so `npx drizzle-kit generate` MUST report no changes — do not hand-author a migration.
- **Secrets:** the Binance `{apiKey, secret}` pair lives only in the iOS Keychain under `service: 'kiko.binance.credentials'` with `ACCESS_CONTROL.BIOMETRY_CURRENT_SET` + `ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Never in SQLite, `metadata`, `console`, or a test fixture that a `key|secret|token` binding name precedes (gitleaks `generic-api-key` keys on those words — see Task 7).
- **Every DB write goes through `write()`** (`src/db/client.ts`) — the repo layer already does; add no direct writes.
- **New public URLs go in `.env` + `.env.example` + `src/env.d.ts`** via `@env`, never as string literals in source (kiko-code-style "Externalize hardcoded config"). If a Jest run reports a new `@env` key as missing, run `npx jest --clearCache` once — the Babel transform cache predates the `.env` edit.
- **Naming:** uppercase acronyms stay uppercase in identifiers (`isBTCBalance`, `BTC_EXPLORER_ENDPOINT`); avoid a leading acronym by spelling it out (`bitcoinWalletProvider`, `isValidBitcoinAddress`). Full unabbreviated names. Blank line before every `return`/`if`/`for`. Two import groups (external+aliased, then relative), each sorted shortest-line-first. `import type` for type-only imports.
- **Components:** default export, `.component.tsx`, one component per file, explicit `return`, theme tokens only (no raw colors/spacing), `props` not `rest` for a rest binding, title-case UI headings, sibling JSX nodes separated by a blank line. Reuse shared components (`Box`, `Text`, `PressableButton`, `SymbolIcon`, `ChipRow`) — no hand-rolled equivalents.
- **Closed literal mapping** uses `ts-pattern` `match(...).exhaustive()`; the literal set is derived from one `as const` tuple.
- **Harness:** `npm run check:all` at every CHECKPOINT; `npm run check:deep` before declaring done. Never weaken a check; never add a bare `biome-ignore`.
- **Commits:** the user's standing rule holds commits for review. Each task ends with a commit step for the case where the coordinator has confirmed commits are wanted; otherwise stop at that step with the listed files staged and report.
- **Tests are colocated** (`<name>.test.ts(x)`), run as `npx jest <path>` from the repo root.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/crypto-sync/provider.ts` | `balanceProviderIds` tuple, `BalanceProviderId`, `isBalanceProviderId`, `providerDisplayName`, `ProviderBalance`, `SyncTarget`, `BalanceProvider<Deps>` (Task 1). |
| `src/crypto-sync/provider.test.ts` | Tests for `isBalanceProviderId` / `providerDisplayName` (Task 1). |
| `src/db/schema.test.ts` | Asserts the widened `transactions.source` enum values (Task 1). |
| `src/crypto-sync/sync.ts` | `BalanceSyncDeps`, `BalanceSyncResult`, `runBalanceSync` — the generic driver (Task 4). |
| `src/crypto-sync/sync.test.ts` | In-memory-deps tests for `runBalanceSync` with a fake provider (Task 4). |
| `src/crypto-sync/btc-wallet/btc-wallet.client.ts` | `fetchAddressBalance(address, fetchImpl)` → satoshis from an Esplora `/address/:address` payload (Task 5). |
| `src/crypto-sync/btc-wallet/btc-wallet.client.test.ts` | URL / arithmetic / non-ok tests (Task 5). |
| `src/crypto-sync/btc-wallet/bitcoin-address.ts` | `isValidBitcoinAddress` format check (Task 6). |
| `src/crypto-sync/btc-wallet/bitcoin-address.test.ts` | Valid/invalid address vectors (Task 6). |
| `src/crypto-sync/btc-wallet/btc-wallet.provider.ts` | `BitcoinWalletDeps`, `defaultBitcoinWalletDeps`, `bitcoinWalletProvider` (Task 6). |
| `src/crypto-sync/btc-wallet/btc-wallet.provider.test.ts` | Provider tests (Task 6). |
| `src/crypto-sync/binance/binance.hmac.ts` | `signQuery(secret, query)` — hex HMAC-SHA256 via `@noble/hashes` (Task 7). |
| `src/crypto-sync/binance/binance.hmac.test.ts` | Known-vector tests (Task 7). |
| `src/crypto-sync/binance/binance.credentials.ts` | `BinanceCredentials`, `saveCredentials`, `readCredentials`, `clearCredentials` (Task 8). |
| `src/crypto-sync/binance/binance.credentials.test.ts` | Keychain option + round-trip tests (Task 8). |
| `src/crypto-sync/binance/binance.client.ts` | `BinanceBalance`, `BinanceAccount`, `FetchAccountOptions`, `fetchAccount(apiKey, secret, options)` (Task 9). |
| `src/crypto-sync/binance/binance.client.test.ts` | Signing / header / non-ok / clock-skew tests (Task 9). |
| `src/crypto-sync/binance/binance.provider.ts` | `BinanceDeps`, `defaultBinanceDeps`, `binanceProvider` (Task 10). |
| `src/crypto-sync/binance/binance.provider.test.ts` | Filter/sum/convert tests (Task 10). |
| `src/crypto-sync/run-crypto-sync.ts` | `CryptoSyncRequest`, `runCryptoSync(request)` — picks the concrete provider (Task 11). |
| `src/crypto-sync/run-crypto-sync.test.ts` | Dispatch tests (Task 11). |
| `src/crypto-sync/disconnect.ts` | `disconnectCryptoAccount(accountId, providerId)` (Task 11). |
| `src/crypto-sync/disconnect.test.ts` | DB-then-Keychain ordering tests (Task 11). |
| `src/screens/use-crypto-sync.ts` | `useCryptoSync` = `useSyncAction(runCryptoSync)` (Task 12). |
| `src/screens/use-crypto-sync.test.ts` | Hook tests (Task 12). |
| `src/screens/account-detail/sync-status-line.props.d.ts` | `SyncStatus` union + `SyncStatusLineProps` (Task 13). |
| `src/screens/account-detail/sync-status-line.component.tsx` | Shared idle/checking/success/invalid/saveError status line (Task 13). |
| `src/screens/account-detail/sync-status-line.component.test.tsx` | Status rendering tests (Task 13). |
| `src/screens/account-detail/wallet-address-field.component.tsx` | Address input + paste + Connect Wallet action (Task 14). |
| `src/screens/account-detail/wallet-address-field.component.test.tsx` | State-transition tests (Task 14). |
| `src/screens/account-detail/binance-credentials-field.component.tsx` | API key + secret inputs, Binance link, Connect Binance action (Task 15). |
| `src/screens/account-detail/binance-credentials-field.component.test.tsx` | State-transition tests (Task 15). |
| `src/screens/account-detail/format-last-sync.ts` | `formatLastSyncAt(lastSyncAt)` (moved out of the screen) + `latestSyncedAt(holdings)` (Task 16). |
| `src/screens/account-detail/format-last-sync.test.ts` | Tests for both helpers (Task 16). |
| `src/screens/account-detail/crypto-sync-section.component.tsx` | The crypto account's Synchronization section (Task 16). |
| `src/screens/account-detail/crypto-sync-section.component.test.tsx` | Section tests (Task 16). |

**Modified:**

| Path | Change |
|---|---|
| `src/db/schema.ts` | Widen `transactions.source` enum (Task 1). |
| `src/holdings/holding-metadata.ts` | Add `syncedMetadataFields`, `SyncedMetadataField`, `ExchangeMetadataField`, `SYNCED_AT_FIELD`, `walletAddressOf`, `syncedAtOf` (Task 1). |
| `src/holdings/holding-metadata.test.ts` | Tests for the two new readers (Task 1). |
| `src/holdings/deletable.ts` | Widen `isSyncedTransaction` / `isSyncedHolding` / `isSyncedAccount`; export `SyncedInstitution` (Task 1). |
| `src/holdings/deletable.test.ts` | New-literal cases (Task 1). |
| `src/repositories/holdings.repo.ts` | Add `upsertByMetadataKey` helper + `upsertExchange`; `upsertMonobank` delegates (Task 2). |
| `src/repositories/holdings.repo.test.ts` | Upsert update/insert tests for both entry points (Task 2). |
| `src/repositories/accounts.repo.ts` | `connectedQuery(institution = 'monobank')`; `disconnectMonobank` → generalized `disconnect` (Task 3). |
| `src/repositories/accounts.repo.test.ts` | Rename + new strip cases + institution param test (Task 3). |
| `src/monobank/disconnect.ts` | Call `accountsRepo.disconnect` (Task 3). |
| `src/monobank/disconnect.test.ts` | Mock rename (Task 3). |
| `.env`, `.env.example`, `src/env.d.ts` | `BTC_EXPLORER_ENDPOINT` (Task 5), `BINANCE_API_ENDPOINT` (Task 9), `BINANCE_API_MANAGEMENT_URL` (Task 15). |
| `package.json`, `package-lock.json` | `@noble/hashes` dependency (Task 7). |
| `jest.config.js` | Add `@noble` to the transform-ignore exemption list (Task 7). |
| `src/screens/use-sync.ts` | Extract `useSyncAction<Input>`; `useSync` wraps it; `sync` resolves to a success boolean (Task 12). |
| `src/screens/account-detail/monobank-token-field.component.tsx` | Render its status through `SyncStatusLine` (Task 13). |
| `src/screens/account-detail/account-detail.screen.tsx` | Render `CryptoSyncSection` for a `crypto` account; import `formatLastSyncAt` (Task 17). |
| `src/screens/account-detail/account-detail.screen.test.tsx` | Section gating tests (Task 17). |

---
## Phase A — Foundation (provider abstraction, repos, generic sync)

### Task 1: Enum growth, synced predicates, provider types

**Files:**
- Modify: `src/db/schema.ts:52`
- Create: `src/db/schema.test.ts`
- Create: `src/crypto-sync/provider.ts`, `src/crypto-sync/provider.test.ts`
- Modify: `src/holdings/holding-metadata.ts` (append after `isNumber`, line 49)
- Modify: `src/holdings/holding-metadata.test.ts` (append)
- Modify: `src/holdings/deletable.ts` (whole file)
- Modify: `src/holdings/deletable.test.ts` (whole file)

**Interfaces:**
- Consumes: `HoldingRow` from `src/db/schema.ts`; `isRecord`/`isNumber` module-level helpers already in `holding-metadata.ts`.
- Produces:
  - `balanceProviderIds: readonly ['btc_wallet', 'binance']`, `type BalanceProviderId`, `isBalanceProviderId(value: string | null): value is BalanceProviderId`, `providerDisplayName(id: BalanceProviderId): string` ('Wallet' | 'Binance'), `type ProviderBalance = { currency: 'BTC'; balanceMinorUnits: number; metadataKey: string; name: string }`, `type SyncTarget = { accountId: string; holdings: HoldingRow[] }`, `interface BalanceProvider<Deps> { id; kind: 'exchange' | 'wallet'; metadataField: ExchangeMetadataField; fetchBalances(deps: Deps, target: SyncTarget): Promise<ProviderBalance[]> }`.
  - `syncedMetadataFields: readonly ['monobankId', 'walletAddress', 'binanceAsset']`, `type SyncedMetadataField`, `type ExchangeMetadataField = 'walletAddress' | 'binanceAsset'`, `SYNCED_AT_FIELD = 'syncedAt'`, `walletAddressOf(metadata: unknown): string | undefined`, `syncedAtOf(metadata: unknown): number | null`.
  - `type SyncedInstitution = 'monobank' | 'btc_wallet' | 'binance'`; widened `isSyncedTransaction` / `isSyncedHolding` / `isSyncedAccount`.

- [ ] **Step 1: Write the failing tests**

`src/db/schema.test.ts`:

```ts
import { transactions } from './schema';

describe('transactions.source enum', () => {
  it('names every sync source alongside manual', () => {
    expect(transactions.source.enumValues).toEqual(['manual', 'monobank', 'btc_wallet', 'binance']);
  });
});
```

`src/crypto-sync/provider.test.ts`:

```ts
import { balanceProviderIds, isBalanceProviderId, providerDisplayName } from './provider';

describe('balance provider ids', () => {
  it('lists the wallet and Binance providers, in ship order', () => {
    expect(balanceProviderIds).toEqual(['btc_wallet', 'binance']);
  });

  it('recognizes a provider id and rejects monobank, null, and free text', () => {
    expect(isBalanceProviderId('btc_wallet')).toBe(true);
    expect(isBalanceProviderId('binance')).toBe(true);
    expect(isBalanceProviderId('monobank')).toBe(false);
    expect(isBalanceProviderId(null)).toBe(false);
    expect(isBalanceProviderId('kraken')).toBe(false);
  });

  it('maps each provider to its display name', () => {
    expect(providerDisplayName('btc_wallet')).toBe('Wallet');
    expect(providerDisplayName('binance')).toBe('Binance');
  });
});
```

Append to `src/holdings/holding-metadata.test.ts`:

```ts
import { syncedAtOf, walletAddressOf } from './holding-metadata';

describe('walletAddressOf', () => {
  it('reads a string walletAddress', () => {
    expect(walletAddressOf({ walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' })).toBe(
      'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    );
  });

  it('returns undefined for null, non-object, or non-string metadata', () => {
    expect(walletAddressOf(null)).toBeUndefined();
    expect(walletAddressOf('bc1q')).toBeUndefined();
    expect(walletAddressOf({ walletAddress: 42 })).toBeUndefined();
    expect(walletAddressOf({ monobankId: 'x' })).toBeUndefined();
  });
});

describe('syncedAtOf', () => {
  it('reads a finite syncedAt timestamp', () => {
    expect(syncedAtOf({ walletAddress: 'bc1q', syncedAt: 1_704_326_400_000 })).toBe(1_704_326_400_000);
  });

  it('returns null when absent, non-numeric, or not an object', () => {
    expect(syncedAtOf({ walletAddress: 'bc1q' })).toBeNull();
    expect(syncedAtOf({ syncedAt: 'yesterday' })).toBeNull();
    expect(syncedAtOf({ syncedAt: Number.NaN })).toBeNull();
    expect(syncedAtOf(null)).toBeNull();
  });
});
```

(If the file's existing top import already imports from `./holding-metadata`, merge the new names into that import instead of adding a second one.)

Replace `src/holdings/deletable.test.ts`:

```ts
import { isSyncedAccount, isSyncedHolding, isSyncedTransaction } from './deletable';

describe('synced predicates', () => {
  it('flags every non-manual transaction source', () => {
    expect(isSyncedTransaction({ source: 'monobank' })).toBe(true);
    expect(isSyncedTransaction({ source: 'btc_wallet' })).toBe(true);
    expect(isSyncedTransaction({ source: 'binance' })).toBe(true);
    expect(isSyncedTransaction({ source: 'manual' })).toBe(false);
  });

  it('flags a holding carrying a monobankId', () => {
    expect(isSyncedHolding({ metadata: { monobankId: 'abc' } })).toBe(true);
    expect(isSyncedHolding({ metadata: { iban: 'UA...' } })).toBe(false);
    expect(isSyncedHolding({ metadata: null })).toBe(false);
  });

  it('flags a holding carrying a walletAddress or a binanceAsset', () => {
    expect(isSyncedHolding({ metadata: { walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' } })).toBe(true);
    expect(isSyncedHolding({ metadata: { binanceAsset: 'BTC' } })).toBe(true);
  });

  it('does not flag a non-string sync key', () => {
    expect(isSyncedHolding({ metadata: { walletAddress: 1 } })).toBe(false);
    expect(isSyncedHolding({ metadata: { syncedAt: 1_704_326_400_000 } })).toBe(false);
  });

  it('flags every synced institution', () => {
    expect(isSyncedAccount({ institution: 'monobank' })).toBe(true);
    expect(isSyncedAccount({ institution: 'btc_wallet' })).toBe(true);
    expect(isSyncedAccount({ institution: 'binance' })).toBe(true);
    expect(isSyncedAccount({ institution: null })).toBe(false);
    expect(isSyncedAccount({ institution: 'kraken' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/db/schema.test.ts src/crypto-sync/provider.test.ts src/holdings/holding-metadata.test.ts src/holdings/deletable.test.ts`
Expected: FAIL — `Cannot find module './provider'`, `walletAddressOf is not a function`, enum `toEqual` mismatch, `isSyncedAccount({institution:'btc_wallet'})` returns `false`.

- [ ] **Step 3: Widen the schema enum**

In `src/db/schema.ts` line 52 replace:

```ts
    source: text('source', { enum: ['manual', 'monobank'] }).notNull(),
```

with

```ts
    // 'btc_wallet' / 'binance' are named for enum parity with
    // `accounts.institution`; a balance sync writes no transaction rows today.
    source: text('source', { enum: ['manual', 'monobank', 'btc_wallet', 'binance'] }).notNull(),
```

- [ ] **Step 4: Add the metadata field registry and readers**

Append to `src/holdings/holding-metadata.ts` (after the `isNumber` helper, before `asContribution`):

```ts
/**
 * The metadata fields that mark a holding as owned by a sync, one per source:
 * `monobankId` (a Monobank card/jar), `walletAddress` (a BTC public-address
 * wallet), `binanceAsset` (a Binance spot balance). The single source of truth
 * for `isSyncedHolding` and for the metadata-key upserts in the holdings repo.
 */
export const syncedMetadataFields = ['monobankId', 'walletAddress', 'binanceAsset'] as const;

export type SyncedMetadataField = (typeof syncedMetadataFields)[number];

/** The balance-provider subset — everything but Monobank. */
export type ExchangeMetadataField = Exclude<SyncedMetadataField, 'monobankId'>;

/**
 * Written by a balance sync next to the provider key. It lives on the holding
 * (not `settings.lastSyncAt`) because Monobank's `lastSyncAt` doubles as the
 * statement-window cursor of the next Monobank import — a balance sync
 * touching it would silently skip Monobank transactions.
 */
export const SYNCED_AT_FIELD = 'syncedAt';

// The two stored shapes a balance sync writes (see the spec's "Data model"):
//   wallet:  { walletAddress: string; syncedAt: number }
//   Binance: { binanceAsset: 'BTC'; syncedAt: number }
// Read back through the two readers below; no separate type alias is exported
// (Knip flags an export nothing imports).

export const walletAddressOf = (metadata: unknown): string | undefined => {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const { walletAddress } = metadata;

  return typeof walletAddress === 'string' ? walletAddress : undefined;
};

export const syncedAtOf = (metadata: unknown): number | null => {
  if (!isRecord(metadata)) {
    return null;
  }

  const syncedAt = metadata[SYNCED_AT_FIELD];

  return isNumber(syncedAt) ? syncedAt : null;
};
```

- [ ] **Step 5: Create the provider module**

`src/crypto-sync/provider.ts`:

```ts
import { match } from 'ts-pattern';

import type { HoldingRow } from '../db/schema';
import type { ExchangeMetadataField } from '../holdings/holding-metadata';

/**
 * The single source of truth for the balance-provider ids. Each id doubles as
 * the `accounts.institution` value of an account connected to that provider,
 * and as a `transactions.source` literal.
 */
export const balanceProviderIds = ['btc_wallet', 'binance'] as const;

export type BalanceProviderId = (typeof balanceProviderIds)[number];

export const isBalanceProviderId = (value: string | null): value is BalanceProviderId =>
  value !== null && (balanceProviderIds as readonly string[]).includes(value);

/** Title-case display name used in UI copy and sync error messages. */
export const providerDisplayName = (providerId: BalanceProviderId): string =>
  match(providerId)
    .with('btc_wallet', () => 'Wallet')
    .with('binance', () => 'Binance')
    .exhaustive();

export type ProviderBalance = {
  /**
   * Always 'BTC' in this milestone; kept as a field, not hardcoded inline, so a
   * later multi-asset provider only widens this type.
   */
  currency: 'BTC';
  /** Satoshis. */
  balanceMinorUnits: number;
  /**
   * Provider-specific key used to match/upsert the target holding: the wallet
   * address itself, or the fixed 'BTC' asset code for Binance.
   */
  metadataKey: string;
  /**
   * Display name for the holding the first sync inserts. An existing holding
   * keeps its (possibly user-edited) name — the upsert never rewrites it.
   */
  name: string;
};

/**
 * The account a sync writes into, with its current holdings so a provider can
 * read a stored key (the wallet address) back on a re-sync.
 */
export type SyncTarget = { accountId: string; holdings: HoldingRow[] };

export interface BalanceProvider<Deps> {
  id: BalanceProviderId;
  /**
   * 'exchange' holds a secret in the Keychain; 'wallet' holds only a public
   * key in metadata. Reserved for provider-family branching (credential
   * handling, copy) as more providers land.
   */
  kind: 'exchange' | 'wallet';
  /** The `holdings.metadata` field the provider's `metadataKey` is stored under. */
  metadataField: ExchangeMetadataField;
  fetchBalances: (deps: Deps, target: SyncTarget) => Promise<ProviderBalance[]>;
}
```

- [ ] **Step 6: Widen the predicates**

Replace `src/holdings/deletable.ts`:

```ts
import { syncedMetadataFields } from './holding-metadata';
import { balanceProviderIds } from '../crypto-sync/provider';
import type { AccountRow, HoldingRow, TransactionRow } from '../db/schema';

/** Every `accounts.institution` value that marks an account as owned by a sync. */
const syncedInstitutions = ['monobank', ...balanceProviderIds] as const;

export type SyncedInstitution = (typeof syncedInstitutions)[number];

/** `manual` is the only source a user writes; every other source is a sync's. */
export const isSyncedTransaction = (row: Pick<TransactionRow, 'source'>): boolean =>
  row.source !== 'manual';

export const isSyncedHolding = (row: Pick<HoldingRow, 'metadata'>): boolean => {
  const meta = row.metadata;

  if (typeof meta !== 'object' || meta === null) {
    return false;
  }

  const record = meta as Record<string, unknown>;

  return syncedMetadataFields.some((field) => typeof record[field] === 'string');
};

export const isSyncedAccount = (row: Pick<AccountRow, 'institution'>): boolean =>
  row.institution !== null && (syncedInstitutions as readonly string[]).includes(row.institution);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest src/db/schema.test.ts src/crypto-sync/provider.test.ts src/holdings/holding-metadata.test.ts src/holdings/deletable.test.ts`
Expected: PASS (all).

- [ ] **Step 8: Confirm drizzle-kit has nothing to generate**

Run: `npx drizzle-kit generate`
Expected: `No schema changes, nothing to migrate 😴` and `git status --short drizzle/` prints nothing. SQLite text enums are TypeScript-only and the snapshots never recorded them, so there is no migration for this widening. If a file IS generated, stop: read it — it must be a no-op — and report to the coordinator before continuing; do not commit an empty migration.

- [ ] **Step 9: Lint and commit**

Run: `npm run check:lint`
Expected: silent (success).

```bash
git add src/db/schema.ts src/db/schema.test.ts src/crypto-sync/provider.ts src/crypto-sync/provider.test.ts src/holdings/holding-metadata.ts src/holdings/holding-metadata.test.ts src/holdings/deletable.ts src/holdings/deletable.test.ts
git commit -m "feat(crypto-sync): provider ids, synced-metadata registry, widened synced predicates + source enum"
```

---

### Task 2: `holdingsRepo.upsertExchange` (shared metadata-key upsert)

**Files:**
- Modify: `src/repositories/holdings.repo.ts:23-31` (types) and `:129-148` (`upsertMonobank`)
- Modify: `src/repositories/holdings.repo.test.ts` (append a `describe` block + fake tx factory)

**Interfaces:**
- Consumes: `SyncedMetadataField`, `ExchangeMetadataField` from `src/holdings/holding-metadata.ts` (Task 1); existing `nextSortOrder`, `write`, `id`, `holdings`.
- Produces: `export type ExchangeHolding = NewHolding & { metadataField: ExchangeMetadataField; metadataKey: string }` (where `NewHolding = Pick<HoldingRow, 'accountId' | 'name' | 'type' | 'currency'> & Partial<Pick<HoldingRow, 'balanceMinorUnits' | 'metadata' | 'sortOrder' | 'color'>>`); `holdingsRepo.upsertExchange(holding: ExchangeHolding): Promise<void>`. `holdingsRepo.upsertMonobank` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Append to `src/repositories/holdings.repo.test.ts`:

```ts
// A fake write-transaction handle for the metadata-key upserts. The helper
// first selects the matching holding (`select(...).from().where().limit(1)`),
// then — on a miss — reads the account's max `sort_order` (`where()` awaited
// directly) and inserts; on a hit it updates. `selectResults` answers the two
// reads in that order; every insert/update payload is captured.
const makeUpsertTx = (
  matchRows: { id: string }[],
  maxSortOrder = -1,
): { tx: unknown; inserts: Record<string, unknown>[]; updates: Record<string, unknown>[] } => {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const selectResults: unknown[][] = [matchRows, [{ value: maxSortOrder }]];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectResults.shift() ?? [];
          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { tx, inserts, updates };
};

describe('holdingsRepo.upsertExchange', () => {
  const walletHolding = {
    accountId: 'acc-crypto',
    name: 'BTC Wallet',
    type: 'crypto_asset' as const,
    currency: 'BTC' as const,
    balanceMinorUnits: 12_345_678,
    metadata: { syncedAt: 1_704_326_400_000 },
    metadataField: 'walletAddress' as const,
    metadataKey: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  };

  it('updates balance and metadata in place when a holding with the key exists', async () => {
    const { tx, inserts, updates } = makeUpsertTx([{ id: 'h-existing' }]);
    mockTx = tx;

    await holdingsRepo.upsertExchange(walletHolding);

    expect(inserts).toHaveLength(0);
    expect(updates).toEqual([
      {
        balanceMinorUnits: 12_345_678,
        metadata: {
          syncedAt: 1_704_326_400_000,
          walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        },
      },
    ]);
  });

  it('inserts a crypto_asset holding with the key merged into metadata and a fresh sortOrder on a miss', async () => {
    const { tx, inserts, updates } = makeUpsertTx([], 2);
    mockTx = tx;

    await holdingsRepo.upsertExchange(walletHolding);

    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      accountId: 'acc-crypto',
      name: 'BTC Wallet',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 12_345_678,
      sortOrder: 3,
      metadata: {
        syncedAt: 1_704_326_400_000,
        walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      },
    });
    expect(typeof inserts[0].id).toBe('string');
  });

  it('keys a Binance holding on binanceAsset', async () => {
    const { tx, inserts } = makeUpsertTx([]);
    mockTx = tx;

    await holdingsRepo.upsertExchange({
      ...walletHolding,
      name: 'Binance BTC',
      metadataField: 'binanceAsset',
      metadataKey: 'BTC',
    });

    expect(inserts[0]).toMatchObject({ metadata: { binanceAsset: 'BTC', syncedAt: 1_704_326_400_000 } });
  });

  it('defaults a missing balance to 0 on update', async () => {
    const { tx, updates } = makeUpsertTx([{ id: 'h-existing' }]);
    mockTx = tx;

    const { balanceMinorUnits: _omitted, ...withoutBalance } = walletHolding;
    await holdingsRepo.upsertExchange(withoutBalance);

    expect(updates[0]).toMatchObject({ balanceMinorUnits: 0 });
  });
});

describe('holdingsRepo.upsertMonobank (via the shared metadata-key helper)', () => {
  const cardHolding = {
    accountId: 'acc-bank',
    name: 'Black card',
    type: 'card' as const,
    currency: 'UAH' as const,
    balanceMinorUnits: 100_000,
    metadata: { iban: 'UA123', maskedPan: ['537541******1234'] },
    monobankId: 'mono-card-1',
  };

  it('updates an existing card in place, merging monobankId into its metadata', async () => {
    const { tx, inserts, updates } = makeUpsertTx([{ id: 'h-card' }]);
    mockTx = tx;

    await holdingsRepo.upsertMonobank(cardHolding);

    expect(inserts).toHaveLength(0);
    expect(updates).toEqual([
      {
        balanceMinorUnits: 100_000,
        metadata: { iban: 'UA123', maskedPan: ['537541******1234'], monobankId: 'mono-card-1' },
      },
    ]);
  });

  it('inserts a new card with monobankId merged and sortOrder = max + 1 on a miss', async () => {
    const { tx, inserts } = makeUpsertTx([], 0);
    mockTx = tx;

    await holdingsRepo.upsertMonobank(cardHolding);

    expect(inserts[0]).toMatchObject({
      type: 'card',
      sortOrder: 1,
      metadata: { iban: 'UA123', maskedPan: ['537541******1234'], monobankId: 'mono-card-1' },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/repositories/holdings.repo.test.ts`
Expected: FAIL — `holdingsRepo.upsertExchange is not a function`; the `upsertMonobank` cases pass already (they document current behavior).

- [ ] **Step 3: Implement the shared helper and `upsertExchange`**

In `src/repositories/holdings.repo.ts`, change the imports and types at the top:

```ts
import { and, asc, eq, sql } from 'drizzle-orm';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { type HoldingRow, holdings, transactions } from '../db/schema';
import { isSyncedHolding } from '../holdings/deletable';
import {
  asTermDepositMeta,
  type DepositContribution,
  type ExchangeMetadataField,
  type SyncedMetadataField,
} from '../holdings/holding-metadata';
import type { Repository } from './repository';
```

Replace the `MonobankHolding` type block (lines 26–31) with:

```ts
/**
 * A synced holding carries its source key in `metadata[metadataField]`:
 * `monobankId` for a Monobank card/jar, `walletAddress` / `binanceAsset` for a
 * balance provider. Upserts match on that key so a re-sync updates the balance
 * in place instead of duplicating the holding.
 */
type SyncedHolding = NewHolding & { metadataField: SyncedMetadataField; metadataKey: string };

type MonobankHolding = NewHolding & { monobankId: string };

export type ExchangeHolding = NewHolding & {
  metadataField: ExchangeMetadataField;
  metadataKey: string;
};

// Match on `json_extract(metadata, '$.<field>') = key`, scoped to the account;
// update balance + metadata in place on a hit, insert with a fresh sortOrder on
// a miss. The JSON path is bound as a parameter (json_extract takes any text
// expression), so this one helper serves every synced field. The holding's
// name is written only on insert — a user rename survives a re-sync.
const upsertByMetadataKey = async (
  tx: typeof database,
  { metadataField, metadataKey, metadata, ...rest }: SyncedHolding,
): Promise<void> => {
  const merged = { ...(metadata as Record<string, unknown> | null), [metadataField]: metadataKey };
  const keyMatch = sql`json_extract(${holdings.metadata}, ${`$.${metadataField}`}) = ${metadataKey}`;
  const existing = await tx
    .select({ id: holdings.id })
    .from(holdings)
    .where(and(eq(holdings.accountId, rest.accountId), keyMatch))
    .limit(1);
  const current = existing.at(0);

  if (current) {
    await tx
      .update(holdings)
      .set({ balanceMinorUnits: rest.balanceMinorUnits ?? 0, metadata: merged })
      .where(eq(holdings.id, current.id));

    return;
  }

  const sortOrder = rest.sortOrder ?? (await nextSortOrder(tx, rest.accountId));
  await tx.insert(holdings).values({ id: id(), ...rest, metadata: merged, sortOrder });
};
```

Replace the `upsertMonobank` entry (lines 129–148) with:

```ts
  upsertMonobank: ({ monobankId, ...rest }: MonobankHolding) =>
    write((tx) =>
      upsertByMetadataKey(tx, { ...rest, metadataField: 'monobankId', metadataKey: monobankId }),
    ),
  /**
   * Balance-provider counterpart of `upsertMonobank`: one live balance snapshot
   * per provider, matched on `walletAddress` / `binanceAsset`. No transaction
   * import — a wallet or exchange gives a number, not a statement.
   */
  upsertExchange: (holding: ExchangeHolding) => write((tx) => upsertByMetadataKey(tx, holding)),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/repositories/holdings.repo.test.ts src/monobank/sync.test.ts`
Expected: PASS (the Monobank sync suite still passes — it injects its own `upsertHolding`, so this is a compile/regression guard).

- [ ] **Step 5: Lint and commit**

Run: `npm run check:lint`
Expected: silent.

```bash
git add src/repositories/holdings.repo.ts src/repositories/holdings.repo.test.ts
git commit -m "feat(repo): upsertExchange — metadata-key upsert shared with upsertMonobank"
```

---
### Task 3: `accountsRepo.connectedQuery(institution)` and a provider-agnostic `disconnect`

**Files:**
- Modify: `src/repositories/accounts.repo.ts:1-7` (imports), `:47-53` (`connectedQuery`), `:94-124` (`disconnectMonobank` → `disconnect`)
- Modify: `src/repositories/accounts.repo.test.ts:53-58`, `:232-337`
- Modify: `src/monobank/disconnect.ts:19-22`
- Modify: `src/monobank/disconnect.test.ts:4-6`

**Interfaces:**
- Consumes: `SyncedInstitution`, `isSyncedHolding` from `src/holdings/deletable.ts`; `syncedMetadataFields`, `SYNCED_AT_FIELD` from `src/holdings/holding-metadata.ts` (Task 1).
- Produces: `accountsRepo.connectedQuery(institution: SyncedInstitution = 'monobank')` (query builder); `accountsRepo.disconnect(accountId: string): Promise<void>` — clears `institution`, strips every `syncedMetadataFields` key plus `syncedAt` from the account's synced holdings, leaves manual holdings untouched. `accountsRepo.disconnectMonobank` is REMOVED (its one caller, `src/monobank/disconnect.ts`, moves to `disconnect`).

- [ ] **Step 1: Write the failing tests**

In `src/repositories/accounts.repo.test.ts`, replace the `connectedQuery` test (lines 53–58) with:

```ts
  it('builds a connected query filtered on institution=monobank by default', () => {
    const query = accountsRepo.connectedQuery().toSQL();
    expect(query.sql).toContain('accounts');
    expect(query.sql).toContain('institution');
    expect(query.params).toContain('monobank');
  });

  it('builds a connected query for a balance-provider institution', () => {
    expect(accountsRepo.connectedQuery('btc_wallet').toSQL().params).toContain('btc_wallet');
    expect(accountsRepo.connectedQuery('binance').toSQL().params).toContain('binance');
  });
```

Rename the `describe('accountsRepo.disconnectMonobank', ...)` block to `describe('accountsRepo.disconnect', ...)` and every `accountsRepo.disconnectMonobank('acc-1')` call inside it to `accountsRepo.disconnect('acc-1')` (four call sites). Update the `makeDisconnectTx` doc comment's "for `disconnectMonobank`" to "for `disconnect`". Then add, inside that describe:

```ts
  it('strips walletAddress and syncedAt from a wallet-synced holding, emptying its metadata', async () => {
    const { tx, captured } = makeDisconnectTx([
      {
        id: 'btc-1',
        metadata: {
          walletAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
          syncedAt: 1_704_326_400_000,
        },
      },
    ]);
    mockTx = tx;

    await accountsRepo.disconnect('acc-crypto');

    expect(captured.updates).toEqual([
      { table: accounts, set: { institution: null } },
      { table: holdings, set: { metadata: null } },
    ]);
  });

  it('strips binanceAsset and syncedAt but keeps unrelated metadata keys', async () => {
    const { tx, captured } = makeDisconnectTx([
      { id: 'bnb-1', metadata: { binanceAsset: 'BTC', syncedAt: 1_704_326_400_000, note: 'spot' } },
    ]);
    mockTx = tx;

    await accountsRepo.disconnect('acc-crypto');

    expect(captured.updates[1]).toEqual({ table: holdings, set: { metadata: { note: 'spot' } } });
  });
```

In `src/monobank/disconnect.test.ts`, change the mock (lines 4–6) to:

```ts
jest.mock('../repositories/accounts.repo', () => ({
  accountsRepo: { disconnect: (id: string) => mockDisconnectAccount(id) },
}));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/repositories/accounts.repo.test.ts src/monobank/disconnect.test.ts`
Expected: FAIL — `accountsRepo.disconnect is not a function`; `connectedQuery('btc_wallet')` still binds `'monobank'`; the monobank disconnect test fails because `disconnectMonobank` is not on the mock.

- [ ] **Step 3: Implement**

In `src/repositories/accounts.repo.ts`, imports (lines 1–7) become:

```ts
import { asc, eq, sql } from 'drizzle-orm';
import type { Currency } from '../currency/currency';
import { database, write } from '../db/client';
import { id } from '../db/id';
import { type AccountRow, accounts, holdings, transactions } from '../db/schema';
import { isSyncedAccount, isSyncedHolding, type SyncedInstitution } from '../holdings/deletable';
import { SYNCED_AT_FIELD, syncedMetadataFields } from '../holdings/holding-metadata';
import type { Repository } from './repository';
```

Add, after the `NewCashAccount` type (before `export const accountsRepo`):

```ts
// The metadata keys a disconnect strips: every sync-ownership marker plus the
// balance-sync `syncedAt` stamp, so a disconnected holding reads as manual and
// carries no stale sync bookkeeping. Every other key (iban, maskedPan, …) stays.
const strippedOnDisconnect: readonly string[] = [...syncedMetadataFields, SYNCED_AT_FIELD];

const withoutSyncMetadata = (
  metadata: Record<string, unknown>,
): Record<string, unknown> | null => {
  const kept = Object.entries(metadata).filter(([key]) => !strippedOnDisconnect.includes(key));

  return kept.length > 0 ? Object.fromEntries(kept) : null;
};
```

Replace `connectedQuery` (lines 47–53) with:

```ts
  /**
   * The account(s) connected under one institution — Monobank by default, or a
   * balance provider (`'btc_wallet'` / `'binance'`). The one-connection-per-
   * institution invariant means this yields at most one row; the UI uses it to
   * hide "Connect" on every other account while one is connected.
   */
  connectedQuery: (institution: SyncedInstitution = 'monobank') =>
    database.select().from(accounts).where(eq(accounts.institution, institution)),
```

Replace `disconnectMonobank` (lines 94–124) with:

```ts
  /**
   * Disconnect a synced account (Monobank, wallet, or Binance), turning it into
   * a plain manual account whose data is kept as a historical snapshot. In ONE
   * op-sqlite transaction: clear the account's `institution` (so
   * `isSyncedAccount` is false and `remove` accepts it), and strip every sync
   * key (`monobankId` / `walletAddress` / `binanceAsset`) plus `syncedAt` from
   * each synced holding's metadata (so `isSyncedHolding` is false and the
   * holding becomes manual). Balances, holdings and transactions are left as-is;
   * manual holdings under the account are untouched. Clearing a Keychain item
   * is NOT done here — the Keychain is not transactional; the
   * `monobank/disconnect` and `crypto-sync/disconnect` operations compose both.
   */
  disconnect: (accountId: string) =>
    write(async (tx) => {
      await tx.update(accounts).set({ institution: null }).where(eq(accounts.id, accountId));
      const accountHoldings = await tx
        .select()
        .from(holdings)
        .where(eq(holdings.accountId, accountId));

      for (const holding of accountHoldings) {
        if (!isSyncedHolding(holding)) {
          continue;
        }

        await tx
          .update(holdings)
          .set({ metadata: withoutSyncMetadata(holding.metadata as Record<string, unknown>) })
          .where(eq(holdings.id, holding.id));
      }
    }),
```

(`isSyncedHolding` returning `true` guarantees `metadata` is a non-null object, so the cast is sound.)

In `src/monobank/disconnect.ts` line 20, change `await accountsRepo.disconnectMonobank(accountId);` to `await accountsRepo.disconnect(accountId);` and in its doc comment replace "`accountsRepo.disconnectMonobank`" with "`accountsRepo.disconnect`".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/repositories/accounts.repo.test.ts src/monobank/disconnect.test.ts src/screens/use-auto-sync.test.ts src/screens/account-detail/account-detail.screen.test.tsx`
Expected: PASS — the two existing consumers of `connectedQuery()` (auto-sync, account detail) are unaffected by the defaulted parameter.

- [ ] **Step 5: Lint and commit**

Run: `npm run check:lint`
Expected: silent.

```bash
git add src/repositories/accounts.repo.ts src/repositories/accounts.repo.test.ts src/monobank/disconnect.ts src/monobank/disconnect.test.ts
git commit -m "feat(repo): connectedQuery per institution; generalize disconnect to every synced source"
```

---

### Task 4: `runBalanceSync` — the generic balance-sync driver

**Files:**
- Create: `src/crypto-sync/sync.ts`
- Create: `src/crypto-sync/sync.test.ts`

**Interfaces:**
- Consumes: `BalanceProvider`, `BalanceProviderId`, `ProviderBalance`, `SyncTarget`, `providerDisplayName` (Task 1); `ExchangeHolding`, `holdingsRepo.upsertExchange` (Task 2); `accountsRepo.listQuery/update`, `holdingsRepo.listByAccountQuery`; `AccountRow`, `HoldingRow`.
- Produces:
  ```ts
  export interface BalanceSyncDeps {
    now: () => number;
    targetAccountId?: string;
    listAccounts: () => Promise<AccountRow[]>;
    updateAccount: (accountId: string, patch: Partial<AccountRow>) => Promise<unknown>;
    listHoldingsByAccount: (accountId: string) => Promise<HoldingRow[]>;
    upsertHolding: (holding: ExchangeHolding) => Promise<unknown>;
  }
  type BalanceSyncResult = { syncedHoldings: number }; // NOT exported until Task 11 needs it (Knip flags an export only used in its own file)
  export const runBalanceSync: <Deps>(provider: BalanceProvider<Deps>, providerDeps: Deps, overrides?: Partial<BalanceSyncDeps>) => Promise<BalanceSyncResult>;
  ```
  Error messages: `` `No ${providerDisplayName(id)} connection found` `` and `` `${providerDisplayName(id)} is already connected to another account` ``.

- [ ] **Step 1: Write the failing test**

`src/crypto-sync/sync.test.ts`:

```ts
// op-sqlite's open() calls a native module unavailable under Jest, and sync.ts
// imports the repos which open the connection at load. A minimal stub lets the
// module graph load; runBalanceSync's data access is fully injected through
// BalanceSyncDeps, so the real repos are never exercised here.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import type { AccountRow, HoldingRow } from '../db/schema';
import type { BalanceProvider, ProviderBalance, SyncTarget } from './provider';
import { type BalanceSyncDeps, runBalanceSync } from './sync';

const NOW = 1_704_326_400_000;
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const cryptoAccount = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'acc-1',
  name: 'Cold storage',
  kind: 'crypto',
  institution: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  ...overrides,
});

const walletBalance = (balanceMinorUnits: number): ProviderBalance => ({
  currency: 'BTC',
  balanceMinorUnits,
  metadataKey: ADDRESS,
  name: 'BTC Wallet',
});

type FakeDeps = { balances: ProviderBalance[] | Error };

/**
 * A wallet-shaped provider whose result is injected through its deps; records
 * every `fetchBalances` call so a test can assert how often and with which
 * target it ran. Throws when `balances` is an Error, to model a failed fetch.
 */
const makeProvider = () => {
  const calls: SyncTarget[] = [];
  const provider: BalanceProvider<FakeDeps> = {
    id: 'btc_wallet',
    kind: 'wallet',
    metadataField: 'walletAddress',
    fetchBalances: async (deps, target) => {
      calls.push(target);

      if (deps.balances instanceof Error) {
        throw deps.balances;
      }

      return deps.balances;
    },
  };

  return { provider, calls };
};

/**
 * A faithful in-memory double of the injected seams: holdings upsert on
 * (accountId, metadata[metadataField] === metadataKey) — the same key the real
 * `upsertExchange` matches on.
 */
const makeInMemoryDeps = (initialAccounts: AccountRow[]) => {
  const accountsStore: AccountRow[] = initialAccounts.map((account) => ({ ...account }));
  const holdingsStore: HoldingRow[] = [];
  let sequence = 0;

  const upsertHolding: BalanceSyncDeps['upsertHolding'] = async ({
    metadataField,
    metadataKey,
    metadata,
    ...rest
  }) => {
    const merged = { ...(metadata as Record<string, unknown> | null), [metadataField]: metadataKey };
    const existing = holdingsStore.find(
      (holding) =>
        holding.accountId === rest.accountId &&
        (holding.metadata as Record<string, unknown>)[metadataField] === metadataKey,
    );

    if (existing) {
      existing.balanceMinorUnits = rest.balanceMinorUnits ?? 0;
      existing.metadata = merged;

      return;
    }

    sequence += 1;
    holdingsStore.push({
      id: `h-${sequence}`,
      icon: null,
      color: null,
      sortOrder: 0,
      closedAt: null,
      createdAt: 0,
      balanceMinorUnits: rest.balanceMinorUnits ?? 0,
      ...rest,
      metadata: merged,
    });
  };

  const deps: Partial<BalanceSyncDeps> = {
    now: () => NOW,
    listAccounts: async () => accountsStore.map((account) => ({ ...account })),
    updateAccount: async (accountId, patch) => {
      const target = accountsStore.find((account) => account.id === accountId);

      if (target) {
        Object.assign(target, patch);
      }
    },
    listHoldingsByAccount: async (accountId) =>
      holdingsStore
        .filter((holding) => holding.accountId === accountId)
        .map((holding) => ({ ...holding })),
    upsertHolding,
  };

  return { deps, accountsStore, holdingsStore };
};

describe('runBalanceSync', () => {
  it('marks the target account with the provider id and upserts one BTC crypto_asset holding stamped syncedAt', async () => {
    const { provider, calls } = makeProvider();
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps([cryptoAccount()]);
    deps.targetAccountId = 'acc-1';

    const result = await runBalanceSync(provider, { balances: [walletBalance(12_345_678)] }, deps);

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(accountsStore).toHaveLength(1);
    expect(accountsStore[0].institution).toBe('btc_wallet');
    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0]).toMatchObject({
      accountId: 'acc-1',
      name: 'BTC Wallet',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 12_345_678,
      metadata: { walletAddress: ADDRESS, syncedAt: NOW },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ accountId: 'acc-1', holdings: [] });
  });

  it('with no target id, syncs into the account already connected under the provider institution and hands it its holdings', async () => {
    const { provider, calls } = makeProvider();
    const { deps, holdingsStore } = makeInMemoryDeps([
      cryptoAccount({ id: 'acc-wallet', institution: 'btc_wallet' }),
      cryptoAccount({ id: 'acc-other', institution: null }),
    ]);

    await runBalanceSync(provider, { balances: [walletBalance(1)] }, deps);
    await runBalanceSync(provider, { balances: [walletBalance(2)] }, deps);

    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0].accountId).toBe('acc-wallet');
    expect(holdingsStore[0].balanceMinorUnits).toBe(2);
    // the second run saw the holding the first one created
    expect(calls[1].holdings.map((holding) => holding.id)).toEqual(['h-1']);
  });

  it('throws when neither a target id nor a connected account exists, calling the provider never', async () => {
    const { provider, calls } = makeProvider();
    const { deps, holdingsStore } = makeInMemoryDeps([cryptoAccount({ institution: null })]);

    await expect(runBalanceSync(provider, { balances: [walletBalance(1)] }, deps)).rejects.toThrow(
      'No Wallet connection found',
    );
    expect(calls).toHaveLength(0);
    expect(holdingsStore).toHaveLength(0);
  });

  it('throws when the target id matches no account', async () => {
    const { provider } = makeProvider();
    const { deps } = makeInMemoryDeps([cryptoAccount()]);
    deps.targetAccountId = 'acc-missing';

    await expect(runBalanceSync(provider, { balances: [walletBalance(1)] }, deps)).rejects.toThrow(
      'No Wallet connection found',
    );
  });

  it('rejects connecting a second account while another holds the same institution, writing nothing', async () => {
    const { provider, calls } = makeProvider();
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps([
      cryptoAccount({ id: 'acc-a', institution: 'btc_wallet' }),
      cryptoAccount({ id: 'acc-b', institution: null }),
    ]);
    deps.targetAccountId = 'acc-b';

    await expect(runBalanceSync(provider, { balances: [walletBalance(1)] }, deps)).rejects.toThrow(
      'Wallet is already connected to another account',
    );
    expect(accountsStore.find((account) => account.id === 'acc-b')?.institution).toBeNull();
    expect(holdingsStore).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('lets a wallet connection coexist with a Binance connection on another account', async () => {
    const { provider } = makeProvider();
    const { deps, accountsStore } = makeInMemoryDeps([
      cryptoAccount({ id: 'acc-binance', institution: 'binance' }),
      cryptoAccount({ id: 'acc-wallet', institution: null }),
    ]);
    deps.targetAccountId = 'acc-wallet';

    await runBalanceSync(provider, { balances: [walletBalance(1)] }, deps);

    expect(accountsStore.map((account) => account.institution)).toEqual(['binance', 'btc_wallet']);
  });

  it('allows re-connecting the SAME connected account (idempotent re-sync) and updates the holding in place', async () => {
    const { provider } = makeProvider();
    const { deps, holdingsStore } = makeInMemoryDeps([
      cryptoAccount({ id: 'acc-1', institution: 'btc_wallet' }),
    ]);
    deps.targetAccountId = 'acc-1';

    await runBalanceSync(provider, { balances: [walletBalance(10)] }, deps);
    await runBalanceSync(provider, { balances: [walletBalance(20)] }, deps);

    expect(holdingsStore).toHaveLength(1);
    expect(holdingsStore[0].balanceMinorUnits).toBe(20);
  });

  it('leaves the target account unmarked and writes nothing when the provider fetch fails', async () => {
    const { provider } = makeProvider();
    const { deps, accountsStore, holdingsStore } = makeInMemoryDeps([cryptoAccount()]);
    deps.targetAccountId = 'acc-1';

    await expect(
      runBalanceSync(provider, { balances: new Error('Block explorer request failed: 400') }, deps),
    ).rejects.toThrow('Block explorer request failed: 400');
    expect(accountsStore[0].institution).toBeNull();
    expect(holdingsStore).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/crypto-sync/sync.test.ts`
Expected: FAIL — `Cannot find module './sync'`.

- [ ] **Step 3: Implement the driver**

`src/crypto-sync/sync.ts`:

```ts
import type { AccountRow, HoldingRow } from '../db/schema';
import { accountsRepo } from '../repositories/accounts.repo';
import { type ExchangeHolding, holdingsRepo } from '../repositories/holdings.repo';
import { type BalanceProvider, type BalanceProviderId, providerDisplayName } from './provider';

/**
 * The injectable data-access seams of a balance sync. Mirrors `SyncDeps` in
 * `monobank/sync.ts` minus everything statement-shaped: a balance sync is one
 * snapshot per provider, so there is no pagination, throttling or transaction
 * import here. Provider-specific seams (network, credentials) live on the
 * provider's own `Deps`, passed through untouched.
 */
export interface BalanceSyncDeps {
  now: () => number;
  /**
   * The user-created account to (re)target this sync at. When set, the account
   * is marked `institution: provider.id` (the Connect action). When absent, the
   * sync targets the account already connected under that institution.
   */
  targetAccountId?: string;
  listAccounts: () => Promise<AccountRow[]>;
  updateAccount: (accountId: string, patch: Partial<AccountRow>) => Promise<unknown>;
  listHoldingsByAccount: (accountId: string) => Promise<HoldingRow[]>;
  upsertHolding: (holding: ExchangeHolding) => Promise<unknown>;
}

// Exported in Task 11, when `runCryptoSync` first needs to name it.
type BalanceSyncResult = { syncedHoldings: number };

const defaultDeps: BalanceSyncDeps = {
  now: () => Date.now(),
  listAccounts: async () => accountsRepo.listQuery(),
  updateAccount: (accountId, patch) => accountsRepo.update(accountId, patch),
  listHoldingsByAccount: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  upsertHolding: (holding) => holdingsRepo.upsertExchange(holding),
};

/**
 * Resolve the account this sync writes into, mirroring `ensureMonobankAccount`
 * but scoped per institution: one connection per provider id, so a wallet and
 * a Binance connection coexist as two accounts while two wallet connections
 * cannot silently double-count. Re-connecting the SAME account is an
 * idempotent re-sync. This only reads — marking happens after a successful
 * fetch, so a failed fetch never leaves a half-connected account behind.
 */
const resolveTargetAccount = async (
  deps: BalanceSyncDeps,
  providerId: BalanceProviderId,
): Promise<string> => {
  const accounts = await deps.listAccounts();
  const name = providerDisplayName(providerId);

  if (deps.targetAccountId !== undefined) {
    const target = accounts.find((account) => account.id === deps.targetAccountId);

    if (!target) {
      throw new Error(`No ${name} connection found`);
    }

    const otherConnected = accounts.find(
      (account) => account.institution === providerId && account.id !== deps.targetAccountId,
    );

    if (otherConnected) {
      throw new Error(`${name} is already connected to another account`);
    }

    return deps.targetAccountId;
  }

  const existing = accounts.find((account) => account.institution === providerId);

  if (!existing) {
    throw new Error(`No ${name} connection found`);
  }

  return existing.id;
};

/**
 * One balance sync: resolve the target account, fetch the provider's balance
 * snapshot, mark the account with the provider's institution, and upsert one
 * `crypto_asset` holding per returned balance, keyed on the provider's
 * metadata field and stamped `syncedAt`. No `transactions` rows are written —
 * a wallet or exchange gives a live number, not a ledger.
 */
export const runBalanceSync = async <Deps>(
  provider: BalanceProvider<Deps>,
  providerDeps: Deps,
  overrides: Partial<BalanceSyncDeps> = {},
): Promise<BalanceSyncResult> => {
  const deps: BalanceSyncDeps = { ...defaultDeps, ...overrides };
  const accountId = await resolveTargetAccount(deps, provider.id);
  const holdings = await deps.listHoldingsByAccount(accountId);
  const balances = await provider.fetchBalances(providerDeps, { accountId, holdings });

  await deps.updateAccount(accountId, { institution: provider.id });
  const syncedAt = deps.now();

  for (const balance of balances) {
    await deps.upsertHolding({
      accountId,
      name: balance.name,
      type: 'crypto_asset',
      currency: balance.currency,
      balanceMinorUnits: balance.balanceMinorUnits,
      metadata: { syncedAt },
      metadataField: provider.metadataField,
      metadataKey: balance.metadataKey,
    });
  }

  return { syncedHoldings: balances.length };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/crypto-sync/sync.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: CHECKPOINT — full suite + harness**

Run: `npx jest`
Expected: PASS.

Run: `npm run check:all`
Expected: silent. Knip counts a test file's imports as usage, so every export added so far (`SyncTarget`, `isBalanceProviderId`, `providerDisplayName`, `syncedAtOf`, `walletAddressOf`, `upsertExchange`, `runBalanceSync`, …) is referenced by app code or a colocated test. If Knip still names an export, the fix is to import it in the test that exercises it (or to drop the `export`) — never an ignore entry.

- [ ] **Step 6: Commit**

```bash
git add src/crypto-sync/sync.ts src/crypto-sync/sync.test.ts
git commit -m "feat(crypto-sync): runBalanceSync — generic provider-driven balance snapshot sync"
```

---
## Phase B — Provider 1: BTC public-address wallet

### Task 5: Explorer endpoint config + `fetchAddressBalance`

**Files:**
- Modify: `.env`, `.env.example`, `src/env.d.ts`
- Create: `src/crypto-sync/btc-wallet/btc-wallet.client.ts`
- Create: `src/crypto-sync/btc-wallet/btc-wallet.client.test.ts`

**Interfaces:**
- Consumes: `guard` from `fnts` (same pattern as `src/rates/coingecko.ts`), `BTC_EXPLORER_ENDPOINT` from `@env`.
- Produces: `fetchAddressBalance(address: string, fetchImpl?: typeof fetch): Promise<number>` — confirmed on-chain satoshis (`chain_stats.funded_txo_sum - chain_stats.spent_txo_sum`); throws `Block explorer request failed: <status>` on a non-ok response.

- [ ] **Step 1: Add the endpoint to the env files**

Append to `.env`:

```
# Esplora-compatible block explorer (Blockstream) for a BTC address's on-chain balance.
BTC_EXPLORER_ENDPOINT=https://blockstream.info/api
```

Append the same two lines to `.env.example`. In `src/env.d.ts` add inside the `declare module '@env'` block:

```ts
  export const BTC_EXPLORER_ENDPOINT: string;
```

- [ ] **Step 2: Write the failing test**

`src/crypto-sync/btc-wallet/btc-wallet.client.test.ts`:

```ts
import { fetchAddressBalance } from './btc-wallet.client';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const esploraBody = (fundedSatoshis: number, spentSatoshis: number) => ({
  address: ADDRESS,
  chain_stats: {
    funded_txo_count: 3,
    funded_txo_sum: fundedSatoshis,
    spent_txo_count: 1,
    spent_txo_sum: spentSatoshis,
    tx_count: 4,
  },
  mempool_stats: {
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 0,
  },
});

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 400 })) as unknown as typeof fetch;

describe('fetchAddressBalance', () => {
  it('requests the Esplora address endpoint for the given address', async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => esploraBody(0, 0), status: 200 };
    }) as unknown as typeof fetch;

    await fetchAddressBalance(ADDRESS, spyFetch);

    expect(sentUrl).toBe(`https://blockstream.info/api/address/${ADDRESS}`);
  });

  it('returns funded minus spent satoshis from chain_stats', async () => {
    const result = await fetchAddressBalance(ADDRESS, makeFetch(esploraBody(150_000_000, 37_654_322)));

    expect(result).toBe(112_345_678);
  });

  it('ignores mempool (unconfirmed) stats', async () => {
    const body = esploraBody(100, 40);
    body.mempool_stats.funded_txo_sum = 1_000_000;

    expect(await fetchAddressBalance(ADDRESS, makeFetch(body))).toBe(60);
  });

  it('throws with the status on a non-ok response', async () => {
    await expect(fetchAddressBalance(ADDRESS, makeFetch({}, false))).rejects.toThrow(
      'Block explorer request failed: 400',
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/crypto-sync/btc-wallet/btc-wallet.client.test.ts`
Expected: FAIL — `Cannot find module './btc-wallet.client'`. (If instead Babel reports `BTC_EXPLORER_ENDPOINT` missing from `.env` once the module exists, run `npx jest --clearCache` and retry.)

- [ ] **Step 4: Implement the client**

`src/crypto-sync/btc-wallet/btc-wallet.client.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/crypto-sync/btc-wallet/btc-wallet.client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Lint and commit**

Run: `npm run check:lint`
Expected: silent.

```bash
git add .env .env.example src/env.d.ts src/crypto-sync/btc-wallet/btc-wallet.client.ts src/crypto-sync/btc-wallet/btc-wallet.client.test.ts
git commit -m "feat(crypto-sync): Esplora address-balance client"
```

---

### Task 6: Address validation + the wallet provider

**Files:**
- Create: `src/crypto-sync/btc-wallet/bitcoin-address.ts`, `src/crypto-sync/btc-wallet/bitcoin-address.test.ts`
- Create: `src/crypto-sync/btc-wallet/btc-wallet.provider.ts`, `src/crypto-sync/btc-wallet/btc-wallet.provider.test.ts`

**Interfaces:**
- Consumes: `BalanceProvider`, `SyncTarget` (Task 1); `walletAddressOf` (Task 1); `fetchAddressBalance` (Task 5); `HoldingRow`.
- Produces:
  ```ts
  export const isValidBitcoinAddress: (value: string) => boolean;
  export type BitcoinWalletDeps = {
    fetchImpl: typeof fetch;
    fetchAddressBalance: (address: string, fetchImpl?: typeof fetch) => Promise<number>;
    address?: string; // Connect action only; re-syncs read metadata.walletAddress
  };
  export const defaultBitcoinWalletDeps: BitcoinWalletDeps;
  export const bitcoinWalletProvider: BalanceProvider<BitcoinWalletDeps>; // id 'btc_wallet', kind 'wallet', metadataField 'walletAddress'
  ```
  Errors: `No wallet address stored; connect a wallet before syncing`, `Invalid BTC address`. Holding name: `'BTC Wallet'`.

- [ ] **Step 1: Write the failing tests**

`src/crypto-sync/btc-wallet/bitcoin-address.test.ts`:

```ts
import { isValidBitcoinAddress } from './bitcoin-address';

describe('isValidBitcoinAddress', () => {
  it.each([
    ['legacy P2PKH', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    ['P2SH', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
    ['bech32 P2WPKH', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    ['bech32m P2TR', 'bc1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5sspknck9'],
  ])('accepts a %s mainnet address', (_label, address) => {
    expect(isValidBitcoinAddress(address)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['testnet bech32', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'],
    ['bad leading char', '0A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    ['mixed-case bech32', 'bc1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ'],
    ['non-base58 char', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa!'],
    ['too short', '1abc'],
    ['free text', 'not an address'],
  ])('rejects %s', (_label, address) => {
    expect(isValidBitcoinAddress(address)).toBe(false);
  });
});
```

`src/crypto-sync/btc-wallet/btc-wallet.provider.test.ts`:

```ts
import type { HoldingRow } from '../../db/schema';
import type { SyncTarget } from '../provider';
import { fetchAddressBalance } from './btc-wallet.client';
import {
  type BitcoinWalletDeps,
  bitcoinWalletProvider,
  defaultBitcoinWalletDeps,
} from './btc-wallet.provider';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const holdingWith = (metadata: unknown): HoldingRow => ({
  id: 'h-1',
  accountId: 'acc-1',
  name: 'BTC Wallet',
  type: 'crypto_asset',
  currency: 'BTC',
  icon: null,
  color: null,
  balanceMinorUnits: 0,
  metadata,
  sortOrder: 0,
  closedAt: null,
  createdAt: 0,
});

const target = (holdings: HoldingRow[] = []): SyncTarget => ({ accountId: 'acc-1', holdings });

const makeDeps = (satoshis = 12_345_678): BitcoinWalletDeps & { fetchAddressBalance: jest.Mock } => ({
  fetchImpl: (async () => ({ ok: true })) as unknown as typeof fetch,
  fetchAddressBalance: jest.fn(async () => satoshis),
});

describe('bitcoinWalletProvider', () => {
  it('is the btc_wallet provider keyed on walletAddress', () => {
    expect(bitcoinWalletProvider.id).toBe('btc_wallet');
    expect(bitcoinWalletProvider.kind).toBe('wallet');
    expect(bitcoinWalletProvider.metadataField).toBe('walletAddress');
  });

  it('wires the real explorer client and global fetch as its default deps', () => {
    expect(defaultBitcoinWalletDeps.fetchAddressBalance).toBe(fetchAddressBalance);
    expect(defaultBitcoinWalletDeps.fetchImpl).toBe(fetch);
    expect(defaultBitcoinWalletDeps.address).toBeUndefined();
  });

  it('fetches the connect-time address and returns one BTC balance keyed on that address', async () => {
    const deps = makeDeps(12_345_678);

    const balances = await bitcoinWalletProvider.fetchBalances({ ...deps, address: ADDRESS }, target());

    expect(deps.fetchAddressBalance).toHaveBeenCalledWith(ADDRESS, deps.fetchImpl);
    expect(balances).toEqual([
      { currency: 'BTC', balanceMinorUnits: 12_345_678, metadataKey: ADDRESS, name: 'BTC Wallet' },
    ]);
  });

  it('trims surrounding whitespace from a pasted address', async () => {
    const deps = makeDeps();

    const balances = await bitcoinWalletProvider.fetchBalances(
      { ...deps, address: `  ${ADDRESS}\n` },
      target(),
    );

    expect(deps.fetchAddressBalance).toHaveBeenCalledWith(ADDRESS, deps.fetchImpl);
    expect(balances[0].metadataKey).toBe(ADDRESS);
  });

  it('falls back to the stored walletAddress of the target holdings on a re-sync', async () => {
    const deps = makeDeps(42);

    const balances = await bitcoinWalletProvider.fetchBalances(
      deps,
      target([holdingWith({ iban: 'UA1' }), holdingWith({ walletAddress: ADDRESS, syncedAt: 1 })]),
    );

    expect(deps.fetchAddressBalance).toHaveBeenCalledWith(ADDRESS, deps.fetchImpl);
    expect(balances[0].balanceMinorUnits).toBe(42);
  });

  it('throws before fetching when no address is given and none is stored', async () => {
    const deps = makeDeps();

    await expect(bitcoinWalletProvider.fetchBalances(deps, target([holdingWith(null)]))).rejects.toThrow(
      /connect a wallet/i,
    );
    expect(deps.fetchAddressBalance).not.toHaveBeenCalled();
  });

  it('rejects an obviously malformed address before any fetch', async () => {
    const deps = makeDeps();

    await expect(
      bitcoinWalletProvider.fetchBalances({ ...deps, address: 'not an address' }, target()),
    ).rejects.toThrow('Invalid BTC address');
    expect(deps.fetchAddressBalance).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/crypto-sync/btc-wallet/bitcoin-address.test.ts src/crypto-sync/btc-wallet/btc-wallet.provider.test.ts`
Expected: FAIL — both modules missing.

- [ ] **Step 3: Implement the format check**

`src/crypto-sync/btc-wallet/bitcoin-address.ts`:

```ts
// Mainnet address formats only. Legacy P2PKH / P2SH are base58 (`1…` / `3…`,
// 26–35 chars, alphabet without 0/O/I/l); bech32 / bech32m are `bc1…` in the
// lowercase bech32 alphabet (no 1/b/i/o). This is a FORMAT check, not a
// checksum — enough to fail fast on an obvious typo before the explorer call,
// which is the spec's stated purpose. Testnet (`tb1…`, `m…`, `n…`, `2…`) is
// rejected on purpose: the explorer endpoint is mainnet.
const BASE58_ADDRESS = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BECH32_ADDRESS = /^bc1[ac-hj-np-z02-9]{11,71}$/;

export const isValidBitcoinAddress = (value: string): boolean =>
  BASE58_ADDRESS.test(value) || BECH32_ADDRESS.test(value);
```

- [ ] **Step 4: Implement the provider**

`src/crypto-sync/btc-wallet/btc-wallet.provider.ts`:

```ts
import type { HoldingRow } from '../../db/schema';
import { walletAddressOf } from '../../holdings/holding-metadata';
import type { BalanceProvider } from '../provider';
import { isValidBitcoinAddress } from './bitcoin-address';
import { fetchAddressBalance } from './btc-wallet.client';

export type BitcoinWalletDeps = {
  fetchImpl: typeof fetch;
  fetchAddressBalance: (address: string, fetchImpl?: typeof fetch) => Promise<number>;
  /**
   * The address to connect (the Connect action). Absent on a re-sync, where the
   * address stored in the holding's `metadata.walletAddress` is read instead.
   * A public address is not a secret, so nothing here touches the Keychain.
   */
  address?: string;
};

export const defaultBitcoinWalletDeps: BitcoinWalletDeps = { fetchImpl: fetch, fetchAddressBalance };

/** Display name of the holding the first sync creates. */
const WALLET_HOLDING_NAME = 'BTC Wallet';

const storedAddress = (holdings: HoldingRow[]): string | undefined =>
  holdings.map((holding) => walletAddressOf(holding.metadata)).find((address) => address !== undefined);

export const bitcoinWalletProvider: BalanceProvider<BitcoinWalletDeps> = {
  id: 'btc_wallet',
  kind: 'wallet',
  metadataField: 'walletAddress',
  fetchBalances: async (deps, target) => {
    const address = (deps.address ?? storedAddress(target.holdings))?.trim();

    if (address === undefined) {
      throw new Error('No wallet address stored; connect a wallet before syncing');
    }

    if (!isValidBitcoinAddress(address)) {
      throw new Error('Invalid BTC address');
    }

    const balanceMinorUnits = await deps.fetchAddressBalance(address, deps.fetchImpl);

    return [{ currency: 'BTC', balanceMinorUnits, metadataKey: address, name: WALLET_HOLDING_NAME }];
  },
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/crypto-sync/btc-wallet`
Expected: PASS (all three wallet suites).

- [ ] **Step 6: CHECKPOINT — full suite + harness**

Run: `npx jest` then `npm run check:all`
Expected: PASS; silent. (Every wallet export is imported by a colocated test, so Knip stays green before Task 11 wires the providers into app code.)

- [ ] **Step 7: Commit**

```bash
git add src/crypto-sync/btc-wallet
git commit -m "feat(crypto-sync): BTC public-address wallet provider with address format check"
```

---
## Phase C — Provider 2: Binance (read-only, BTC only)

### Task 7: `@noble/hashes` + `signQuery` (HMAC-SHA256)

**Dependency approval:** this task adds `@noble/hashes` (pure JS, zero dependencies, audited; `"type": "module"`, ESM-only). The coordinator confirms the dependency with the user before this task starts (see memory: deps are user-approved). No native pod is added. The `.npmrc` 7-day min-release-age applies automatically (`2.4.0` published 2026-08-27 qualifies).

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)
- Modify: `jest.config.js:16-18` (`transformIgnorePatterns`)
- Create: `src/crypto-sync/binance/binance.hmac.ts`, `src/crypto-sync/binance/binance.hmac.test.ts`

**Interfaces:**
- Produces: `signQuery(secret: string, query: string): string` — 64 lowercase hex chars, HMAC-SHA256 of the UTF-8 query under the UTF-8 secret.

- [ ] **Step 1: Install and exempt from Jest's transform ignore**

Run: `npm install @noble/hashes`
Expected: `package.json` `dependencies` gains `"@noble/hashes": "^2.4.0"` (or the newest version at least 7 days old); no peer warnings.

In `jest.config.js`, extend the comment and the pattern:

```js
  // react-native-gesture-handler, react-native-reanimated (its Jest mock pulls
  // in the package's own ESM source), react-native-worklets, and
  // react-native-sortables all ship untranspiled ESM (`import`), so each is
  // exempted from the preset's transform-ignore list for the drag-and-drop
  // grids to load under Babel/Jest. @noble/hashes (the Binance HMAC signer) is
  // ESM-only ("type": "module") for the same reason.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|fnts|react-native-unistyles|react-native-gesture-handler|react-native-reanimated|react-native-worklets|react-native-sortables|@noble)/)',
  ],
```

- [ ] **Step 2: Write the failing test**

`src/crypto-sync/binance/binance.hmac.test.ts`. Binding names deliberately avoid the words `key`, `secret`, `token`, `api`, `auth`, `password` next to a high-entropy literal — gitleaks' `generic-api-key` rule keys on `<keyword> … = '<entropy>'`, and the Binance documentation example below is public but high-entropy. Never rename these to `secret =` / `apiKey =`.

```ts
import { signQuery } from './binance.hmac';

// RFC 4231 §4.3 test case 2 (HMAC-SHA-256).
const RFC4231_CASE_2 = {
  signer: 'Jefe',
  data: 'what do ya want for nothing?',
  digest: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
};

// Binance "Request security" documentation example (public sample values):
// https://developers.binance.com/docs/binance-spot-api-docs/rest-api/request-security
const BINANCE_DOCS_EXAMPLE = {
  signer: 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j',
  data: 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559',
  digest: 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71',
};

describe('signQuery', () => {
  it('matches the RFC 4231 HMAC-SHA-256 test vector', () => {
    expect(signQuery(RFC4231_CASE_2.signer, RFC4231_CASE_2.data)).toBe(RFC4231_CASE_2.digest);
  });

  it("matches Binance's documented request-signing example", () => {
    expect(signQuery(BINANCE_DOCS_EXAMPLE.signer, BINANCE_DOCS_EXAMPLE.data)).toBe(
      BINANCE_DOCS_EXAMPLE.digest,
    );
  });

  it('signs an account query the way the client builds it', () => {
    // openssl dgst -sha256 -hmac 'secret-fixture' over the same query string.
    expect(signQuery('secret-fixture', 'timestamp=1704326400000&recvWindow=5000')).toBe(
      'c548b5a5c27c61b57b685766340cfe11dff7cb5d0a693484f3af3e13f129df7f',
    );
  });

  it('returns 64 lowercase hex characters', () => {
    expect(signQuery('a', 'b')).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/crypto-sync/binance/binance.hmac.test.ts`
Expected: FAIL — `Cannot find module './binance.hmac'`.

- [ ] **Step 4: Implement**

`src/crypto-sync/binance/binance.hmac.ts`:

```ts
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Sign a Binance query string: the lowercase-hex HMAC-SHA256 of the query under
 * the API secret, which the caller appends as `&signature=`. Pure JS via
 * `@noble/hashes` — React Native ships no WebCrypto and a native crypto pod is
 * out of scope for this milestone.
 */
export const signQuery = (secret: string, query: string): string =>
  bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(query)));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/crypto-sync/binance/binance.hmac.test.ts`
Expected: PASS (4 tests). If Jest reports `SyntaxError: Cannot use import statement outside a module` from `node_modules/@noble/hashes`, the `@noble` exemption in Step 1 is missing or misspelled.

- [ ] **Step 6: Harness on the new dependency**

Run: `npm run check:secrets && npm run check:deps && npm run check:knip`
Expected: silent. `check:deps` surfaces the changed dependency block for confirmation — that is the `@noble/hashes` line; confirm it. If `check:secrets` flags the docs-example literal, re-read Step 2's binding-name rule — fix the binding name, never the allowlist.

- [ ] **Step 7: Lint and commit**

Run: `npm run check:lint`
Expected: silent.

```bash
git add package.json package-lock.json jest.config.js src/crypto-sync/binance/binance.hmac.ts src/crypto-sync/binance/binance.hmac.test.ts
git commit -m "feat(crypto-sync): pure-JS HMAC-SHA256 query signer for Binance (@noble/hashes)"
```

---

### Task 8: Binance credentials in the biometric Keychain

**Files:**
- Create: `src/crypto-sync/binance/binance.credentials.ts`, `src/crypto-sync/binance/binance.credentials.test.ts`

**Interfaces:**
- Consumes: `react-native-keychain` (`setGenericPassword`, `getGenericPassword`, `resetGenericPassword`, `ACCESS_CONTROL.BIOMETRY_CURRENT_SET`, `ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY` — all present in v10.0.0's `lib/typescript/enums.d.ts`); `eitherSync`, `isRight`, `bifold` from `fnts/either`.
- Produces: `type BinanceCredentials = { apiKey: string; secret: string }`; `saveCredentials(credentials): Promise<void>`; `readCredentials(): Promise<BinanceCredentials | undefined>`; `clearCredentials(): Promise<void>`. Keychain `service: 'kiko.binance.credentials'`, username `'binance'`, password = `JSON.stringify(credentials)`.

- [ ] **Step 1: Write the failing test**

`src/crypto-sync/binance/binance.credentials.test.ts`:

```ts
import { clearCredentials, readCredentials, saveCredentials } from './binance.credentials';

// Mirrors `src/monobank/token.test.ts`'s Keychain double, extended to record the
// options each call was made with so the access-control flags can be asserted.
const mockSet = jest.fn();
const mockGet = jest.fn();

jest.mock('react-native-keychain', () => {
  let store: { username: string; password: string } | null = null;
  return {
    ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'BiometryCurrentSet' },
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    setGenericPassword: jest.fn(async (username: string, password: string, options: unknown) => {
      mockSet(username, password, options);
      store = { username, password };
      return true;
    }),
    getGenericPassword: jest.fn(async (options: unknown) => {
      mockGet(options);
      return store ?? false;
    }),
    resetGenericPassword: jest.fn(async () => {
      store = null;
      return true;
    }),
  };
});

const fixture = { apiKey: 'api-key-fixture', secret: 'secret-fixture' };

describe('binance credentials', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearCredentials();
  });

  it('saves the pair as one JSON Keychain item under the binance service with biometric, this-device-only access', async () => {
    await saveCredentials(fixture);

    expect(mockSet).toHaveBeenCalledWith('binance', JSON.stringify(fixture), {
      service: 'kiko.binance.credentials',
      accessControl: 'BiometryCurrentSet',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('reads the pair back, prompting for authentication under the same service', async () => {
    await saveCredentials(fixture);

    expect(await readCredentials()).toEqual(fixture);
    expect(mockGet).toHaveBeenCalledWith({
      service: 'kiko.binance.credentials',
      authenticationPrompt: { title: 'Unlock Binance credentials' },
    });
  });

  it('returns undefined when nothing is stored', async () => {
    expect(await readCredentials()).toBeUndefined();
  });

  it('returns undefined for a corrupt or mis-shaped stored value', async () => {
    const keychain = jest.requireMock('react-native-keychain') as {
      setGenericPassword: (username: string, password: string, options: unknown) => Promise<boolean>;
    };

    await keychain.setGenericPassword('binance', 'not-json', {});
    expect(await readCredentials()).toBeUndefined();

    await keychain.setGenericPassword('binance', JSON.stringify({ apiKey: 'only-half' }), {});
    expect(await readCredentials()).toBeUndefined();
  });

  it('clears the stored pair', async () => {
    await saveCredentials(fixture);
    await clearCredentials();

    expect(await readCredentials()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/crypto-sync/binance/binance.credentials.test.ts`
Expected: FAIL — `Cannot find module './binance.credentials'`.

- [ ] **Step 3: Implement**

`src/crypto-sync/binance/binance.credentials.ts`:

```ts
import { bifold, eitherSync, isRight } from 'fnts/either';
import * as Keychain from 'react-native-keychain';

const service = 'kiko.binance.credentials';

export type BinanceCredentials = { apiKey: string; secret: string };

const isCredentials = (value: unknown): value is BinanceCredentials =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { apiKey?: unknown }).apiKey === 'string' &&
  typeof (value as { secret?: unknown }).secret === 'string';

/**
 * Store the read-only Binance key pair as ONE Keychain item, gated by the
 * current biometric enrolment (re-enrolling Face ID / Touch ID invalidates it)
 * and readable only while this device is unlocked — never iCloud-synced. The
 * pair is never written to SQLite, holding metadata, or a log. On a simulator,
 * enroll Face ID (Features > Face ID > Enrolled) or this write fails.
 */
export const saveCredentials = async (credentials: BinanceCredentials): Promise<void> => {
  await Keychain.setGenericPassword('binance', JSON.stringify(credentials), {
    service,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};

/** Prompts for biometrics; resolves `undefined` when nothing valid is stored. */
export const readCredentials = async (): Promise<BinanceCredentials | undefined> => {
  const stored = await Keychain.getGenericPassword({
    service,
    authenticationPrompt: { title: 'Unlock Binance credentials' },
  });

  if (!stored) {
    return undefined;
  }

  const parsed = eitherSync<unknown, unknown>(() => JSON.parse(stored.password));
  const value = isRight(parsed) ? bifold(parsed) : undefined;

  return isCredentials(value) ? value : undefined;
};

export const clearCredentials = async (): Promise<void> => {
  await Keychain.resetGenericPassword({ service });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/crypto-sync/binance/binance.credentials.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint, security scan, commit**

Run: `npm run check:lint && npm run check:security && npm run check:secrets`
Expected: silent (the semgrep `kiko-secret-in-db-or-log` rule sees no `console.*(…secret…)` or `insert().values(…credential…)`).

```bash
git add src/crypto-sync/binance/binance.credentials.ts src/crypto-sync/binance/binance.credentials.test.ts
git commit -m "feat(crypto-sync): Binance credentials in the biometric, this-device-only Keychain"
```

---

### Task 9: `fetchAccount` — signed `GET /api/v3/account`

**Files:**
- Modify: `.env`, `.env.example`, `src/env.d.ts` (`BINANCE_API_ENDPOINT`)
- Create: `src/crypto-sync/binance/binance.client.ts`, `src/crypto-sync/binance/binance.client.test.ts`

**Interfaces:**
- Consumes: `signQuery` (Task 7); `guard` from `fnts`; `either`, `bifold`, `isRight` from `fnts/either`.
- Produces:
  ```ts
  export type BinanceBalance = { asset: string; free: string; locked: string };
  export type BinanceAccount = { balances: BinanceBalance[] };
  export type FetchAccountOptions = { fetchImpl?: typeof fetch; now?: () => number };
  export const fetchAccount: (apiKey: string, secret: string, options?: FetchAccountOptions) => Promise<BinanceAccount>;
  ```
  Query: `timestamp=<now()>&recvWindow=5000`; URL `${BINANCE_API_ENDPOINT}/api/v3/account?<query>&signature=<hex>`; header `X-MBX-APIKEY`. Non-ok throws `Binance request failed: <status>` plus `: <msg>` when the body carries Binance's `{ code, msg }`.

- [ ] **Step 1: Add the endpoint to the env files**

Append to `.env` and `.env.example`:

```
# Binance spot REST base URL (signed, read-only account requests).
BINANCE_API_ENDPOINT=https://api.binance.com
```

Add to `src/env.d.ts`: `  export const BINANCE_API_ENDPOINT: string;`

- [ ] **Step 2: Write the failing test**

`src/crypto-sync/binance/binance.client.test.ts`:

```ts
import { fetchAccount } from './binance.client';

const NOW = 1_704_326_400_000;
// signQuery('secret-fixture', 'timestamp=1704326400000&recvWindow=5000') — see binance.hmac.test.ts.
const EXPECTED_SIGNATURE = 'c548b5a5c27c61b57b685766340cfe11dff7cb5d0a693484f3af3e13f129df7f';

const accountBody = {
  makerCommission: 10,
  canTrade: false,
  balances: [
    { asset: 'BTC', free: '0.50000000', locked: '0.25000000' },
    { asset: 'ETH', free: '2.00000000', locked: '0.00000000' },
  ],
};

type SpyFetchInit = { headers: Record<string, string> };

const makeFetch = (body: unknown, ok = true, status = ok ? 200 : 401): typeof fetch =>
  (async () => ({ ok, json: async () => body, status })) as unknown as typeof fetch;

describe('fetchAccount', () => {
  it('sends the X-MBX-APIKEY header and a signed timestamp/recvWindow query to /api/v3/account', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => accountBody, status: 200 };
    }) as unknown as typeof fetch;

    await fetchAccount('api-key-fixture', 'secret-fixture', { fetchImpl: spyFetch, now: () => NOW });

    expect(sentUrl).toBe(
      `https://api.binance.com/api/v3/account?timestamp=${NOW}&recvWindow=5000&signature=${EXPECTED_SIGNATURE}`,
    );
    expect(sentHeaders['X-MBX-APIKEY']).toBe('api-key-fixture');
  });

  it('returns the parsed balances', async () => {
    const result = await fetchAccount('api-key-fixture', 'secret-fixture', {
      fetchImpl: makeFetch(accountBody),
      now: () => NOW,
    });

    expect(result.balances).toHaveLength(2);
    expect(result.balances[0]).toEqual({ asset: 'BTC', free: '0.50000000', locked: '0.25000000' });
  });

  it('throws with the status on a non-ok response without a Binance error body', async () => {
    await expect(
      fetchAccount('api-key-fixture', 'secret-fixture', { fetchImpl: makeFetch({}, false, 401) }),
    ).rejects.toThrow('Binance request failed: 401');
  });

  it("surfaces Binance's own message on a clock-skew rejection instead of swallowing it", async () => {
    const skewBody = { code: -1021, msg: 'Timestamp for this request is outside of the recvWindow.' };

    await expect(
      fetchAccount('api-key-fixture', 'secret-fixture', {
        fetchImpl: makeFetch(skewBody, false, 400),
        // a stale clock: the request timestamp lags real time by well over recvWindow
        now: () => NOW - 60_000,
      }),
    ).rejects.toThrow(
      'Binance request failed: 400: Timestamp for this request is outside of the recvWindow.',
    );
  });

  it("surfaces Binance's invalid-key message", async () => {
    const invalidBody = { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' };

    await expect(
      fetchAccount('api-key-fixture', 'secret-fixture', { fetchImpl: makeFetch(invalidBody, false, 401) }),
    ).rejects.toThrow('Invalid API-key, IP, or permissions for action.');
  });

  it('still throws with the status when the error body is not JSON', async () => {
    const htmlFetch = (async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    })) as unknown as typeof fetch;

    await expect(
      fetchAccount('api-key-fixture', 'secret-fixture', { fetchImpl: htmlFetch }),
    ).rejects.toThrow('Binance request failed: 502');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/crypto-sync/binance/binance.client.test.ts`
Expected: FAIL — `Cannot find module './binance.client'`. (`npx jest --clearCache` if the new `@env` key is reported missing once the module exists.)

- [ ] **Step 4: Implement**

`src/crypto-sync/binance/binance.client.ts`:

```ts
import { BINANCE_API_ENDPOINT } from '@env';
import { guard } from 'fnts';
import either, { bifold, isRight } from 'fnts/either';

import { signQuery } from './binance.hmac';

/** One spot balance from `/api/v3/account` — decimal strings, per Binance. */
export type BinanceBalance = { asset: string; free: string; locked: string };

/** The `/api/v3/account` payload fields this client reads. */
export type BinanceAccount = { balances: BinanceBalance[] };

export type FetchAccountOptions = {
  fetchImpl?: typeof fetch;
  /** Injected clock (same seam as `SyncDeps.now`) so a clock-skew test needs no real timer. */
  now?: () => number;
};

/**
 * Binance rejects a signed request whose `timestamp` is more than this many
 * milliseconds off its server time (error -1021). 5000 is Binance's default.
 */
const RECV_WINDOW_MS = 5000;

/**
 * Binance error bodies are `{ code, msg }`. Surface `msg` (the clock-skew or
 * invalid-key text) so the user sees the real cause, not a bare status. A
 * non-JSON body (a gateway HTML page) yields no suffix.
 */
const errorSuffix = async (response: Response): Promise<string> => {
  const body = await either<unknown, unknown>(() => response.json());
  const parsed = isRight(body) ? bifold(body) : undefined;
  const message = (parsed as { msg?: unknown } | undefined)?.msg;

  return typeof message === 'string' ? `: ${message}` : '';
};

/**
 * Read a Binance JSON body, or throw on a non-ok response — the same `guard`
 * validator/executor shape as the Monobank client, with an async throwing
 * executor so the error body can be read first.
 */
const readBody = guard(
  [
    (response: Response) => !response.ok,
    async (response: Response): Promise<never> => {
      throw new Error(`Binance request failed: ${response.status}${await errorSuffix(response)}`);
    },
  ],
  (response: Response): Promise<unknown> => response.json(),
);

/**
 * `GET /api/v3/account`, signed: HMAC-SHA256 over `timestamp=…&recvWindow=…`
 * under the API secret, appended as `signature`, with the key in the
 * `X-MBX-APIKEY` header. Read-only: a key with only "Enable Reading" is enough.
 */
export const fetchAccount = async (
  apiKey: string,
  secret: string,
  { fetchImpl = fetch, now = Date.now }: FetchAccountOptions = {},
): Promise<BinanceAccount> => {
  const query = `timestamp=${now()}&recvWindow=${RECV_WINDOW_MS}`;
  const signature = signQuery(secret, query);
  const response = await fetchImpl(
    `${BINANCE_API_ENDPOINT}/api/v3/account?${query}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': apiKey } },
  );

  return (await readBody(response)) as BinanceAccount;
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/crypto-sync/binance/binance.client.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Lint and commit**

Run: `npm run check:lint`
Expected: silent.

```bash
git add .env .env.example src/env.d.ts src/crypto-sync/binance/binance.client.ts src/crypto-sync/binance/binance.client.test.ts
git commit -m "feat(crypto-sync): signed Binance account client with clock-skew error surfacing"
```

---

### Task 10: `binanceProvider` — BTC only, `free + locked` → satoshis

**Files:**
- Create: `src/crypto-sync/binance/binance.provider.ts`, `src/crypto-sync/binance/binance.provider.test.ts`

**Interfaces:**
- Consumes: `Money.fromMajor` / `Money.add` (`src/currency/money.ts`); `BinanceAccount`, `BinanceBalance`, `FetchAccountOptions`, `fetchAccount` (Task 9); `BinanceCredentials`, `readCredentials` (Task 8); `BalanceProvider` (Task 1).
- Produces:
  ```ts
  export type BinanceDeps = {
    fetchImpl: typeof fetch;
    now: () => number;
    readCredentials: () => Promise<BinanceCredentials | undefined>;
    fetchAccount: (apiKey: string, secret: string, options?: FetchAccountOptions) => Promise<BinanceAccount>;
  };
  export const defaultBinanceDeps: BinanceDeps;
  export const binanceProvider: BalanceProvider<BinanceDeps>; // id 'binance', kind 'exchange', metadataField 'binanceAsset'
  ```
  Error: `No Binance credentials stored; connect Binance before syncing`. Holding name `'Binance BTC'`, `metadataKey: 'BTC'`.

- [ ] **Step 1: Write the failing test**

`src/crypto-sync/binance/binance.provider.test.ts`:

```ts
import type { SyncTarget } from '../provider';
import { fetchAccount } from './binance.client';
import { readCredentials } from './binance.credentials';
import { type BinanceDeps, binanceProvider, defaultBinanceDeps } from './binance.provider';

// The credentials module imports react-native-keychain, whose native binding is
// absent under Jest; a bare stub is enough since `readCredentials` is injected.
jest.mock('react-native-keychain', () => ({}));

const NOW = 1_704_326_400_000;
const target: SyncTarget = { accountId: 'acc-1', holdings: [] };
const credentials = { apiKey: 'api-key-fixture', secret: 'secret-fixture' };

const makeDeps = (
  balances: { asset: string; free: string; locked: string }[],
): BinanceDeps & { fetchAccount: jest.Mock; readCredentials: jest.Mock } => ({
  fetchImpl: (async () => ({ ok: true })) as unknown as typeof fetch,
  now: () => NOW,
  readCredentials: jest.fn(async () => credentials),
  fetchAccount: jest.fn(async () => ({ balances })),
});

describe('binanceProvider', () => {
  it('is the binance exchange provider keyed on binanceAsset', () => {
    expect(binanceProvider.id).toBe('binance');
    expect(binanceProvider.kind).toBe('exchange');
    expect(binanceProvider.metadataField).toBe('binanceAsset');
  });

  it('wires the real client, credentials reader, clock and fetch as its default deps', () => {
    expect(defaultBinanceDeps.fetchAccount).toBe(fetchAccount);
    expect(defaultBinanceDeps.readCredentials).toBe(readCredentials);
    expect(defaultBinanceDeps.fetchImpl).toBe(fetch);
    expect(typeof defaultBinanceDeps.now()).toBe('number');
  });

  it('reads the stored credentials and calls fetchAccount with the injected fetch and clock', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '1.00000000', locked: '0.00000000' }]);

    await binanceProvider.fetchBalances(deps, target);

    expect(deps.readCredentials).toHaveBeenCalledTimes(1);
    expect(deps.fetchAccount).toHaveBeenCalledWith('api-key-fixture', 'secret-fixture', {
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
  });

  it('sums free + locked for the BTC asset into satoshis and ignores every other asset', async () => {
    const deps = makeDeps([
      { asset: 'ETH', free: '2.00000000', locked: '0.00000000' },
      { asset: 'BTC', free: '0.50000000', locked: '0.25000000' },
      { asset: 'USDT', free: '100.00000000', locked: '0.00000000' },
    ]);

    const balances = await binanceProvider.fetchBalances(deps, target);

    expect(balances).toEqual([
      { currency: 'BTC', balanceMinorUnits: 75_000_000, metadataKey: 'BTC', name: 'Binance BTC' },
    ]);
  });

  it('converts each decimal string separately so float addition never drifts', async () => {
    const deps = makeDeps([{ asset: 'BTC', free: '0.1', locked: '0.2' }]);

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance.balanceMinorUnits).toBe(30_000_000);
  });

  it('reports a zero BTC balance when the payload carries no BTC entry', async () => {
    const deps = makeDeps([{ asset: 'ETH', free: '2.00000000', locked: '0.00000000' }]);

    const [balance] = await binanceProvider.fetchBalances(deps, target);

    expect(balance).toMatchObject({ currency: 'BTC', balanceMinorUnits: 0, metadataKey: 'BTC' });
  });

  it('throws before any network call when no credentials are stored', async () => {
    const deps = makeDeps([]);
    deps.readCredentials.mockResolvedValue(undefined);

    await expect(binanceProvider.fetchBalances(deps, target)).rejects.toThrow(/connect Binance/i);
    expect(deps.fetchAccount).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/crypto-sync/binance/binance.provider.test.ts`
Expected: FAIL — `Cannot find module './binance.provider'`.

- [ ] **Step 3: Implement**

`src/crypto-sync/binance/binance.provider.ts`:

```ts
import { Money } from '../../currency/money';
import type { BalanceProvider } from '../provider';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import {
  type BinanceAccount,
  type BinanceBalance,
  type FetchAccountOptions,
  fetchAccount,
} from './binance.client';

export type BinanceDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  readCredentials: () => Promise<BinanceCredentials | undefined>;
  fetchAccount: (
    apiKey: string,
    secret: string,
    options?: FetchAccountOptions,
  ) => Promise<BinanceAccount>;
};

export const defaultBinanceDeps: BinanceDeps = {
  fetchImpl: fetch,
  now: () => Date.now(),
  readCredentials,
  fetchAccount,
};

/** The only asset this milestone reads; every other `balances[]` entry is ignored. */
const BINANCE_ASSET = 'BTC';

/** Display name of the holding the first sync creates. */
const BINANCE_HOLDING_NAME = 'Binance BTC';

const isBTCBalance = (balance: BinanceBalance): boolean => balance.asset === BINANCE_ASSET;

// `free` and `locked` are decimal strings. Each is converted to satoshis on its
// own and summed as Money, so no float addition happens before rounding.
const toSatoshis = (balance: BinanceBalance): number =>
  Money.fromMajor('BTC', Number(balance.free))
    .add(Money.fromMajor('BTC', Number(balance.locked)))
    .minorUnits;

export const binanceProvider: BalanceProvider<BinanceDeps> = {
  id: 'binance',
  kind: 'exchange',
  metadataField: 'binanceAsset',
  fetchBalances: async (deps) => {
    const credentials = await deps.readCredentials();

    if (credentials === undefined) {
      throw new Error('No Binance credentials stored; connect Binance before syncing');
    }

    const account = await deps.fetchAccount(credentials.apiKey, credentials.secret, {
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    const balanceMinorUnits = account.balances
      .filter(isBTCBalance)
      .reduce((sum, balance) => sum + toSatoshis(balance), 0);

    return [
      {
        currency: 'BTC',
        balanceMinorUnits,
        metadataKey: BINANCE_ASSET,
        name: BINANCE_HOLDING_NAME,
      },
    ];
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/crypto-sync/binance`
Expected: PASS (all four Binance suites).

- [ ] **Step 5: CHECKPOINT — full suite + harness**

Run: `npx jest` then `npm run check:all`
Expected: PASS; silent.

- [ ] **Step 6: Commit**

```bash
git add src/crypto-sync/binance/binance.provider.ts src/crypto-sync/binance/binance.provider.test.ts
git commit -m "feat(crypto-sync): Binance provider — read-only BTC spot balance to satoshis"
```

---
## Phase D — Wiring: dispatcher, disconnect, hooks, shared status line

### Task 11: `runCryptoSync` dispatcher + `disconnectCryptoAccount`

**Files:**
- Modify: `src/crypto-sync/sync.ts` (export `BalanceSyncResult`)
- Create: `src/crypto-sync/run-crypto-sync.ts`, `src/crypto-sync/run-crypto-sync.test.ts`
- Create: `src/crypto-sync/disconnect.ts`, `src/crypto-sync/disconnect.test.ts`

**Interfaces:**
- Consumes: `runBalanceSync`, `BalanceSyncResult` (Task 4); `bitcoinWalletProvider`, `defaultBitcoinWalletDeps` (Task 6); `binanceProvider`, `defaultBinanceDeps` (Task 10); `accountsRepo.disconnect` (Task 3); `clearCredentials` (Task 8); `BalanceProviderId` (Task 1).
- Produces:
  ```ts
  export type CryptoSyncRequest =
    | { providerId: 'btc_wallet'; targetAccountId: string; address?: string }
    | { providerId: 'binance'; targetAccountId: string };
  export const runCryptoSync: (request: CryptoSyncRequest) => Promise<BalanceSyncResult>;
  export const disconnectCryptoAccount: (accountId: string, providerId: BalanceProviderId) => Promise<void>;
  ```

- [ ] **Step 1: Export `BalanceSyncResult`**

In `src/crypto-sync/sync.ts` replace

```ts
// Exported in Task 11, when `runCryptoSync` first needs to name it.
type BalanceSyncResult = { syncedHoldings: number };
```

with

```ts
export type BalanceSyncResult = { syncedHoldings: number };
```

- [ ] **Step 2: Write the failing tests**

`src/crypto-sync/run-crypto-sync.test.ts`:

```ts
const mockRunBalanceSync = jest.fn();

// `./sync` pulls the repos (and so op-sqlite) into the graph; replacing the
// whole module keeps this a pure dispatch test. The Binance credentials module
// imports react-native-keychain, whose native binding is absent under Jest.
jest.mock('./sync', () => ({
  runBalanceSync: (...args: unknown[]) => mockRunBalanceSync(...args),
}));
jest.mock('react-native-keychain', () => ({}));

import { binanceProvider, defaultBinanceDeps } from './binance/binance.provider';
import { bitcoinWalletProvider, defaultBitcoinWalletDeps } from './btc-wallet/btc-wallet.provider';
import { type CryptoSyncRequest, runCryptoSync } from './run-crypto-sync';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('runCryptoSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunBalanceSync.mockResolvedValue({ syncedHoldings: 1 });
  });

  it('runs the wallet provider with the connect-time address on a wallet request', async () => {
    const request: CryptoSyncRequest = { providerId: 'btc_wallet', targetAccountId: 'acc-1', address: ADDRESS };

    const result = await runCryptoSync(request);

    expect(result).toEqual({ syncedHoldings: 1 });
    expect(mockRunBalanceSync).toHaveBeenCalledWith(
      bitcoinWalletProvider,
      { ...defaultBitcoinWalletDeps, address: ADDRESS },
      { targetAccountId: 'acc-1' },
    );
  });

  it('runs the wallet provider without an address on a wallet re-sync', async () => {
    await runCryptoSync({ providerId: 'btc_wallet', targetAccountId: 'acc-1' });

    expect(mockRunBalanceSync).toHaveBeenCalledWith(
      bitcoinWalletProvider,
      { ...defaultBitcoinWalletDeps, address: undefined },
      { targetAccountId: 'acc-1' },
    );
  });

  it('runs the Binance provider with its default deps on a Binance request', async () => {
    await runCryptoSync({ providerId: 'binance', targetAccountId: 'acc-2' });

    expect(mockRunBalanceSync).toHaveBeenCalledWith(binanceProvider, defaultBinanceDeps, {
      targetAccountId: 'acc-2',
    });
  });
});
```

`src/crypto-sync/disconnect.test.ts`:

```ts
const mockDisconnectAccount = jest.fn(async () => {});
const mockClearCredentials = jest.fn(async () => {});

jest.mock('../repositories/accounts.repo', () => ({
  accountsRepo: { disconnect: (id: string) => mockDisconnectAccount(id) },
}));
jest.mock('./binance/binance.credentials', () => ({
  clearCredentials: () => mockClearCredentials(),
}));

import { disconnectCryptoAccount } from './disconnect';

describe('disconnectCryptoAccount', () => {
  beforeEach(() => {
    mockDisconnectAccount.mockClear();
    mockClearCredentials.mockClear();
  });

  it('for Binance, runs the DB disconnect first and then clears the Keychain credentials', async () => {
    const order: string[] = [];
    mockDisconnectAccount.mockImplementation(async () => {
      order.push('db');
    });
    mockClearCredentials.mockImplementation(async () => {
      order.push('keychain');
    });

    await disconnectCryptoAccount('acc-1', 'binance');

    expect(mockDisconnectAccount).toHaveBeenCalledWith('acc-1');
    expect(order).toEqual(['db', 'keychain']);
  });

  it('for a wallet, runs only the DB disconnect — there is no secret to clear', async () => {
    await disconnectCryptoAccount('acc-1', 'btc_wallet');

    expect(mockDisconnectAccount).toHaveBeenCalledWith('acc-1');
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });

  it('does not clear the credentials if the DB disconnect fails', async () => {
    mockDisconnectAccount.mockRejectedValueOnce(new Error('db boom'));

    await expect(disconnectCryptoAccount('acc-1', 'binance')).rejects.toThrow('db boom');
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/crypto-sync/run-crypto-sync.test.ts src/crypto-sync/disconnect.test.ts`
Expected: FAIL — both modules missing.

- [ ] **Step 4: Implement**

`src/crypto-sync/run-crypto-sync.ts`:

```ts
import { match } from 'ts-pattern';

import { binanceProvider, defaultBinanceDeps } from './binance/binance.provider';
import { bitcoinWalletProvider, defaultBitcoinWalletDeps } from './btc-wallet/btc-wallet.provider';
import { type BalanceSyncResult, runBalanceSync } from './sync';

/**
 * One user-triggered crypto sync. `address` is set only by the wallet Connect
 * action — a re-sync reads the stored `metadata.walletAddress` instead.
 */
export type CryptoSyncRequest =
  | { providerId: 'btc_wallet'; targetAccountId: string; address?: string }
  | { providerId: 'binance'; targetAccountId: string };

/** Pick the concrete provider for the request and run the generic balance sync. */
export const runCryptoSync = (request: CryptoSyncRequest): Promise<BalanceSyncResult> =>
  match(request)
    .with({ providerId: 'btc_wallet' }, ({ targetAccountId, address }) =>
      runBalanceSync(
        bitcoinWalletProvider,
        { ...defaultBitcoinWalletDeps, address },
        { targetAccountId },
      ),
    )
    .with({ providerId: 'binance' }, ({ targetAccountId }) =>
      runBalanceSync(binanceProvider, defaultBinanceDeps, { targetAccountId }),
    )
    .exhaustive();
```

`src/crypto-sync/disconnect.ts`:

```ts
import { accountsRepo } from '../repositories/accounts.repo';
import { clearCredentials } from './binance/binance.credentials';
import type { BalanceProviderId } from './provider';

/**
 * Disconnect a wallet- or Binance-connected account, the required first step
 * before it can be deleted. Mirrors `monobank/disconnect.ts`: the DB mutation
 * (`accountsRepo.disconnect` — clear `institution`, strip the sync keys from
 * the holdings) commits first; only then is the non-transactional Keychain
 * item cleared, and only for Binance — a wallet stores no secret. If the DB
 * write throws, the credentials stay put and the account stays connected.
 */
export const disconnectCryptoAccount = async (
  accountId: string,
  providerId: BalanceProviderId,
): Promise<void> => {
  await accountsRepo.disconnect(accountId);

  if (providerId === 'binance') {
    await clearCredentials();
  }
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/crypto-sync`
Expected: PASS (every crypto-sync suite).

- [ ] **Step 6: Lint and commit**

Run: `npm run check:lint && npm run check:knip`
Expected: silent (`BalanceSyncResult`, both providers' default deps, and `disconnectCryptoAccount` now have app-code or test consumers).

```bash
git add src/crypto-sync/sync.ts src/crypto-sync/run-crypto-sync.ts src/crypto-sync/run-crypto-sync.test.ts src/crypto-sync/disconnect.ts src/crypto-sync/disconnect.test.ts
git commit -m "feat(crypto-sync): per-request provider dispatch and crypto account disconnect"
```

---

### Task 12: `useSyncAction` (extracted from `useSync`) + `useCryptoSync`

**Files:**
- Modify: `src/screens/use-sync.ts` (whole file)
- Create: `src/screens/use-crypto-sync.ts`, `src/screens/use-crypto-sync.test.ts`

**Interfaces:**
- Consumes: `runSync` (`src/monobank/sync.ts`), `refreshRates`, `ratesRepo.latestFetchedAt`; `CryptoSyncRequest`, `runCryptoSync` (Task 11).
- Produces:
  ```ts
  export type SyncAction<Input> = { isSyncing: boolean; error: string | undefined; sync: (input: Input) => Promise<boolean> };
  export const useSyncAction: <Input>(run: (input: Input) => Promise<unknown>) => SyncAction<Input>;
  export const useSync: () => { isSyncing: boolean; error: string | undefined; sync: (targetAccountId?: string) => Promise<boolean> }; // unchanged callers; now resolves true on success
  export const useCryptoSync: () => SyncAction<CryptoSyncRequest>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/screens/use-sync.test.ts`, inside `describe('useSync', …)`:

```ts
  it('resolves true when the sync and rate refresh succeed', async () => {
    const { result } = await renderHook(() => useSync());

    let outcome = false;
    await act(async () => {
      outcome = await result.current.sync('acc-42');
    });

    expect(outcome).toBe(true);
  });

  it('resolves false (and sets error) when the sync fails', async () => {
    mockRunSync.mockRejectedValue(new Error('sync boom'));
    const { result } = await renderHook(() => useSync());

    let outcome = true;
    await act(async () => {
      outcome = await result.current.sync();
    });

    expect(outcome).toBe(false);
    expect(result.current.error).toMatch(/sync boom/);
  });
```

`src/screens/use-crypto-sync.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react-native';

const mockRunCryptoSync = jest.fn();
const mockRefreshRates = jest.fn();
const mockLatestFetchedAt = jest.fn();

jest.mock('../crypto-sync/run-crypto-sync', () => ({
  runCryptoSync: (...args: unknown[]) => mockRunCryptoSync(...args),
}));
jest.mock('../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
}));
jest.mock('../repositories/rates.repo', () => ({
  ratesRepo: {
    latestFetchedAt: (...args: unknown[]) => mockLatestFetchedAt(...args),
  },
}));

import { useCryptoSync } from './use-crypto-sync';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('useCryptoSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunCryptoSync.mockResolvedValue({ syncedHoldings: 1 });
    mockRefreshRates.mockResolvedValue(undefined);
    mockLatestFetchedAt.mockResolvedValue(1_700_000_000_000);
  });

  it('passes the request through to runCryptoSync, then refreshes rates with the stored latestFetchedAt', async () => {
    const { result } = await renderHook(() => useCryptoSync());

    await act(async () => {
      await result.current.sync({ providerId: 'btc_wallet', targetAccountId: 'acc-1', address: ADDRESS });
    });

    expect(mockRunCryptoSync).toHaveBeenCalledWith({
      providerId: 'btc_wallet',
      targetAccountId: 'acc-1',
      address: ADDRESS,
    });
    expect(mockRefreshRates).toHaveBeenCalledWith({ lastRefreshAt: 1_700_000_000_000 });
  });

  it('resolves true and leaves no error on success', async () => {
    const { result } = await renderHook(() => useCryptoSync());

    let outcome = false;
    await act(async () => {
      outcome = await result.current.sync({ providerId: 'binance', targetAccountId: 'acc-2' });
    });

    expect(outcome).toBe(true);
    expect(result.current.error).toBeUndefined();
    expect(result.current.isSyncing).toBe(false);
  });

  it('resolves false and surfaces the error message when the sync fails, without throwing', async () => {
    mockRunCryptoSync.mockRejectedValue(new Error('Binance request failed: 401'));
    const { result } = await renderHook(() => useCryptoSync());

    let outcome = true;
    await act(async () => {
      outcome = await result.current.sync({ providerId: 'binance', targetAccountId: 'acc-2' });
    });

    expect(outcome).toBe(false);
    expect(result.current.error).toBe('Binance request failed: 401');
    expect(mockRefreshRates).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/screens/use-sync.test.ts src/screens/use-crypto-sync.test.ts`
Expected: FAIL — `sync` resolves `undefined` (not `true`/`false`); `Cannot find module './use-crypto-sync'`.

- [ ] **Step 3: Refactor `use-sync.ts` and add `use-crypto-sync.ts`**

Replace `src/screens/use-sync.ts`:

```ts
import either, { bifold, isLeft } from 'fnts/either';
import { useState } from 'react';

import { runSync } from '../monobank/sync';
import { refreshRates } from '../rates/rates-refresh';
import { ratesRepo } from '../repositories/rates.repo';

export type SyncAction<Input> = {
  isSyncing: boolean;
  error: string | undefined;
  /** Resolves `true` on success, `false` when the run or the rate refresh failed (the failure is in `error`). */
  sync: (input: Input) => Promise<boolean>;
};

type UseSync = {
  isSyncing: boolean;
  error: string | undefined;
  sync: (targetAccountId?: string) => Promise<boolean>;
};

/**
 * The shared state machine behind every user-triggered sync (Monobank, wallet,
 * Binance): run the given sync, then refresh rates, tracking a syncing flag and
 * surfacing any failure as an error string instead of throwing.
 */
export const useSyncAction = <Input>(
  run: (input: Input) => Promise<unknown>,
): SyncAction<Input> => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const sync = async (input: Input): Promise<boolean> => {
    setIsSyncing(true);
    setError(undefined);

    const result = await either<unknown, void>(async () => {
      await run(input);
      const lastRefreshAt = await ratesRepo.latestFetchedAt();
      await refreshRates({ lastRefreshAt });
    });

    // Always clear the syncing flag, whether the run succeeded or failed —
    // this is the old `finally` block.
    setIsSyncing(false);

    if (isLeft(result)) {
      const caught = bifold(result);
      setError(caught instanceof Error ? caught.message : String(caught));

      return false;
    }

    return true;
  };

  return { isSyncing, error, sync };
};

/** The Monobank sync action used by Home, Settings and the bank account detail. */
export const useSync = (): UseSync => {
  const action = useSyncAction((targetAccountId: string | undefined) =>
    runSync({ targetAccountId }),
  );

  return { ...action, sync: (targetAccountId?: string) => action.sync(targetAccountId) };
};
```

`src/screens/use-crypto-sync.ts`:

```ts
import { type CryptoSyncRequest, runCryptoSync } from '../crypto-sync/run-crypto-sync';
import { type SyncAction, useSyncAction } from './use-sync';

/** The wallet / Binance sync action used by the crypto account detail. */
export const useCryptoSync = (): SyncAction<CryptoSyncRequest> =>
  useSyncAction<CryptoSyncRequest>(runCryptoSync);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/screens/use-sync.test.ts src/screens/use-crypto-sync.test.ts src/screens/account-detail src/screens/home src/screens/settings`
Expected: PASS — every existing `useSync` consumer still compiles and behaves (they ignore the new boolean).

- [ ] **Step 5: Lint and commit**

Run: `npm run check:lint && npm run check:dup`
Expected: silent (the two hooks share one state machine — no duplicated block).

```bash
git add src/screens/use-sync.ts src/screens/use-sync.test.ts src/screens/use-crypto-sync.ts src/screens/use-crypto-sync.test.ts
git commit -m "feat(screens): extract useSyncAction; add useCryptoSync over runCryptoSync"
```

---

### Task 13: `SyncStatusLine` shared component (Monobank field adopts it)

**Files:**
- Create: `src/screens/account-detail/sync-status-line.props.d.ts`
- Create: `src/screens/account-detail/sync-status-line.component.tsx`, `src/screens/account-detail/sync-status-line.component.test.tsx`
- Modify: `src/screens/account-detail/monobank-token-field.component.tsx:15-20`, `:37`, `:56`, `:67`, `:71-91`, `:147-175`

**Interfaces:**
- Consumes: `Box`, `Text`, `SymbolIcon` primitives; `styles.statusLine` from `./account-detail.styles`; `match`, `P` from `ts-pattern`.
- Produces:
  ```ts
  export type SyncStatus =
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'success'; message: string }
    | { kind: 'invalid'; message: string }
    | { kind: 'saveError'; message: string };
  export type SyncStatusLineProps = { status: SyncStatus };
  ```
  `SyncStatusLine` renders nothing for `idle`, "Checking…" (secondary tone) for `checking`, a positive `checkmark.circle` + message for `success`, a negative `xmark.circle` + message for `invalid` / `saveError`.

- [ ] **Step 1: Write the failing test**

`src/screens/account-detail/sync-status-line.component.test.tsx`:

```tsx
import { render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import SyncStatusLine from './sync-status-line.component';

describe('SyncStatusLine', () => {
  it('renders nothing while idle', async () => {
    const { toJSON } = await render(<SyncStatusLine status={{ kind: 'idle' }} />);
    expect(toJSON()).toBeNull();
  });

  it('shows a Checking… line while checking', async () => {
    const { getByText } = await render(<SyncStatusLine status={{ kind: 'checking' }} />);
    expect(getByText(/Checking/)).toBeTruthy();
  });

  it('shows the success message with a checkmark glyph', async () => {
    const { getByText, getByLabelText } = await render(
      <SyncStatusLine status={{ kind: 'success', message: 'Connected as Jane Doe' }} />,
    );
    expect(getByText('Connected as Jane Doe')).toBeTruthy();
    expect(getByLabelText('Icon checkmark.circle')).toBeTruthy();
  });

  it('shows an invalid message with an xmark glyph', async () => {
    const { getByText, getByLabelText } = await render(
      <SyncStatusLine status={{ kind: 'invalid', message: 'Invalid token' }} />,
    );
    expect(getByText('Invalid token')).toBeTruthy();
    expect(getByLabelText('Icon xmark.circle')).toBeTruthy();
  });

  it('shows a save-error message with an xmark glyph', async () => {
    const { getByText, getByLabelText } = await render(
      <SyncStatusLine status={{ kind: 'saveError', message: 'Could not save token' }} />,
    );
    expect(getByText('Could not save token')).toBeTruthy();
    expect(getByLabelText('Icon xmark.circle')).toBeTruthy();
  });
});
```

(The `Icon <name>` accessibility label is what `SymbolIcon` already exposes — see the `getByLabelText('Icon building.columns')` assertions in `account-detail.screen.test.tsx`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/screens/account-detail/sync-status-line.component.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the props type and component**

`src/screens/account-detail/sync-status-line.props.d.ts`:

```ts
/**
 * The result line under a Connect/Save action: idle (nothing), a check in
 * flight, or one of three outcomes carrying the copy to show. Shared by the
 * Monobank token, wallet address and Binance credentials fields.
 */
export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'success'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'saveError'; message: string };

export type SyncStatusLineProps = { status: SyncStatus };
```

`src/screens/account-detail/sync-status-line.component.tsx`:

```tsx
import type { FC } from 'react';
import { match, P } from 'ts-pattern';
import Box from '../../design-system/components/box';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import { styles } from './account-detail.styles';
import type { SyncStatusLineProps } from './sync-status-line.props';

// One glyph + tone per outcome; `invalid` and `saveError` share the negative
// treatment and differ only in the message the owning field supplies.
const SyncStatusLine: FC<SyncStatusLineProps> = ({ status }) => {
  return match(status)
    .with({ kind: 'idle' }, () => null)
    .with({ kind: 'checking' }, () => {
      return (
        <Text variant="body" tone="textSecondary">
          Checking…
        </Text>
      );
    })
    .with({ kind: 'success' }, ({ message }) => {
      return (
        <Box direction="row" gap={2} style={styles.statusLine}>
          <SymbolIcon name="checkmark.circle" tone="positive" />

          <Text variant="body" tone="positive">
            {message}
          </Text>
        </Box>
      );
    })
    .with({ kind: P.union('invalid', 'saveError') }, ({ message }) => {
      return (
        <Box direction="row" gap={2} style={styles.statusLine}>
          <SymbolIcon name="xmark.circle" tone="negative" />

          <Text variant="body" tone="negative">
            {message}
          </Text>
        </Box>
      );
    })
    .exhaustive();
};

export default SyncStatusLine;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/screens/account-detail/sync-status-line.component.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Make the Monobank field render through it**

In `src/screens/account-detail/monobank-token-field.component.tsx`:

1. Replace the `TokenStatus` type (lines 15–20) with an import: add `import type { SyncStatus } from './sync-status-line.props';` and `import SyncStatusLine from './sync-status-line.component';` to the local import group (after the `./account-detail.styles` import, keeping shortest-first order), and delete the `TokenStatus` declaration.
2. Line 37: `useState<TokenStatus>` → `useState<SyncStatus>`.
3. In `handleSaveToken` (lines 71–91) set the outcomes with messages:
   ```ts
        setTokenStatus({ kind: 'invalid', message: 'Invalid token' });
   ```
   ```ts
        setTokenStatus({ kind: 'success', message: `Connected as ${clientName}` });
   ```
   ```ts
        setTokenStatus({ kind: 'saveError', message: 'Could not save token' });
   ```
4. Replace the four conditional status blocks (lines 147–175, from `{tokenStatus.kind === 'checking' && (` through the closing `)}` of the `saveError` block) with:
   ```tsx
        <SyncStatusLine status={tokenStatus} />
   ```
5. Remove the now-unused `Text` import ONLY if nothing else in the file uses it (the "Synchronization" heading still does — so `Text` stays); the `SymbolIcon` import stays (paste button, Save icon). Biome's `noUnusedImports` will flag anything that becomes unused.

- [ ] **Step 6: Run the field's existing tests unchanged**

Run: `npx jest src/screens/account-detail/monobank-token-field.component.test.tsx src/screens/account-detail/account-detail.screen.test.tsx`
Expected: PASS with no test edits — the rendered copy ("Checking…", "Connected as Jane Doe", "Invalid token", "Could not save token") is identical.

- [ ] **Step 7: Lint, dup check, commit**

Run: `npm run check:lint && npm run check:dup`
Expected: silent.

```bash
git add src/screens/account-detail/sync-status-line.props.d.ts src/screens/account-detail/sync-status-line.component.tsx src/screens/account-detail/sync-status-line.component.test.tsx src/screens/account-detail/monobank-token-field.component.tsx
git commit -m "refactor(screens): shared SyncStatusLine for connect/save outcomes; Monobank field adopts it"
```

---
## Phase E — UI: the crypto account's Synchronization section

### Task 14: `WalletAddressField`

**Files:**
- Create: `src/screens/account-detail/wallet-address-field.component.tsx`
- Create: `src/screens/account-detail/wallet-address-field.component.test.tsx`

**Interfaces:**
- Consumes: `isValidBitcoinAddress` (Task 6); `SyncStatus`, `SyncStatusLine` (Task 13); `Box`, `PressableButton`, `SymbolIcon`; `styles.textField/fieldRow/iconButton/statusLine`; `@react-native-clipboard/clipboard` (globally mocked in `jest/setup.js`).
- Produces: `WalletAddressField` with props `{ onConnect: (address: string) => Promise<boolean> }`. The trial explorer fetch the spec asks for before persisting IS the sync run behind `onConnect`: `runBalanceSync` fetches first and marks/upserts only on success (Task 4), so nothing persists on a failed fetch and no second network call is needed.

- [ ] **Step 1: Write the failing test**

`src/screens/account-detail/wallet-address-field.component.test.tsx`:

```tsx
import { act, fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import WalletAddressField from './wallet-address-field.component';

const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

/** Resolves deferred outside the executor, for controlling async timing in tests. */
const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

describe('WalletAddressField', () => {
  const onConnect = jest.fn<Promise<boolean>, [string]>();

  beforeEach(() => {
    jest.clearAllMocks();
    onConnect.mockResolvedValue(true);
  });

  it('renders a plain (non-secure) address input, a paste button and a Connect Wallet action', async () => {
    const { getByPlaceholderText, getByLabelText, getByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    expect(getByPlaceholderText('BTC address').props.secureTextEntry).toBeFalsy();
    expect(getByLabelText('Paste from clipboard')).toBeTruthy();
    expect(getByText('Connect Wallet')).toBeTruthy();
  });

  it('fills the input from the clipboard, trimmed', async () => {
    mockGetString.mockResolvedValue(`  ${ADDRESS}\n`);
    const { getByLabelText, getByPlaceholderText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    await act(async () => {
      await fireEvent.press(getByLabelText('Paste from clipboard'));
    });

    expect(getByPlaceholderText('BTC address').props.value).toBe(ADDRESS);
  });

  it('rejects a malformed address locally and never calls onConnect', async () => {
    const { getByPlaceholderText, getByText, findByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    await fireEvent.changeText(getByPlaceholderText('BTC address'), 'not an address');
    await act(async () => {
      await fireEvent.press(getByText('Connect Wallet'));
    });

    expect(await findByText('Invalid BTC address')).toBeTruthy();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('connects a valid (trimmed) address and shows success when onConnect resolves true', async () => {
    const { getByPlaceholderText, getByText, findByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    await fireEvent.changeText(getByPlaceholderText('BTC address'), ` ${ADDRESS} `);
    await act(async () => {
      await fireEvent.press(getByText('Connect Wallet'));
    });

    expect(onConnect).toHaveBeenCalledWith(ADDRESS);
    expect(await findByText('Wallet connected')).toBeTruthy();
  });

  it('shows a connect error (not "Invalid BTC address") when onConnect resolves false', async () => {
    onConnect.mockResolvedValue(false);
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    await fireEvent.changeText(getByPlaceholderText('BTC address'), ADDRESS);
    await act(async () => {
      await fireEvent.press(getByText('Connect Wallet'));
    });

    expect(await findByText('Could not connect wallet')).toBeTruthy();
    expect(queryByText('Invalid BTC address')).toBeNull();
    expect(queryByText('Wallet connected')).toBeNull();
  });

  it('shows Checking… and disables the action while onConnect is in flight', async () => {
    const pending = deferred<boolean>();
    onConnect.mockReturnValue(pending.promise);
    const { getByPlaceholderText, getByText, getByRole, findByText, queryByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    await fireEvent.changeText(getByPlaceholderText('BTC address'), ADDRESS);
    await act(async () => {
      fireEvent.press(getByText('Connect Wallet'));
    });

    expect(await findByText(/Checking/)).toBeTruthy();
    // PressableButton forwards `disabled` to its Pressable, which RN exposes as
    // accessibilityState.disabled — the built-in RNTL matcher reads exactly that.
    expect(getByRole('button', { name: 'Connect Wallet' })).toBeDisabled();

    await act(async () => {
      pending.resolve(true);
      await pending.promise;
    });

    expect(queryByText(/Checking/)).toBeNull();
  });

  it('clears a stale status when the address is edited afterward', async () => {
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );
    const input = getByPlaceholderText('BTC address');

    await fireEvent.changeText(input, 'bad');
    await act(async () => {
      await fireEvent.press(getByText('Connect Wallet'));
    });
    expect(await findByText('Invalid BTC address')).toBeTruthy();

    await fireEvent.changeText(input, ADDRESS);
    expect(queryByText('Invalid BTC address')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/screens/account-detail/wallet-address-field.component.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/screens/account-detail/wallet-address-field.component.tsx`:

```tsx
import Clipboard from '@react-native-clipboard/clipboard';
import { type FC, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../../design-system/components/box';
import PressableButton from '../../design-system/components/pressable-button';
import SymbolIcon from '../../design-system/components/symbol';
import { isValidBitcoinAddress } from '../../crypto-sync/btc-wallet/bitcoin-address';
import { styles } from './account-detail.styles';
import SyncStatusLine from './sync-status-line.component';
import type { SyncStatus } from './sync-status-line.props';

type WalletAddressFieldProps = {
  /**
   * Runs the wallet Connect sync for a format-valid address and resolves
   * whether it succeeded. The sync fetches the balance BEFORE it marks the
   * account or writes the holding, so this call is also the spec's trial
   * fetch: a bad address persists nothing.
   */
  onConnect: (address: string) => Promise<boolean>;
};

// The wallet counterpart of the Monobank token field: a public BTC address is
// not a secret, so the input is plain (not secureTextEntry) and nothing goes to
// the Keychain — the address lands in the synced holding's metadata.
const WalletAddressField: FC<WalletAddressFieldProps> = ({ onConnect }) => {
  const { theme } = useUnistyles();
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });

  const handleChangeAddress = (value: string): void => {
    setAddress(value);
    setStatus({ kind: 'idle' });
  };

  const handlePasteAddress = (): void => {
    Clipboard.getString().then((value) => {
      setAddress(value.trim());
      setStatus({ kind: 'idle' });
    });
  };

  const handleConnect = (): void => {
    const trimmed = address.trim();

    if (!isValidBitcoinAddress(trimmed)) {
      setStatus({ kind: 'invalid', message: 'Invalid BTC address' });

      return;
    }

    setStatus({ kind: 'checking' });
    onConnect(trimmed).then((connected) => {
      setStatus(
        connected
          ? { kind: 'success', message: 'Wallet connected' }
          : { kind: 'saveError', message: 'Could not connect wallet' },
      );
    });
  };

  return (
    <Box gap={3}>
      <Box direction="row" gap={3} style={styles.fieldRow}>
        <TextInput
          value={address}
          onChangeText={handleChangeAddress}
          placeholder="BTC address"
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.textField}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paste from clipboard"
          onPress={handlePasteAddress}
          style={styles.iconButton}
        >
          <SymbolIcon name="doc.on.clipboard" tone="textSecondary" />
        </Pressable>
      </Box>

      <Box direction="row" gap={2} style={styles.statusLine}>
        <PressableButton
          onPress={handleConnect}
          backgroundColor={theme.colors.accent}
          alignSelf="flex-start"
          disabled={status.kind === 'checking'}
          icon={<SymbolIcon name="link" tone="textPrimary" />}
          label="Connect Wallet"
        />

        <SyncStatusLine status={status} />
      </Box>
    </Box>
  );
};

export default WalletAddressField;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/screens/account-detail/wallet-address-field.component.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint and commit**

Run: `npm run check:lint`
Expected: silent.

```bash
git add src/screens/account-detail/wallet-address-field.component.tsx src/screens/account-detail/wallet-address-field.component.test.tsx
git commit -m "feat(screens): wallet address field with local format check and connect action"
```

---

### Task 15: `BinanceCredentialsField`

**Files:**
- Modify: `.env`, `.env.example`, `src/env.d.ts` (`BINANCE_API_MANAGEMENT_URL`)
- Create: `src/screens/account-detail/binance-credentials-field.component.tsx`
- Create: `src/screens/account-detail/binance-credentials-field.component.test.tsx`

**Interfaces:**
- Consumes: `fetchAccount` (Task 9); `saveCredentials` (Task 8); `SyncStatus`, `SyncStatusLine` (Task 13); primitives + styles as in Task 14; `Linking`.
- Produces: `BinanceCredentialsField` with props `{ onConnect: () => Promise<boolean> }`. Flow on Connect: `fetchAccount(apiKey, secret)` (trial, per spec) → failure = `invalid` "Invalid API key or secret"; `saveCredentials` failure = `saveError` "Could not save credentials"; `onConnect()` false = `saveError` "Could not connect Binance"; true = `success` "Binance connected".

- [ ] **Step 1: Add the management URL to the env files**

Append to `.env` and `.env.example`:

```
# Binance API-key management page, linked from the credentials field.
BINANCE_API_MANAGEMENT_URL=https://www.binance.com/en/my/settings/api-management
```

Add to `src/env.d.ts`: `  export const BINANCE_API_MANAGEMENT_URL: string;`

- [ ] **Step 2: Write the failing test**

`src/screens/account-detail/binance-credentials-field.component.test.tsx`:

```tsx
import { act, fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import BinanceCredentialsField from './binance-credentials-field.component';

const mockFetchAccount = jest.fn();
const mockSaveCredentials = jest.fn();
const mockOpenURL = jest.fn();
const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('../../crypto-sync/binance/binance.client', () => ({
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
}));
jest.mock('../../crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
}));
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

const fillBoth = async (
  getByPlaceholderText: (text: string) => { props: unknown },
): Promise<void> => {
  await fireEvent.changeText(getByPlaceholderText('Binance API key'), 'api-key-fixture');
  await fireEvent.changeText(getByPlaceholderText('Binance API secret'), 'secret-fixture');
};

describe('BinanceCredentialsField', () => {
  const onConnect = jest.fn<Promise<boolean>, []>();

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAccount.mockResolvedValue({ balances: [] });
    mockSaveCredentials.mockResolvedValue(undefined);
    onConnect.mockResolvedValue(true);
  });

  it('renders two secure inputs, a Binance link and a Connect Binance action', async () => {
    const { getByPlaceholderText, getByText } = await render(
      <BinanceCredentialsField onConnect={onConnect} />,
    );

    expect(getByPlaceholderText('Binance API key').props.secureTextEntry).toBe(true);
    expect(getByPlaceholderText('Binance API secret').props.secureTextEntry).toBe(true);
    expect(getByText('Open Binance API Management')).toBeTruthy();
    expect(getByText('Connect Binance')).toBeTruthy();
  });

  it('opens the Binance API management page from the link', async () => {
    const { getByText } = await render(<BinanceCredentialsField onConnect={onConnect} />);

    await fireEvent.press(getByText('Open Binance API Management'));

    expect(mockOpenURL).toHaveBeenCalledWith(
      'https://www.binance.com/en/my/settings/api-management',
    );
  });

  it('pastes into the key and the secret fields separately, trimmed', async () => {
    const { getByLabelText, getByPlaceholderText } = await render(
      <BinanceCredentialsField onConnect={onConnect} />,
    );

    mockGetString.mockResolvedValue(' api-key-fixture ');
    await act(async () => {
      await fireEvent.press(getByLabelText('Paste API key from clipboard'));
    });
    mockGetString.mockResolvedValue('secret-fixture\n');
    await act(async () => {
      await fireEvent.press(getByLabelText('Paste API secret from clipboard'));
    });

    expect(getByPlaceholderText('Binance API key').props.value).toBe('api-key-fixture');
    expect(getByPlaceholderText('Binance API secret').props.value).toBe('secret-fixture');
  });

  it('verifies the pair with one fetchAccount call, saves it, connects, and shows success', async () => {
    const { getByPlaceholderText, getByText, findByText } = await render(
      <BinanceCredentialsField onConnect={onConnect} />,
    );

    await fillBoth(getByPlaceholderText);
    await act(async () => {
      await fireEvent.press(getByText('Connect Binance'));
    });

    expect(mockFetchAccount).toHaveBeenCalledTimes(1);
    expect(mockFetchAccount).toHaveBeenCalledWith('api-key-fixture', 'secret-fixture');
    expect(mockSaveCredentials).toHaveBeenCalledWith({
      apiKey: 'api-key-fixture',
      secret: 'secret-fixture',
    });
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(await findByText('Binance connected')).toBeTruthy();
  });

  it('shows an invalid status and saves nothing when Binance rejects the pair', async () => {
    mockFetchAccount.mockRejectedValue(
      new Error('Binance request failed: 401: Invalid API-key, IP, or permissions for action.'),
    );
    const { getByPlaceholderText, getByText, findByText } = await render(
      <BinanceCredentialsField onConnect={onConnect} />,
    );

    await fillBoth(getByPlaceholderText);
    await act(async () => {
      await fireEvent.press(getByText('Connect Binance'));
    });

    expect(await findByText('Invalid API key or secret')).toBeTruthy();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('shows a distinct save error and does not connect when the Keychain write fails', async () => {
    mockSaveCredentials.mockRejectedValue(new Error('Keychain write failed'));
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <BinanceCredentialsField onConnect={onConnect} />,
    );

    await fillBoth(getByPlaceholderText);
    await act(async () => {
      await fireEvent.press(getByText('Connect Binance'));
    });

    expect(await findByText('Could not save credentials')).toBeTruthy();
    expect(queryByText('Invalid API key or secret')).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('shows a connect error when the pair saved but the sync failed', async () => {
    onConnect.mockResolvedValue(false);
    const { getByPlaceholderText, getByText, findByText } = await render(
      <BinanceCredentialsField onConnect={onConnect} />,
    );

    await fillBoth(getByPlaceholderText);
    await act(async () => {
      await fireEvent.press(getByText('Connect Binance'));
    });

    expect(await findByText('Could not connect Binance')).toBeTruthy();
  });

  it('clears a stale status when either field is edited afterward', async () => {
    mockFetchAccount.mockRejectedValue(new Error('Binance request failed: 401'));
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <BinanceCredentialsField onConnect={onConnect} />,
    );

    await fillBoth(getByPlaceholderText);
    await act(async () => {
      await fireEvent.press(getByText('Connect Binance'));
    });
    expect(await findByText('Invalid API key or secret')).toBeTruthy();

    await fireEvent.changeText(getByPlaceholderText('Binance API secret'), 'secret-fixture-2');
    expect(queryByText('Invalid API key or secret')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/screens/account-detail/binance-credentials-field.component.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

`src/screens/account-detail/binance-credentials-field.component.tsx`:

```tsx
import { BINANCE_API_MANAGEMENT_URL } from '@env';
import Clipboard from '@react-native-clipboard/clipboard';
import { type FC, useState } from 'react';
import { Linking, Pressable, Text as RNText, TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../../design-system/components/box';
import PressableButton from '../../design-system/components/pressable-button';
import SymbolIcon from '../../design-system/components/symbol';
import { fetchAccount } from '../../crypto-sync/binance/binance.client';
import { saveCredentials } from '../../crypto-sync/binance/binance.credentials';
import { styles } from './account-detail.styles';
import SyncStatusLine from './sync-status-line.component';
import type { SyncStatus } from './sync-status-line.props';

type BinanceCredentialsFieldProps = {
  /** Runs the Binance Connect sync once the pair is verified and stored; resolves whether it succeeded. */
  onConnect: () => Promise<boolean>;
};

type Field = 'apiKey' | 'secret';

// The Binance counterpart of the Monobank token field: two secure inputs for a
// read-only ("Enable Reading" only) key pair. Connect verifies the pair with one
// account call BEFORE it is written to the biometric Keychain, then runs the
// first sync. The pair never leaves this component except into `saveCredentials`.
const BinanceCredentialsField: FC<BinanceCredentialsFieldProps> = ({ onConnect }) => {
  const { theme } = useUnistyles();
  const [apiKey, setAPIKey] = useState('');
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });

  const setField = (field: Field, value: string): void => {
    if (field === 'apiKey') {
      setAPIKey(value);
    } else {
      setSecret(value);
    }

    setStatus({ kind: 'idle' });
  };

  const handlePaste = (field: Field): void => {
    Clipboard.getString().then((value) => {
      setField(field, value.trim());
    });
  };

  const handleOpenBinance = (): void => {
    Linking.openURL(BINANCE_API_MANAGEMENT_URL);
  };

  const handleConnect = (): void => {
    setStatus({ kind: 'checking' });
    (async () => {
      try {
        await fetchAccount(apiKey, secret);
      } catch {
        setStatus({ kind: 'invalid', message: 'Invalid API key or secret' });

        return;
      }

      try {
        await saveCredentials({ apiKey, secret });
      } catch {
        setStatus({ kind: 'saveError', message: 'Could not save credentials' });

        return;
      }

      const connected = await onConnect();
      setStatus(
        connected
          ? { kind: 'success', message: 'Binance connected' }
          : { kind: 'saveError', message: 'Could not connect Binance' },
      );
    })();
  };

  return (
    <Box gap={3}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Open Binance API Management"
        onPress={handleOpenBinance}
        style={styles.linkPressable}
      >
        <RNText style={styles.link}>Open Binance API Management</RNText>
      </Pressable>

      <Box direction="row" gap={3} style={styles.fieldRow}>
        <TextInput
          value={apiKey}
          onChangeText={(value) => setField('apiKey', value)}
          placeholder="Binance API key"
          placeholderTextColor={theme.colors.textSecondary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.textField}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paste API key from clipboard"
          onPress={() => handlePaste('apiKey')}
          style={styles.iconButton}
        >
          <SymbolIcon name="doc.on.clipboard" tone="textSecondary" />
        </Pressable>
      </Box>

      <Box direction="row" gap={3} style={styles.fieldRow}>
        <TextInput
          value={secret}
          onChangeText={(value) => setField('secret', value)}
          placeholder="Binance API secret"
          placeholderTextColor={theme.colors.textSecondary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.textField}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paste API secret from clipboard"
          onPress={() => handlePaste('secret')}
          style={styles.iconButton}
        >
          <SymbolIcon name="doc.on.clipboard" tone="textSecondary" />
        </Pressable>
      </Box>

      <Box direction="row" gap={2} style={styles.statusLine}>
        <PressableButton
          onPress={handleConnect}
          backgroundColor={theme.colors.accent}
          alignSelf="flex-start"
          disabled={status.kind === 'checking'}
          icon={<SymbolIcon name="link" tone="textPrimary" />}
          label="Connect Binance"
        />

        <SyncStatusLine status={status} />
      </Box>
    </Box>
  );
};

export default BinanceCredentialsField;
```

The `try/catch` pairs mirror the Monobank token field verbatim (a reviewed, accepted shape for this exact save flow); `kiko-code-style` allows plain code where an `either` fold would read worse.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/screens/account-detail/binance-credentials-field.component.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 6: Lint, security, secrets, commit**

Run: `npm run check:lint && npm run check:security && npm run check:secrets`
Expected: silent.

```bash
git add .env .env.example src/env.d.ts src/screens/account-detail/binance-credentials-field.component.tsx src/screens/account-detail/binance-credentials-field.component.test.tsx
git commit -m "feat(screens): Binance credentials field — verify, store in Keychain, connect"
```

---

### Task 16: `CryptoSyncSection`

**Files:**
- Create: `src/screens/account-detail/format-last-sync.ts`, `src/screens/account-detail/format-last-sync.test.ts`
- Create: `src/screens/account-detail/crypto-sync-section.component.tsx`
- Create: `src/screens/account-detail/crypto-sync-section.component.test.tsx`

**Interfaces:**
- Consumes: `useCryptoSync` (Task 12); `CryptoSyncRequest` (Task 11); `disconnectCryptoAccount` (Task 11); `balanceProviderIds`, `BalanceProviderId`, `isBalanceProviderId`, `providerDisplayName` (Task 1); `syncedAtOf` (Task 1); `accountsRepo.connectedQuery(institution)` (Task 3); `useLiveQuery`; `WalletAddressField` (Task 14); `BinanceCredentialsField` (Task 15); `ChipRow` (`src/screens/forms/chip-row`); `formatDateTime` (`src/dates/format.ts`).
- Produces:
  ```ts
  export const formatLastSyncAt: (lastSyncAt: number | null) => string; // 'Never' | formatDateTime(...)
  export const latestSyncedAt: (holdings: Pick<HoldingRow, 'metadata'>[]) => number | null;
  ```
  `CryptoSyncSection` with props `{ account: AccountRow; holdings: HoldingRow[] }`.

- [ ] **Step 1: Write the failing tests**

`src/screens/account-detail/format-last-sync.test.ts`:

```ts
import { formatDateTime } from '../../dates/format';
import { formatLastSyncAt, latestSyncedAt } from './format-last-sync';

describe('formatLastSyncAt', () => {
  it('renders Never for a null timestamp', () => {
    expect(formatLastSyncAt(null)).toBe('Never');
  });

  it('renders the shared date-time format otherwise', () => {
    expect(formatLastSyncAt(1_700_000_000_000)).toBe(formatDateTime(1_700_000_000_000));
  });
});

describe('latestSyncedAt', () => {
  it('returns the newest syncedAt across the holdings', () => {
    expect(
      latestSyncedAt([
        { metadata: { walletAddress: 'bc1q', syncedAt: 1_000 } },
        { metadata: { iban: 'UA1' } },
        { metadata: { binanceAsset: 'BTC', syncedAt: 3_000 } },
        { metadata: null },
      ]),
    ).toBe(3_000);
  });

  it('returns null when no holding carries a syncedAt', () => {
    expect(latestSyncedAt([{ metadata: { walletAddress: 'bc1q' } }, { metadata: null }])).toBeNull();
    expect(latestSyncedAt([])).toBeNull();
  });
});
```

`src/screens/account-detail/crypto-sync-section.component.test.tsx`:

```tsx
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../design-system/unistyles';
import type { AccountRow, HoldingRow } from '../../db/schema';
import { formatDateTime } from '../../dates/format';
import CryptoSyncSection from './crypto-sync-section.component';

const mockUseLiveQuery = jest.fn();
const mockSync = jest.fn();
const mockUseCryptoSync = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../use-crypto-sync', () => ({
  useCryptoSync: () => mockUseCryptoSync(),
}));
jest.mock('../../crypto-sync/disconnect', () => ({
  disconnectCryptoAccount: (...args: unknown[]) => mockDisconnect(...args),
}));
jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: {
    connectedQuery: (institution: string) => ({
      __institution: institution,
      toSQL: () => ({ sql: '', params: [institution] }),
    }),
  },
}));
// The two fields are tested on their own; here each collapses to one pressable
// that fires `onConnect` with a fixture, so the section's wiring is what is
// under test.
jest.mock('./wallet-address-field.component', () => {
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: (address: string) => Promise<boolean> }) => (
      <Pressable
        accessibilityLabel="wallet-field"
        onPress={() => onConnect('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')}
      >
        <Text>wallet field</Text>
      </Pressable>
    ),
  };
});
jest.mock('./binance-credentials-field.component', () => {
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: () => Promise<boolean> }) => (
      <Pressable accessibilityLabel="binance-field" onPress={() => onConnect()}>
        <Text>binance field</Text>
      </Pressable>
    ),
  };
});

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const account = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a',
  name: 'Cold storage',
  kind: 'crypto',
  institution: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  ...overrides,
});

const holding = (metadata: unknown): HoldingRow => ({
  id: 'h1',
  accountId: 'a',
  name: 'BTC Wallet',
  type: 'crypto_asset',
  currency: 'BTC',
  icon: null,
  color: null,
  balanceMinorUnits: 0,
  metadata,
  sortOrder: 0,
  closedAt: null,
  createdAt: 0,
});

/** Seed the two connected-accounts live queries, keyed on the institution each one was built for. */
const setConnected = (connected: { btc_wallet?: AccountRow[]; binance?: AccountRow[] }): void => {
  mockUseLiveQuery.mockImplementation((query: { __institution: 'btc_wallet' | 'binance' }) => ({
    data: connected[query.__institution] ?? [],
  }));
};

describe('CryptoSyncSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(true);
    mockUseCryptoSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    mockDisconnect.mockResolvedValue(undefined);
    setConnected({});
  });

  it('shows the heading, a Wallet/Binance source picker, and the wallet field by default', async () => {
    const { getByText, getByLabelText, queryByLabelText } = await render(
      <CryptoSyncSection account={account()} holdings={[]} />,
    );

    expect(getByText('Synchronization')).toBeTruthy();
    expect(getByText('Wallet')).toBeTruthy();
    expect(getByText('Binance')).toBeTruthy();
    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByLabelText('binance-field')).toBeNull();
  });

  it('switches to the Binance field when the Binance chip is selected', async () => {
    const { getByText, getByLabelText, queryByLabelText } = await render(
      <CryptoSyncSection account={account()} holdings={[]} />,
    );

    await fireEvent.press(getByText('Binance'));

    expect(getByLabelText('binance-field')).toBeTruthy();
    expect(queryByLabelText('wallet-field')).toBeNull();
  });

  it('runs a wallet connect sync with the address when the wallet field connects', async () => {
    const { getByLabelText } = await render(<CryptoSyncSection account={account()} holdings={[]} />);

    await fireEvent.press(getByLabelText('wallet-field'));

    await waitFor(() =>
      expect(mockSync).toHaveBeenCalledWith({
        providerId: 'btc_wallet',
        targetAccountId: 'a',
        address: ADDRESS,
      }),
    );
  });

  it('runs a Binance connect sync when the Binance field connects', async () => {
    const { getByText, getByLabelText } = await render(
      <CryptoSyncSection account={account()} holdings={[]} />,
    );

    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() =>
      expect(mockSync).toHaveBeenCalledWith({ providerId: 'binance', targetAccountId: 'a' }),
    );
  });

  it('hides the wallet field and hints when another account already holds the wallet connection', async () => {
    setConnected({ btc_wallet: [account({ id: 'other', institution: 'btc_wallet' })] });
    const { getByText, queryByLabelText } = await render(
      <CryptoSyncSection account={account()} holdings={[]} />,
    );

    expect(queryByLabelText('wallet-field')).toBeNull();
    expect(getByText('Wallet is already connected to another account')).toBeTruthy();
  });

  it('once connected to a wallet, shows Sync now + last sync and Disconnect Wallet, no picker or fields', async () => {
    const syncedAt = 1_700_000_000_000;
    const { getByText, queryByText, queryByLabelText } = await render(
      <CryptoSyncSection
        account={account({ institution: 'btc_wallet' })}
        holdings={[holding({ walletAddress: ADDRESS, syncedAt })]}
      />,
    );

    expect(getByText('Sync now')).toBeTruthy();
    expect(getByText('Disconnect Wallet')).toBeTruthy();
    const stamp = formatDateTime(syncedAt);
    expect(getByText(new RegExp(stamp.replace(/[.]/g, '\\.')))).toBeTruthy();
    expect(queryByText('Binance')).toBeNull();
    expect(queryByLabelText('wallet-field')).toBeNull();
  });

  it('shows Never when a connected account has no synced holding yet', async () => {
    const { getByText } = await render(
      <CryptoSyncSection account={account({ institution: 'binance' })} holdings={[]} />,
    );

    expect(getByText(/Last sync: Never/)).toBeTruthy();
  });

  it('re-syncs a connected wallet account without an address', async () => {
    const { getByText } = await render(
      <CryptoSyncSection account={account({ institution: 'btc_wallet' })} holdings={[]} />,
    );

    await fireEvent.press(getByText('Sync now'));

    await waitFor(() =>
      expect(mockSync).toHaveBeenCalledWith({ providerId: 'btc_wallet', targetAccountId: 'a' }),
    );
  });

  it('confirms before disconnecting Binance, then disconnects with the provider id', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      (buttons ?? []).find((button) => button.style === 'destructive')?.onPress?.();
    });
    const { getByText } = await render(
      <CryptoSyncSection account={account({ institution: 'binance' })} holdings={[]} />,
    );

    await fireEvent.press(getByText('Disconnect Binance'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Disconnect Binance',
      expect.stringContaining('stored API key'),
      expect.any(Array),
    );
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalledWith('a', 'binance'));
    alertSpy.mockRestore();
  });

  it('shows Syncing… while a sync is in flight and surfaces the hook error', async () => {
    mockUseCryptoSync.mockReturnValue({ isSyncing: true, error: 'Binance request failed: 401', sync: mockSync });
    const { getByText } = await render(
      <CryptoSyncSection account={account({ institution: 'binance' })} holdings={[]} />,
    );

    expect(getByText('Syncing…')).toBeTruthy();
    expect(getByText('Binance request failed: 401')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/screens/account-detail/format-last-sync.test.ts src/screens/account-detail/crypto-sync-section.component.test.tsx`
Expected: FAIL — both modules missing.

- [ ] **Step 3: Implement the helpers**

`src/screens/account-detail/format-last-sync.ts`:

```ts
import { formatDateTime } from '../../dates/format';
import type { HoldingRow } from '../../db/schema';
import { syncedAtOf } from '../../holdings/holding-metadata';

export const formatLastSyncAt = (lastSyncAt: number | null): string =>
  lastSyncAt === null ? 'Never' : formatDateTime(lastSyncAt);

/**
 * The newest balance-sync stamp across an account's holdings. A balance sync
 * records `syncedAt` on the holding it wrote (never on `settings.lastSyncAt`,
 * which is Monobank's statement cursor), so the account's "last sync" is the
 * max over its holdings.
 */
export const latestSyncedAt = (holdings: Pick<HoldingRow, 'metadata'>[]): number | null => {
  const stamps = holdings
    .map((holding) => syncedAtOf(holding.metadata))
    .filter((stamp): stamp is number => stamp !== null);

  return stamps.length > 0 ? Math.max(...stamps) : null;
};
```

- [ ] **Step 4: Implement the section**

`src/screens/account-detail/crypto-sync-section.component.tsx`:

```tsx
import { type FC, useState } from 'react';
import { Alert } from 'react-native';
import { match } from 'ts-pattern';
import { useUnistyles } from 'react-native-unistyles';
import type { AccountRow, HoldingRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Text from '../../design-system/components/text';
import SymbolIcon from '../../design-system/components/symbol';
import PressableButton from '../../design-system/components/pressable-button';
import { disconnectCryptoAccount } from '../../crypto-sync/disconnect';
import { accountsRepo } from '../../repositories/accounts.repo';
import type { CryptoSyncRequest } from '../../crypto-sync/run-crypto-sync';
import {
  type BalanceProviderId,
  balanceProviderIds,
  isBalanceProviderId,
  providerDisplayName,
} from '../../crypto-sync/provider';
import ChipRow from '../forms/chip-row';
import { useCryptoSync } from '../use-crypto-sync';
import { styles } from './account-detail.styles';
import WalletAddressField from './wallet-address-field.component';
import { formatLastSyncAt, latestSyncedAt } from './format-last-sync';
import BinanceCredentialsField from './binance-credentials-field.component';

type CryptoSyncSectionProps = {
  account: AccountRow;
  holdings: HoldingRow[];
};

const sourceLabels: Record<BalanceProviderId, string> = {
  btc_wallet: providerDisplayName('btc_wallet'),
  binance: providerDisplayName('binance'),
};

// A re-sync carries no address — the wallet provider reads the stored one.
const resyncRequest = (providerId: BalanceProviderId, targetAccountId: string): CryptoSyncRequest =>
  match(providerId)
    .with('btc_wallet', (id) => ({ providerId: id, targetAccountId }))
    .with('binance', (id) => ({ providerId: id, targetAccountId }))
    .exhaustive();

const disconnectMessage = (providerId: BalanceProviderId): string =>
  match(providerId)
    .with(
      'btc_wallet',
      () => 'This clears the connection. Your BTC holding stays as a manual snapshot.',
    )
    .with(
      'binance',
      () =>
        'This clears the connection and the stored API key. Your BTC holding stays as a manual snapshot.',
    )
    .exhaustive();

// The crypto account's Synchronization section — the counterpart of the bank
// account's Monobank token field + Connect/Sync/Disconnect row. Before a
// connection: a Wallet/Binance source picker and the matching entry field
// (each field's Connect runs the first sync, which marks the account). Once
// connected: Sync now with the last-sync stamp, and a confirmed Disconnect.
const CryptoSyncSection: FC<CryptoSyncSectionProps> = ({ account, holdings }) => {
  const { theme } = useUnistyles();
  const { isSyncing, error, sync } = useCryptoSync();
  const [source, setSource] = useState<BalanceProviderId>('btc_wallet');
  // One connection per institution: another account holding the picked source
  // blocks connecting it here (the same rule `runBalanceSync` enforces).
  const { data: walletAccounts } = useLiveQuery(accountsRepo.connectedQuery('btc_wallet'), [
    'accounts',
  ]);
  const { data: binanceAccounts } = useLiveQuery(accountsRepo.connectedQuery('binance'), [
    'accounts',
  ]);
  const connectedProvider = isBalanceProviderId(account.institution)
    ? account.institution
    : undefined;
  const sourceAccounts = source === 'btc_wallet' ? walletAccounts : binanceAccounts;
  const sourceConnectedElsewhere = sourceAccounts.some((connected) => connected.id !== account.id);

  const connectWallet = (address: string): Promise<boolean> =>
    sync({ providerId: 'btc_wallet', targetAccountId: account.id, address });

  const connectBinance = (): Promise<boolean> =>
    sync({ providerId: 'binance', targetAccountId: account.id });

  const runDisconnect = async (providerId: BalanceProviderId): Promise<void> => {
    try {
      await disconnectCryptoAccount(account.id, providerId);
    } catch {
      Alert.alert('Could not disconnect', 'Please try again.');
    }
  };

  const confirmDisconnect = (providerId: BalanceProviderId): void => {
    Alert.alert(`Disconnect ${providerDisplayName(providerId)}`, disconnectMessage(providerId), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          runDisconnect(providerId);
        },
      },
    ]);
  };

  if (connectedProvider !== undefined) {
    return (
      <Box gap={3}>
        <Text variant="heading">Synchronization</Text>

        <Box direction="row" gap={2} style={styles.statusLine}>
          <PressableButton
            onPress={() => {
              sync(resyncRequest(connectedProvider, account.id));
            }}
            disabled={isSyncing}
            backgroundColor={theme.colors.accent}
            alignSelf="flex-start"
            icon={<SymbolIcon name="arrow.triangle.2.circlepath" tone="textPrimary" />}
            label={isSyncing ? 'Syncing…' : 'Sync now'}
          />

          <Box direction="row" gap={2} style={styles.statusLine}>
            <SymbolIcon name="clock" tone="textSecondary" />

            <Text variant="body" tone="textSecondary">
              Last sync: {formatLastSyncAt(latestSyncedAt(holdings))}
            </Text>
          </Box>
        </Box>

        <PressableButton
          onPress={() => confirmDisconnect(connectedProvider)}
          backgroundColor={theme.colors.surfaceHigh}
          alignSelf="flex-start"
          icon={<SymbolIcon name="link.badge.plus" tone="textPrimary" />}
          label={`Disconnect ${providerDisplayName(connectedProvider)}`}
        />

        {error !== undefined && (
          <Text variant="body" tone="negative">
            {error}
          </Text>
        )}
      </Box>
    );
  }

  return (
    <Box gap={3}>
      <Text variant="heading">Synchronization</Text>

      <ChipRow
        label="Source"
        options={balanceProviderIds}
        selected={source}
        onSelect={setSource}
        labels={sourceLabels}
      />

      {sourceConnectedElsewhere && (
        <Text variant="caption" tone="textSecondary">
          {providerDisplayName(source)} is already connected to another account
        </Text>
      )}

      {!sourceConnectedElsewhere && source === 'btc_wallet' && (
        <WalletAddressField onConnect={connectWallet} />
      )}

      {!sourceConnectedElsewhere && source === 'binance' && (
        <BinanceCredentialsField onConnect={connectBinance} />
      )}

      {error !== undefined && (
        <Text variant="body" tone="negative">
          {error}
        </Text>
      )}
    </Box>
  );
};

export default CryptoSyncSection;
```

Re-sort each import group shortest-line-first when the file is written (the block above groups them correctly; Biome does not reorder). `sourceLabels` is a `Record` keyed by the closed tuple — the same reviewer-approved shape as `KIND_ICON` in `accounts.screen.tsx`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/screens/account-detail/format-last-sync.test.ts src/screens/account-detail/crypto-sync-section.component.test.tsx`
Expected: PASS (4 + 10 tests).

- [ ] **Step 6: Lint, dup, commit**

Run: `npm run check:lint && npm run check:dup`
Expected: silent.

```bash
git add src/screens/account-detail/format-last-sync.ts src/screens/account-detail/format-last-sync.test.ts src/screens/account-detail/crypto-sync-section.component.tsx src/screens/account-detail/crypto-sync-section.component.test.tsx
git commit -m "feat(screens): CryptoSyncSection — wallet/Binance connect, sync now, disconnect"
```

---

### Task 17: Render the section on a crypto account

**Files:**
- Modify: `src/screens/account-detail/account-detail.screen.tsx:3-4` (imports), `:42-43` (remove local `formatLastSyncAt`), `:234-312` (render)
- Modify: `src/screens/account-detail/account-detail.screen.test.tsx` (mock + gating tests)

**Interfaces:**
- Consumes: `CryptoSyncSection` (Task 16); `formatLastSyncAt` from `./format-last-sync` (Task 16).
- Produces: a `crypto` account renders `CryptoSyncSection` between the Balance block and the Holdings grid; bank/cash accounts do not.

- [ ] **Step 1: Write the failing tests**

In `src/screens/account-detail/account-detail.screen.test.tsx`, add a mock next to the other component mocks (after the `settings.repo` mock, before the `type Account` line):

```tsx
// The crypto section is tested on its own; here it collapses to a marker view
// so the screen's kind-gating is what is under test.
jest.mock('./crypto-sync-section.component', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ account }: { account: { id: string } }) => (
      <View testID="crypto-sync-section" accessibilityLabel={`crypto-sync ${account.id}`} />
    ),
  };
});
```

Add inside `describe('AccountDetailScreen', …)`:

```tsx
  it('renders the crypto sync section for a crypto account, with that account', async () => {
    setLiveData({ accounts: [account({ kind: 'crypto', name: 'Cold storage' })], holdings: [] });
    const { getByTestId, getByLabelText, queryByPlaceholderText } = await renderScreen();

    expect(getByTestId('crypto-sync-section')).toBeTruthy();
    expect(getByLabelText('crypto-sync a')).toBeTruthy();
    // no Monobank controls on a crypto account
    expect(queryByPlaceholderText('Monobank token')).toBeNull();
  });

  it.each([
    ['a bank account', account({ kind: 'bank' })],
    ['a cash account', account({ kind: 'cash' })],
  ])('does not render the crypto sync section for %s', async (_label, testAccount) => {
    setLiveData({ accounts: [testAccount], holdings: [] });
    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('crypto-sync-section')).toBeNull();
  });

  it('does not render the crypto sync section before the account has loaded', async () => {
    setLiveData({ accounts: [], holdings: [] });
    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('crypto-sync-section')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/screens/account-detail/account-detail.screen.test.tsx`
Expected: FAIL — `Unable to find an element with testID: crypto-sync-section` (the mock target module exists, so only the render assertion fails).

- [ ] **Step 3: Wire the screen**

In `src/screens/account-detail/account-detail.screen.tsx`:

1. Add to the local import group (keep shortest-first order): `import { formatLastSyncAt } from './format-last-sync';` and `import CryptoSyncSection from './crypto-sync-section.component';`. Remove `import { formatDateTime } from '../../dates/format';` if `formatDateTime` is now unused in the file (it is only used by the local helper being removed).
2. Delete the local helper (lines 42–43):
   ```ts
   const formatLastSyncAt = (lastSyncAt: number | null): string =>
     lastSyncAt === null ? 'Never' : formatDateTime(lastSyncAt);
   ```
3. Next to `const isBankAccount = account?.kind === 'bank';` add:
   ```ts
     const isCryptoAccount = account?.kind === 'crypto';
   ```
4. In the JSX, directly after the Balance block's closing `</Box>` and before `{showActionButton && <Box style={styles.divider} />}`, insert:
   ```tsx
           {isCryptoAccount && account && <Box style={styles.divider} />}

           {isCryptoAccount && account && (
             <CryptoSyncSection account={account} holdings={activeHoldings} />
           )}
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/screens/account-detail`
Expected: PASS (every account-detail suite).

- [ ] **Step 5: CHECKPOINT — full suite + harness**

Run: `npx jest` then `npm run check:all`
Expected: PASS; silent. The navigator suites (`src/navigation/accounts.stack.test.tsx`, `root.navigator.test.tsx`, `__tests__/App.test.tsx`) now load the real `CryptoSyncSection` graph — `@noble/hashes` (transform-exempted in Task 7), `react-native-keychain` (imports cleanly under Jest; it only destructures `NativeModules`), the `@env` keys, and two more `useLiveQuery` calls over their existing op-sqlite mock. If one of them fails on the new `useLiveQuery` calls, extend THAT test's `use-live-query` / `accounts.repo` mock the same way `account-detail.screen.test.tsx` does (`connectedQuery` returning a `toSQL()`-bearing stub) — do not mock the section away in a navigator test that never asserts on it.

- [ ] **Step 6: Commit**

```bash
git add src/screens/account-detail/account-detail.screen.tsx src/screens/account-detail/account-detail.screen.test.tsx
git commit -m "feat(screens): crypto account detail renders the CryptoSyncSection"
```

---
## Phase F — Done criteria

### Task 18: Deep verification and device smoke

**Files:** none created. Read-only verification plus one manual device pass.

- [ ] **Step 1: Full unit suite**

Run: `npx jest`
Expected: PASS, zero skipped.

- [ ] **Step 2: Fast + medium harness tiers**

Run: `npm run check:all`
Expected: silent. Specifically re-confirm: `check:knip` reports no unused export (every `crypto-sync` export now has an app-code consumer through `CryptoSyncSection` → `useCryptoSync` → `runCryptoSync`), `check:deps` accepts the `@noble/hashes` block, `check:secrets` is clean on the HMAC vector test.

- [ ] **Step 3: Deep tier**

Run: `npm run check:deep`
Expected: Stryker mutation score at or above the `break` threshold (60); osv-scanner reports only the two known `image-size` advisories documented in `CLAUDE.md` ("Known dependency CVEs") — nothing for `@noble/hashes`. If Stryker surfaces surviving mutants in `crypto-sync/`, add the killing assertion to that module's colocated test (e.g. an off-by-one in `latestSyncedAt`, a swapped `funded`/`spent` in the explorer client) rather than lowering the threshold.

- [ ] **Step 4: Device smoke (ops agent builds; user or coordinator drives)**

Build to the simulator or device per the `ops` skill. On a simulator, enroll Face ID first (Features > Face ID > Enrolled) or the Binance Keychain write fails with "Could not save credentials". Walk:

1. Create a `crypto` account → open it → the Synchronization section shows the Wallet/Binance chips with the wallet field.
2. Paste a real mainnet address (the genesis address `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` works as a public, non-zero example) → Connect Wallet → the section flips to Sync now / Disconnect Wallet, one "BTC Wallet" `crypto_asset` holding appears with a BTC balance, the account balance converts through the existing BTC→USD rate, "Last sync" shows a stamp.
3. Type a malformed address → "Invalid BTC address" with no network call.
4. Open a second crypto account → the wallet chip shows "Wallet is already connected to another account"; Binance is still offered.
5. Sync now → balance refreshes in place (no duplicate holding). Long-press the holding → no delete menu (synced).
6. Disconnect Wallet → confirm → the section returns to the picker; the holding stays, now deletable.
7. Binance (with a real read-only key): Connect Binance → Face ID prompt → "Binance connected" → "Binance BTC" holding with `free + locked`. Kill and relaunch → Sync now prompts Face ID and refreshes. Wrong secret → "Invalid API key or secret". Disconnect Binance → the Keychain item is gone (Sync now after re-connecting requires re-entering the pair).

- [ ] **Step 5: Report**

Report to the coordinator: the check outputs, the Stryker score, the smoke results, and the two knowledge follow-ups for the scribe (below). No commit is made in this task.

---

## Scribe follow-ups (not developer work)

- `.claude/skills/kiko-architecture/SKILL.md`: add a "Balance sync (wallet / Binance)" section next to the Monobank pipeline — the `BalanceProvider`/`runBalanceSync` shape, "fetch before mark", `syncedAt` on the holding (never `settings.lastSyncAt`), Keychain `kiko.binance.credentials` with biometric access control.
- `.claude/skills/kiko-domain/SKILL.md`: `transactions.source` now `manual | monobank | btc_wallet | binance`; `holdings.metadata` gains `{ walletAddress, syncedAt }` / `{ binanceAsset: 'BTC', syncedAt }`; `accounts.institution` conventional values `monobank | btc_wallet | binance`.

## Open questions deferred (flagged, not decided here)

- **Auto-sync for crypto accounts.** The spec leaves this open. Not wired in this plan: `use-auto-sync.ts` stays Monobank-only. When wanted, it is one call per connected crypto account — `runCryptoSync({ providerId, targetAccountId })` for each row of `accountsRepo.connectedQuery('btc_wallet')` / `('binance')` — gated on the holding's `syncedAt` via `latestSyncedAt` with the existing `AUTO_SYNC_INTERVAL_MS`. Note the Binance branch would raise a Face ID prompt on app open, which is a UX decision for the user.
- **Unconfirmed (mempool) BTC.** The wallet balance is confirmed-only by design (Task 5). If pending receipts should show, add `mempool_stats` to the sum behind a setting.

## Deviations from the spec (deliberate, each with its reason)

1. **No `transactions.source` migration.** The spec expects a drizzle migration; the drizzle snapshot format does not record SQLite text-enum values (verified against `meta/0005_snapshot.json`), so `drizzle-kit generate` produces nothing. The TS enum is widened and asserted (`schema.test.ts`); Task 1 Step 8 confirms the empty diff.
2. **`fetchBalances(deps, target)` takes a second `SyncTarget` argument** (`{ accountId, holdings }`) so the wallet provider can read the stored address on a re-sync — the spec's `fetchBalances(deps)` has no path to the target holding.
3. **`ProviderBalance.name`** added so `runBalanceSync` can insert a named holding without a provider-id switch in the driver.
4. **`BalanceProvider.metadataField`** added (instead of deriving `provider.id + 'Key'`) so the repo's metadata-key upsert is driven by the provider, matching the spec's `walletAddress` / `binanceAsset` names exactly.
5. **Last-sync timestamp lives on the holding (`metadata.syncedAt`), not `settings.lastSyncAt`.** Monobank's `lastSyncAt` is also the statement-window cursor of the next Monobank import (`monobank/sync.ts` lines 289–292); a balance sync writing it would silently skip Monobank transactions. The spec explicitly left this open.
6. **Fetch before mark.** `runBalanceSync` marks the account `institution` only after `fetchBalances` succeeds (Monobank marks first), so a failed first connect never leaves a half-connected account. This also makes the sync itself the spec's "trial fetch before persisting" for the wallet field (Task 14).
7. **`upsertExchange` is one generic entry over a shared helper** that `upsertMonobank` also uses — the spec allowed either shape; this removes the duplicated match/update/insert block.
8. **`accountsRepo.disconnectMonobank` → `accountsRepo.disconnect`** (generalized), because `isSyncedAccount` now protects wallet/Binance accounts from deletion and they need the same Disconnect path the spec describes for the Connect/Disconnect UI.
9. **`@noble/hashes` instead of a hand-rolled SHA-256.** Still pure JS with no native pod (the spec's constraint); an audited primitive over a hand-written compression loop. Requires the user's dependency approval before Task 7.
10. **Field action label is "Connect Wallet" / "Connect Binance", not "Save"**, because on a crypto account the persist step IS the first sync (the address has nowhere to live before the holding exists); the spec leaves entry-point copy to implementation.
