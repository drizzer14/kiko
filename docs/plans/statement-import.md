# Statement-File Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a user get their bank's exported statement file into Kiko two ways — an in-app document-picker button on the account screen, and an iOS Share Extension that receives a file shared directly from the bank app — parsed on-device into the exact same `Account -> Holding -> Transaction` rows Kiko's live provider sync writes, with re-import-safe dedup, across Monobank plus the other Ukrainian banks a displaced Kiko user is likely to hold (`kiko-users-ukrainian-globally-displaced`).

**Architecture:** A `StatementFormat` abstraction (`detect` + `parse`, one implementation per bank/export shape) sits behind a small registry that auto-detects which format a file is. Its parser output is mapped, by a dedicated `mapping.ts` module, into the identical `NewTransaction` shape `src/monobank/sync/sync.ts`'s `mapStatementItem` already produces, and is written through the SAME `transactionsRepo.addManyDedup` (`src/transactions/repo/transactions.repo.ts`) upsert every other sync path uses — so a file import is a third producer of ordinary rows, not a parallel ledger. The two entry points (document picker, Share Extension) both resolve to one on-device file path and hand off to one shared screen; nothing is uploaded anywhere. **This revision** grounds the per-bank format facts, and the registry's eventual bank coverage, in `OSadovy/uabean` (MIT) — its Python Beancount importers and sample fixtures are the only source of real, verified per-bank export shapes available without the user owning an account at every bank; every format is REIMPLEMENTED IN TYPESCRIPT from those facts, never ported/vendored (section C.0).

**Tech Stack:** React Native + TypeScript, op-sqlite + Drizzle (`src/db/schema.ts`), `papaparse` (CSV — Monobank, Sensebank), a spreadsheet reader (XLSX/XLS — PrivatBank, and the deferred PUMB/ProCredit formats), a cp1251 decoder (Sensebank; the deferred business-portal CSVs), a document picker + a file-read library (new dependencies — see Phase 1), a native iOS Share Extension target (Swift, the final phase), i18next (`src/i18n/locales/{en,uk}.ts`), Jest + RNTL, Maestro (`.maestro/`).

**Spec:** `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md` (domain model, storage) plus `docs/plans/bank-providers.md` (the live-API `BankProvider` abstraction this importer must stay output-compatible with — read there for `ProviderAccount`/`ProviderStatementItem`, which this plan's `ParsedAccountHint`/`ParsedTransaction` deliberately mirror) plus `OSadovy/uabean` (https://github.com/OSadovy/uabean, MIT, format-knowledge reference only — section C.0). Read `kiko-architecture`, `kiko-domain`, `kiko-code-style` (project skills) before implementing — they are the source of truth for storage/domain/style conventions, not restated here.

## Global Constraints

- Every DB write goes through `db.transaction()` (`kiko-architecture`) — this plan adds no new write path; it reuses `transactionsRepo.addManyDedup`, which already wraps its upsert in one `write(...)`.
- `Money.minorUnits` is always an integer, never a float (`kiko-domain`) — every parsed amount converts through `Money.fromMajor`/`parseAmount` (`src/currency/`), never a bare `Number(...) * 100`.
- Parsing runs entirely on the device. No statement file, or any row parsed from one, is ever sent to a server — Kiko has no backend (see section F).
- `transactions.source` (`src/db/schema.ts:125`) is a Drizzle TS-only enum — adding `'import'` is a one-line change, no migration, exactly the precedent `docs/plans/bank-providers.md` sets for adding `'privatbank'`.
- Every new native-module/parser dependency (document picker, file-read, CSV, spreadsheet, XML, cp1251 decode) is pinned exact (`.npmrc` `save-exact=true`, root `CLAUDE.md` "Pin exact dependency versions") and needs explicit approval before the phase that first needs it starts — NONE of them are on the project's pre-approved list. Section C.5 is the authoritative list; nothing in this plan is installed by writing it.
- Every `StatementFormat` is an INDEPENDENT TypeScript reimplementation informed by uabean's format knowledge, never a ported/translated/vendored copy of its Python — section C.0 states the license/credit obligation this creates and exactly how it is satisfied.
- `npm run check:all` (`make gate`) after every task; `make verify` (lint + full Jest + gate) before a phase is declared done; `make deep` before the whole feature is declared done (root `CLAUDE.md`).

---

## Grounding: what already exists

Read directly, not restated in full here:

- **The exact target shape** — `transactionsRepo.addManyDedup` (`src/transactions/repo/transactions.repo.ts:586-643`): upserts a batch on the `(source, external_id)` unique index (`transactions_source_external`, `src/db/schema.ts:130`), applies name→category override rules, and refreshes only the BANK-owned columns on conflict (`amountMinorUnits`, `description`, `hold`, `mcc`, `counterIban`, `time` — never `category`/`comment`). This is the exact dedup engine this plan needs; it is not rebuilt, only fed.
- **The exact mapping precedent** — `mapStatementItem` (`src/monobank/sync/sync.ts:232-259`) turns one bank statement item into a `NewTransaction`; `mapAccountToHolding` (`sync.ts:261-279`) turns one bank account into a `NewHolding`. This plan's `mapping.ts` (section A) produces the identical `NewTransaction` field set for a parsed row, regardless of which bank format produced it.
- **Currency + category mappers already generic enough to reuse** — `categoryForMcc` (`src/monobank/mcc-category/mcc-category.ts:69`) takes a bare MCC number, nothing Monobank-specific about its signature; Monobank's and Sensebank's CSVs both carry an MCC column and both reuse it (section C). `currencyFromCode` (`src/monobank/currency-code/currency-code.ts`) maps a NUMERIC ISO 4217 code; none of the file formats studied for this plan use numeric codes (Monobank's currency is embedded in a header label, PrivatBank's is a Ukrainian word abbreviation, Sensebank's is an alphabetic code in a preamble line) — every format validates its own currency text against `isCurrency`/`currencyOptions` (`src/currency/currency/currency.ts:15,378`) instead, through a small per-format lookup table (section C).
- **The amount/money boundary** — `parseAmount` (`src/currency/parse/parse.ts`) turns a decimal-separator-ambiguous string into a `number`; `Money.fromMajor(currency, major)` (`src/currency/money/money.ts:22`) turns that into integer minor units at the correct per-currency scale. Both are already used together in `holding-form.screen.tsx`, and both are format-agnostic enough to serve Monobank's dot-decimal amounts and PUMB/Sensebank/PrivatBank's comma-decimal ones identically.
- **The write targets** — `holdingsRepo.create` (`src/holdings/repo/holdings.repo.ts:179-200`, seeds an opening-balance `manual` row for a non-zero balance), `holdingsRepo.listByAccountQuery`/`allQuery`, `accountsRepo.listQuery`/`create` (`src/accounts/accounts.repo.ts`). An imported statement's target is always a PLAIN (non-institution-owned) holding — never a synced one; see the deletability decision in section D.
- **The account-screen seam** — `src/screens/account-detail/account-detail.screen.tsx`: its `Screen`'s `footer` currently renders one primary `Button` ("Add holding", line ~185-193). This is where the new Import-statement action lands (section B.1).
- **The App Group entitlement ALREADY EXISTS and is UNUSED** — `ios/Kiko/Kiko.entitlements` already declares `com.apple.security.application-groups: group.com.dmytro-vasylkivskyi.kiko`, and nothing in the app currently reads or writes it. This is the exact container the Share Extension hands a file through (section B.2) — no new App Group id needs registering in the Apple Developer portal, only the extension target needs the SAME entitlement added to ITS entitlements file.
- **The harness already anticipates an App-Group write** — `rules/semgrep-mobile.yml`'s `kiko-appgroup-write-needs-protection` rule (Class A / ERROR) and its fixture pair (`rules/fixtures/kiko-appgroup-write-needs-protection.{bad,good}.swift`) fail `check:security`/`check:rules` on any `.swift` file that writes into the App Group container without setting BOTH `isExcludedFromBackup` and an explicit `FileProtectionType` after the write. The Share Extension's Swift file (section B.2) must follow the `.good.swift` fixture's shape exactly, or the gate fails — this is not optional hardening, it is an already-enforced check.
- **Deletability precedent this plan must follow deliberately** — `isSyncedTransaction` (`src/holdings/deletable/deletable.ts:11`) is `row.source !== 'manual'`, and gates `transactionsRepo.remove` (throws for a non-manual row) independently of the holding/account check `isSyncedHolding` performs. Section D decides `'import'` rows follow this same gate (like `'monobank'`/`'binance'` rows) even though their HOLDING is a plain, fully-deletable one — read section D for why.
- **Folder/style conventions** — `kiko-code-style`: functional modules (no classes) for the importer/registry, `ts-pattern` only for closed-literal mapping (not applicable to format auto-detection, which is a `find()` over a registry array), folder-per-thing co-location, `.repo.ts`/`.screen.tsx`/`.component.tsx` suffixes.

---

## A. Architecture: `StatementImporter` abstraction + format registry

New feature folder `src/statement-import/`, sibling to `src/monobank/`, `src/crypto-sync/`, and the planned `src/bank-sync/` (`docs/plans/bank-providers.md`) — same layer, different input channel (a file, not an API call).

### A.1 The parser contract

```ts
// src/statement-import/parser/parser.ts

import type { Currency } from '../../currency/currency';

/** One row of a parsed statement, before domain mapping. Deliberately mirrors
 * `docs/plans/bank-providers.md`'s `ProviderStatementItem` shape (externalId,
 * amount, time, description, mcc, counterIban, comment) so the SAME mapping
 * discipline applies to a file-sourced row as to a live-API one. */
export type ParsedTransaction = {
  /** A bank-issued unique id, when the export format actually carries one.
   * NONE of the formats studied for this plan (section C) carry one —
   * `undefined` here is the NORMAL case, not a placeholder. The mapper (A.3)
   * synthesizes a deterministic key when this is absent (section D). */
  externalId?: string;
  amountMinorUnits: number;
  timeSeconds: number;
  description: string;
  mcc?: number;
  counterIban?: string;
  comment?: string;
};

export type ParsedAccountHint = {
  currency: Currency;
  /** A display name suggestion for a newly created holding (e.g. a masked
   * PAN or the export's own account label), never used to MATCH an existing
   * holding — matching is always the user's explicit pick (section C.3). A
   * multi-card PrivatBank export (section C.2) may carry MULTIPLE distinct
   * masked cards across its rows; this hint is only ever a suggestion for
   * the single-card case. */
  suggestedName?: string;
  iban?: string;
  maskedPan?: string;
};

export type ParsedStatement = {
  formatId: StatementFormatId;
  account: ParsedAccountHint;
  transactions: ParsedTransaction[];
};

/** One entry per SHIPPED format. See section C.5/E for the priority tiers —
 * a format earns a place in this tuple only once its own phase lands; the
 * P3/out-of-scope banks in section C are deliberately NOT listed here yet. */
export const statementFormatIds = ['monobank-csv', 'privatbank-xlsx', 'sensebank-csv'] as const;
export type StatementFormatId = (typeof statementFormatIds)[number];

export type StatementFormatInput = { text: string; fileName: string };

export interface StatementFormat {
  id: StatementFormatId;
  displayName: string;
  /** A cheap, non-throwing header/content-signature sniff — see section C
   * for each format's exact signature. Mirrors the `(part, regexp)`
   * matcher shape uabean's own `IdentifyMixin` uses (content/filename/mime
   * matchers, `src/uabean/importers/mixins.py`) — a pattern worth
   * following for its OWN sake (a proven multi-format dispatch shape), not
   * because any of ITS code is reused. */
  detect: (input: StatementFormatInput) => boolean;
  /** Throws `StatementParseError` on a file that `detect` accepted but whose
   * body doesn't actually parse (a truncated download, a locale variant the
   * column mapper doesn't recognize). */
  parse: (input: StatementFormatInput) => ParsedStatement;
}

export class StatementParseError extends Error {}
```

A binary format (PrivatBank's `.xlsx`) cannot be represented as `text` the way a CSV can — section C.2 notes the one adjustment `StatementFormatInput`/the file-read layer needs for a spreadsheet format (reading it as bytes/base64, not UTF-8 text) without changing this contract's shape for every OTHER format.

### A.2 The registry

```ts
// src/statement-import/registry/registry.ts
import { monobankCsvFormat } from '../formats/monobank-csv';
import { privatbankXlsxFormat } from '../formats/privatbank-xlsx';
import { sensebankCsvFormat } from '../formats/sensebank-csv';
import type { StatementFormat, StatementFormatInput } from '../parser';

export const statementFormats: StatementFormat[] = [
  monobankCsvFormat,
  privatbankXlsxFormat,
  sensebankCsvFormat,
];

/** First format whose `detect` accepts the input, or `undefined` — a file
 * matching no known format is NOT an error here, it is the screen's "we
 * don't recognize this file" state (section B.1). */
export const detectFormat = (input: StatementFormatInput): StatementFormat | undefined =>
  statementFormats.find((format) => format.detect(input));
```

Adding a format is exactly one new entry in `statementFormats` PLUS one line in A.1's `statementFormatIds` tuple; nothing else in this plan changes shape. This is deliberately why the P3/deferred and out-of-scope banks in section C are still worth documenting now even though they aren't registered yet — the next implementer has the exact facts ready rather than needing to re-derive them.

### A.3 Domain mapping — feeds the EXACT existing write path

```ts
// src/statement-import/mapping/mapping.ts
import { categoryForMcc } from '../../monobank/mcc-category';
import { normalizeTransactionName } from '../../transactions/normalize-name';
import type { TransactionRow } from '../../db/schema';
import type { ParsedTransaction } from '../parser';

type NewTransaction = Pick<TransactionRow, 'holdingId' | 'amountMinorUnits' | 'time' | 'source'> &
  Partial<
    Pick<TransactionRow, 'description' | 'category' | 'mcc' | 'counterIban' | 'comment' | 'externalId'>
  >;

/** Deterministic, order-stable dedup key for a row with no bank-issued id —
 * see section D for the full algorithm and its accepted limitation. Every
 * format studied for this plan (section C) needs this: NONE carries a
 * unique per-row id. */
export const computeDedupKey = (
  holdingId: string,
  transaction: ParsedTransaction,
  occurrenceIndex: number,
): string => { /* implementation in section D */ };

export const mapParsedTransaction = (
  transaction: ParsedTransaction,
  holdingId: string,
  occurrenceIndex: number,
): NewTransaction => ({
  holdingId,
  amountMinorUnits: transaction.amountMinorUnits,
  time: transaction.timeSeconds * 1000, // same seconds->ms convention as mapStatementItem
  description: transaction.description,
  mcc: transaction.mcc,
  category: transaction.mcc !== undefined ? categoryForMcc(transaction.mcc) : null,
  counterIban: transaction.counterIban ?? null,
  comment: transaction.comment ?? null,
  source: 'import',
  externalId: transaction.externalId ?? computeDedupKey(holdingId, transaction, occurrenceIndex),
});
```

This is deliberately the SAME field set `mapStatementItem` writes (minus `hold`, which stays unset/`null` — an exported statement row is always settled, there is no pending-authorization concept in a file export). `categoryForMcc`, `normalizeTransactionName`, and the `NewTransaction` shape itself are imported, not reimplemented, and this ONE mapper serves every format — no per-bank mapping module is needed, only a per-bank `parse` that produces `ParsedTransaction[]`.

### A.4 The orchestrator

```ts
// src/statement-import/import-statement/import-statement.ts
import { transactionsRepo } from '@kiko/transactions/repo';

import { detectFormat } from '../registry';
import { mapParsedTransaction } from '../mapping';
import { StatementParseError } from '../parser';

export type ImportResult = { formatId: string; imported: number; total: number };

export const importStatement = async (
  input: { text: string; fileName: string },
  holdingId: string,
): Promise<ImportResult> => {
  const format = detectFormat(input);

  if (!format) {
    throw new StatementParseError('No known statement format matched this file');
  }

  const parsed = format.parse(input);
  const seenKeys = new Map<string, number>(); // dedup-key -> occurrence count, for computeDedupKey
  const rows = parsed.transactions.map((transaction) => {
    const raw = transaction.externalId ?? JSON.stringify(transaction); // provisional key basis
    const occurrenceIndex = seenKeys.get(raw) ?? 0;
    seenKeys.set(raw, occurrenceIndex + 1);

    return mapParsedTransaction(transaction, holdingId, occurrenceIndex);
  });
  const imported = await transactionsRepo.addManyDedup(rows);

  return { formatId: format.id, imported, total: rows.length };
};
```

`importStatement` takes already-read file TEXT, not a path — file reading (native, path-shaped) is the caller's job (section B), keeping this module pure and trivially unit-testable against fixture strings. A binary format (PrivatBank XLSX) still resolves to a `text`-free `ParsedStatement` through its OWN `parse` — see C.2 for exactly how a spreadsheet format receives its bytes instead of `text`.

---

## B. The two entry points

Both entry points converge on ONE screen, `src/screens/statement-import/statement-import.screen.tsx`, taking `{ filePath: string; accountId?: string }` (added to `AccountsStackParamList` in `src/navigation/types.d.ts`, registered in `src/navigation/accounts.stack.tsx`). The screen: reads the file, runs `detectFormat`/`format.parse`, shows a preview (format name, transaction count, date span, detected currency) with `Text`/`Box` (`src/design-system/components/`), a target-holding picker (a `BottomSheet` + `SelectableRow` list, mirroring `docs/plans/bank-providers.md`'s `AddBankProviderSheet` pattern exactly — a `BottomSheet` listing tappable rows, here holdings instead of providers, plus a "Create new holding" row that navigates to `HoldingForm` pre-filled with the detected currency and returns), and an `importStatement` call wired to a primary `Button`. `accountId`, when present (entry point 1), scopes the holding list to that account; absent (entry point 2, the Share Extension has no known target), the picker lists every holding across every account, grouped by account name.

### B.1 Document-picker button (Phase 1)

`account-detail.screen.tsx`'s footer currently renders one `Button` ("Add holding"). Change it to a two-button row, mirroring the existing side-by-side Sync/Disconnect row pattern (`Box direction="row" gap={2}`, lines 247-273 of that file):

```tsx
footer={
  <Box direction="row" gap={2}>
    <Button
      variant="secondaryTonal"
      fullWidth={false}
      onPress={pickAndOpenStatement}
      icon="doc.badge.plus"
    >
      {t('accountDetail.importStatement')}
    </Button>
    <Button
      variant="primary"
      fullWidth
      onPress={() => navigation.navigate('HoldingForm', { accountId })}
    >
      {t('accountDetail.addHolding')}
    </Button>
  </Box>
}
```

`pickAndOpenStatement` (a new handler in `account-detail.screen.tsx`, same style as `connectMonobank`): opens the document picker (`pick({ type: [types.csv, types.xlsx, types.plainText, types.allFiles] })` — note `types.xlsx` is needed from the very format that lands in Phase 2/PrivatBank, not just Phase 1/Monobank, so the picker's accepted-type list is written broadly from the start rather than narrowed to CSV and revisited later; the new `@react-native-documents/picker` dependency — see Phase 1's file list for the exact package and the alternative), reads the picked `uri` with the file-read library. **A binary format (XLSX) cannot be read as UTF-8 text** — `pickAndOpenStatement` reads every picked file as `base64` (`RNFS.readFile(uri, 'base64')`), and `StatementImportScreen` (not this handler) decides, per format, whether to decode that as UTF-8/cp1251 text or hand the raw bytes to the spreadsheet reader (section C.2) — this is why `StatementFormatInput` in A.1 is described as `text`-shaped only loosely; the real screen-level input carries the base64 payload and each format's `parse` does its own decode.

Design-system components used: `Box`, `Button` (existing, no new component needed for this entry point).

### B.2 iOS Share Extension (final phase) — the honest native shape

**A new Xcode target, not a plist tweak.** Kiko's `ios/Kiko.xcodeproj` today has exactly one `PBXNativeTarget` (`productType = "com.apple.product-type.application"`, confirmed by reading `project.pbxproj`). This phase adds a SECOND native target, `KikoShareExtension`, of `productType = "com.apple.product-type.app-extension"`, embedded in the host app's `Copy Files` build phase — the standard, only way iOS lets an app deliver a Share Extension. This is Xcode-project surgery (a new target via Xcode's "Share Extension" template, or hand-added `PBXNativeTarget`/`PBXBuildPhase` entries), not something `react-native.config.js` or an npm postinstall script can fake.

**The extension's `Info.plist`** declares the share-sheet activation point:

```xml
<key>NSExtension</key>
<dict>
  <key>NSExtensionPrincipalClass</key>
  <string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
  <key>NSExtensionPointIdentifier</key>
  <string>com.apple.share-services</string>
  <key>NSExtensionAttributes</key>
  <dict>
    <key>NSExtensionActivationRule</key>
    <dict>
      <key>NSExtensionActivationSupportsFileWithMaxCount</key>
      <integer>1</integer>
    </dict>
  </dict>
</dict>
```

Deliberately a BROAD "any single file" rule, not a format-specific UTI predicate (`NSExtensionActivationSupportsAttachmentsWithMaxCount` keyed to `public.comma-separated-values-text`): different banking apps tag their exported file's UTI inconsistently when sharing it directly from their own in-app share sheet (a CSV export and an XLSX export carry DIFFERENT UTIs to begin with, e.g. `public.comma-separated-values-text` versus `org.openxmlformats.spreadsheetml.sheet`, and some banks tag their file generically as `public.data` regardless), so a UTI-scoped rule risks Kiko silently not appearing in the share sheet for some banks. The extension itself validates the file (extension + a successful `detectFormat`) after receiving it and shows an honest "we don't recognize this file" state rather than silently failing — the same non-error `detectFormat` returns `undefined` state the in-app picker uses (section A.2).

**`ShareViewController.swift`** (new file, `ios/KikoShareExtension/ShareViewController.swift`) — a minimal `UIViewController`, NOT `SLComposeServiceViewController` (that base class is for the "compose a post" UI Kiko doesn't want; a plain `UIViewController` lets the extension do its work with no visible UI beyond a brief system-presented sheet):

1. Read `extensionContext?.inputItems` -> the shared file's `NSItemProvider` -> `loadFileRepresentation(forTypeIdentifier:completionHandler:)` to get a temporary file URL.
2. Copy its bytes into the App Group container: `FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.dmytro-vasylkivskyi.kiko")` (the ALREADY-DECLARED group — Grounding, above) `.appendingPathComponent("StatementImports/\(UUID().uuidString)-\(originalFileName)")` (the ORIGINAL filename/extension is preserved in the copy, not hardcoded to `.csv` — a binary XLSX must round-trip byte-for-byte, and the RN-side format detection in section C also benefits from a real extension hint), then `try data.write(to: fileURL, options: .atomic)`.
3. **Immediately** set `isExcludedFromBackup = true` on the file's `URLResourceValues` AND `FileManager.default.setAttributes([.protectionKey: .completeUntilFirstUserAuthentication], ofItemAtPath:)` — in that order, on that exact file, per `rules/fixtures/kiko-appgroup-write-needs-protection.good.swift` and the `kiko-appgroup-write-needs-protection` Semgrep rule (Grounding, above). Skipping this fails `check:security`/`check:rules`, not just a style nit — the rule is ERROR severity.
4. Hand off to the host app: `extensionContext?.open(URL(string: "kiko://import-statement?path=\(encodedAbsolutePath)")!, completionHandler: nil)`. `NSExtensionContext.open(_:completionHandler:)` is the documented API an extension uses to ask iOS to open a URL in its containing app — an extension has no `UIApplication.shared` to call `open` on directly.
5. `extensionContext?.completeRequest(returningItems: nil)`.

**The App Group entitlement** must be added to the NEW target's own `.entitlements` file (`ios/KikoShareExtension/KikoShareExtension.entitlements`, same `com.apple.security.application-groups` array, same group id) — the main app's existing `Kiko.entitlements` is unaffected, since it already carries it.

**Custom URL scheme registration**, main app's `ios/Kiko/Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>kiko</string></array>
  </dict>
</array>
```

**Cold-start vs warm-start on the RN side** — no new native-bridging dependency is needed for this half; React Native's built-in `Linking` module is enough once the scheme above is registered:

- **Warm start** (app already running, foregrounded or resumed): `Linking.addEventListener('url', ({ url }) => handleShareUrl(url))` fires immediately.
- **Cold start**: `Linking.getInitialURL()` resolves the same URL once, but only after JS has booted — and `MigrationsGate`/`LockGate` (`App.tsx`) must resolve FIRST (the importer needs an open, migrated, unlocked database and a ready navigator). A new hook, `usePendingStatementImport` (`src/statement-import/pending-share/pending-share.ts` + `.test.ts`), mounted inside `AppRoot` (`App.tsx`, alongside the existing `useAutoSync()` call — i.e. AFTER both gates, exactly where `useAutoSync` already sits) registers the listener, reads `getInitialURL()` once, parses out the `path` query param, and calls `navigationRef.navigate('AccountsTab', { screen: 'StatementImport', params: { filePath } })` once `navigationRef.isReady()` — `App.tsx`'s `<NavigationContainer>` needs a `ref={navigationRef}` added (a module-level `createNavigationContainerRef<RootParamList>()`, the standard React Navigation "navigate without a screen's own prop" pattern), since it currently takes none.
- The App-Group copy is deleted (`RNFS.unlink`) once `StatementImportScreen` has read it into memory — a shared file should not persist as a second on-disk copy of financial data outside Kiko's own (potentially SQLCipher-encrypted, `kiko-architecture`) storage any longer than the hand-off requires.

**Alternative considered and deliberately not taken as the primary design:** a community bridging library (`react-native-share-menu` or `receive-sharing-intent`) that wraps steps 1-2 and the RN-side listener in one package. Rejected as the DEFAULT here because the custom-URL-scheme handoff above is ~30 lines of Swift using only documented `Foundation`/`UIKit` APIs (`NSItemProvider`, `NSExtensionContext.open`) and RN's own built-in `Linking` — no new opaque native dependency, no separate maintenance-status check. Revisit this trade-off at implementation time if the hand-written extension proves more fragile in practice than expected; either way the App-Group-write hardening (step 3) and the `kiko://` scheme are needed regardless of which library, if any, drives step 1-2.

---

## C. Parsing and mapping

### C.0 uabean: what it is, how it is used, and the license/credit obligation this creates

`OSadovy/uabean` (https://github.com/OSadovy/uabean, MIT License, Copyright (c) 2023 Oleksii Sadovyi) is a set of Python **Beancount** importers — `src/uabean/importers/<bank>.py` — plus, for a handful of banks, real or anonymized sample statements under `tests/importers/<bank>/`. It exists because the user has ONLY a Monobank account: uabean is the workaround that lets this plan record real, verified per-bank export facts (column layout, encoding, date format, sign convention) for banks nobody on this project can currently produce a real export for.

**How it is used, precisely:**

- **Cloned to a scratch directory only, never vendored.** This plan's own research cloned uabean to a throwaway scratch path outside the Kiko repo, read its importer source and fixtures, and recorded the FACTS below. No `uabean` file, Python or otherwise, is copied into `pff-ios`.
- **Every `StatementFormat.parse` is an independent TypeScript reimplementation**, written against Kiko's own `ParsedTransaction`/`ParsedAccountHint` contract (A.1), informed by uabean's column layout, matcher, and edge-case knowledge. uabean's BEANCOUNT-specific logic is NOT ported, because Kiko has no equivalent to port it into — see each bank's "not ported" note in C.1/C.2/C.3 for the specific Beancount concepts (double-entry fee/cashback/interest postings, `Price` annotations, synthetic `Balance` assertions) every format module skips.
- **Credit and the MIT notice.** A NOTICE file, `src/statement-import/NOTICE.md` (new, Phase 1's file list), records the credit and reproduces uabean's MIT license text in full — the MIT license's core condition ("The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software") is triggered by REUSING FIXTURE BYTES (C.4) even where the parsing CODE is independently written; recording the notice for the whole feature, not only the reused fixtures, is the simpler and more conservative reading. Every format module (`src/statement-import/formats/<bank>/`) carries a short header comment pointing at it: `// Column layout verified against OSadovy/uabean (MIT) — see src/statement-import/NOTICE.md. No uabean source is copied; independent TypeScript implementation.`
- **Fixture bytes are a separate question from parsing logic** — section C.4 states, per fixture, whether it is reused (credited) or replaced with a hand-authored synthetic one, based on whether this plan's own research found it to look like real personal data.

**Coverage actually found**, against the coordinator's requested bank list (`src/uabean/importers/` as of this research's clone): `monobank.py` (Monobank), `privatbank_xlsx.py` + `privatbank_xls.py` + `privatbank_xml.py` (PrivatBank, three formats), `pumb_xls.py` (PUMB), `procredit_xls.py` + `procredit_business.py` (ProCredit, two formats), `sensebank.py` (Sensebank), `ukrsib_business.py` (Ukrsibbank), `alfa_business.py` (Alfa). Two findings changed this plan's scope from a literal "one format per requested bank" reading, both recorded honestly rather than papered over:

- **Oschadbank has NO file-statement importer in uabean at all.** `oschad_api.py` logs into `online.oschadbank.ua`'s web banking with a session cookie/credentials and pulls transactions over a live HTTP API — it is a LIVE PROVIDER integration, the same shape as `docs/plans/bank-providers.md`'s PrivatBank AutoClient, not a statement file. There is nothing to reimplement as a `StatementFormat` here; Oschadbank is OUT OF SCOPE for this plan (C.3) and, if ever wanted, belongs in `bank-providers.md`'s world instead.
- **"Alfa" personal/retail does not exist as a separate format.** Alfa-Bank Ukraine rebranded to Sensebank in 2023 (part of Ukraine's wartime bank-sanctions divestiture) — this is WHY uabean's only personal-facing importer for that lineage is named `sensebank.py`, not `alfa.py`. The `alfa_business.py` importer that does exist is a CORPORATE web-portal export (C.3), not what an individual retail user has.

### C.1 Priority tier 1 (this plan's near-term scope): Monobank CSV and PrivatBank XLSX

Per the coordinator's explicit priority: Monobank first (verified later against the user's own real export), PrivatBank second (highest user value among the banks nobody on this project currently holds an account at).

#### Monobank CSV

Monobank's personal-banking app exports a "statement" CSV from Card -> Statement -> Export/Share, in the app's currently selected display language. Facts below are corrected against BOTH uabean's `monobank.py` docstring/code AND this plan's own byte-level read of its real fixture (`tests/importers/monobank/monobank-black-UAH_01-06-23_15-03-59.csv`), which superseded some of this plan's earlier (pre-uabean) guesses:

| Fact | Value |
|---|---|
| File type | CSV |
| Encoding | UTF-8 |
| Delimiter | `,` (comma) — confirmed against the real fixture, not `;` |
| Header (uk) | `Дата i час операції,Деталі операції,MCC,Сума в валюті картки (UAH),Сума в валюті операції,Валюта,Курс,Сума комісій (UAH),Сума кешбеку (UAH),Залишок після операції` |
| Account currency | NOT a separate column — embedded in the amount column's OWN header text, e.g. `(UAH)`; extract with a regex (`/\((\w+)\)/`) against the AMOUNT column's header, matching uabean's own approach |
| Date format | `DD.MM.YYYY HH:MM:SS`, e.g. `01.04.2022 05:27:35` (confirmed against the real fixture) |
| Amount | Plain decimal, `.` separator, signed (negative = expense); `—` (U+2014 em dash) marks an absent optional column (commission/cashback/rate), not an empty string |
| MCC | Plain numeric string (e.g. `4829`), maps through Kiko's OWN `categoryForMcc` |
| Dedup id | None — synthetic key (D.1) |
| Priority | **P1 — this plan's first format, unchanged from the original plan** |
| Fixture | uabean's real fixture reused as-is (C.4) — no PII, low risk |

Not ported from uabean: its cashback-withdrawal/interest-income double-posting logic (Beancount-specific, no Kiko equivalent — a cashback or interest row imports as ONE plain transaction like any other row) and its trailing synthetic `Balance` assertion (Kiko never derives a holding's balance from a statement, `kiko-domain`). **English-locale header text is still [VERIFY LIVE]** — uabean's own source only documents the Ukrainian header verbatim; `detect`'s second header signature (for an English-locale export) needs confirming against a real English-locale file before it ships, same caveat as this plan's original pass.

#### PrivatBank XLSX

The Privat24 WEB interface's own statement export ("Statements" screen; `Виписка з Ваших карток` = "Statement of your cards"). This is the realistic source for an individual retail user — see below for why the XML/legacy-XLS siblings are deferred instead.

| Fact | Value |
|---|---|
| File type | XLSX (Excel OOXML) — a spreadsheet, NOT CSV, confirmed by reading a real fixture's cells with `openpyxl` during this research |
| Encoding | n/a (binary; cell values already Unicode) |
| Detect signature | Cell A1 starts with `Виписка з Ваших карток за період` |
| Header row (row 2) | `Дата`, `Категорія`, `Картка`, `Опис операції`, `Сума в валюті картки`, `Валюта картки`, `Сума в валюті транзакції`, `Валюта транзакції`, `Залишок на кінець періоду`, `Валюта залишку` |
| Date format | Combined date+time in one cell, `DD.MM.YYYY HH:MM:SS`, e.g. `24.07.2025 04:49:39` |
| Currency | Ukrainian WORD abbreviations, NOT ISO codes: `грн`→UAH, `дол`→USD, `євро`→EUR, `PLN`→PLN (uabean's own map, confirmed incomplete — an unmapped word must prompt the user to confirm currency rather than throw; **[VERIFY LIVE]** the full abbreviation set, e.g. `фунт`/GBP) |
| Amount | Two pairs — "card currency" (what actually moved the account, imported as `amountMinorUnits`) and "transaction currency" (the original merchant-currency figure, informational only, not modeled — matches Monobank's own `mapStatementItem`, which also drops this) |
| MCC | NONE — `category: null` for every row (folds to `settings.defaultCategoryKey`, `kiko-domain`). PrivatBank's own `Категорія` column is free-text Ukrainian, not a Kiko `categories.key` slug — not auto-mapped in this plan's first cut |
| Dedup id | None — synthetic key (D.1) |
| Priority | **P1 — second format, per the coordinator's explicit priority** |
| Fixture | uabean's fixture looks like REAL personal data — **do NOT reuse it**; hand-author a synthetic one (C.4) |

**A real fixture spans MULTIPLE masked cards in one file** — confirmed by reading uabean's own PrivatBank XLSX fixture: three DIFFERENT masked card numbers (`8345 **** **** 2284`, `8346 **** **** 2284`, `8347 **** **** 2284`) across just 3 data rows. This makes section C.3's "the user always confirms the target holding" rule load-bearing here specifically, not just a UX nicety: a naive "one file = one holding" assumption would silently misfile rows belonging to a different card into the wrong holding. The masked card number (`Картка` column) is still surfaced as a per-row hint — e.g. shown next to each previewed row, or used to pre-select a holding whose `maskedPan` matches — but is never used to silently auto-route a row without the user's holding pick.

Not ported from uabean: its fee-posting logic (a second Beancount posting when the card-currency and transaction-currency amounts differ by more than the FX conversion alone) and its trailing synthetic `Balance` assertion — same reasoning as Monobank.

**PrivatBank's legacy XLS and XML formats are explicitly NOT part of this plan's registry (P3, deferred):** `privatbank_xls.py` (legacy binary `.xls` via `xlrd`) and `privatbank_xml.py` (an attribute-based `<statements status="...">` XML, sourced from the THIRD-PARTY `p24-cli` tool, not Privat24 itself) are real uabean importers but neither is what a typical user gets from Privat24's mobile app or current web export. The XLS format's column shape is close enough to XLSX to add cheaply later if ever requested; the XML format's dependency on a third-party CLI tool most users will never have installed makes it low-value regardless of parsing cost. Building either is a small, well-scoped follow-up, not part of this plan's near-term slice.

### C.2 Priority tier 2 (near-term follow-on): Sensebank CSV

Sensebank is Alfa-Bank Ukraine's 2023 rebrand (C.0) — its `sensesuperapp` mobile app export is the realistic RETAIL-facing format for that lineage, and a plausible near-term addition given how many displaced Ukrainian users hold or held an Alfa/Sensebank account.

| Fact | Value |
|---|---|
| File type | CSV |
| Encoding | **windows-1251 (cp1251)** — NOT UTF-8; confirmed both by uabean's explicit `open(fname, encoding="windows-1251")` and by this plan's own byte-level read of the fixture |
| Delimiter | `;` (semicolon) |
| Detect signature | File content starts with the literal preamble line `Виписка за рахунком;;;;;;;` |
| Layout | Several metadata preamble lines (period, contract number, an account line matching `Рахунок (\w+) \((\w+)\)` for IBAN + currency), then ONE OR MORE repeated `Дата і час;Статус;Тип;Деталі;Адреса;MCC;Cума списання;Cума зарахування` header+rows blocks (a separate block per card can appear under one account), with footer/section lines to skip (`Деталізація операцій`, `Вклади гарантуються`) |
| Date format | `DD.MM.YY HH:MM` (2-digit year), e.g. `09.01.00 00:58`, `dayfirst=True` |
| Amount | TWO columns — debit (`Cума списання`) XOR credit (`Cума зарахування`), never both on one row; decimal COMMA (`150,00`), not dot |
| MCC | Present; maps through Kiko's own `categoryForMcc`, same as Monobank |
| Dedup id | None — synthetic key (D.1) |
| Priority | **P2 — near-term follow-on, after the P1 pair above** |
| Fixture | uabean's fixture is confirmed SYNTHETIC (placeholder IBAN, test-pattern card number, year-2000 dates) — safe to reuse as-is (C.4) |

Sensebank is the ONE format in this plan's P1+P2 tier that is not plain UTF-8/binary-spreadsheet — it is what actually requires the cp1251 decoder dependency (C.5); Monobank and PrivatBank XLSX need no such dependency.

### C.3 Priority tier 3 (deferred) and out of scope

Documented now, for a future implementer, precisely so the facts don't need re-deriving later — NONE of these are in A.1's `statementFormatIds` yet, and none should be built without a fresh scope decision.

**PUMB (deferred — P3, two real caveats).** XLSX, but per uabean's own docstring "obtained via request to online support" — PUMB does not appear to offer a routine self-service export the way Monobank/Privat24/Sensebank do; a user would need to CONTACT PUMB SUPPORT to get this file at all, which alone lowers its near-term value. Its layout is report-style with a scanned-for header row and a `ВСЬОГО` (total) footer terminator, rather than a clean single-header table. Worse: **the exported table carries NO currency column at all** — uabean derives the account currency from the FILENAME (`pumb-<currency>-....xlsx`), which Kiko cannot rely on once a file has passed through Files.app/Messages/Mail/a re-save. A TS port would need the user to explicitly confirm the currency during import (not merely default it), which C.3's holding-picker step already supports structurally but is NOT optional here the way it is for Monobank/PrivatBank/Sensebank (all three self-describe their currency).

**ProCredit retail XLS (deferred — P3, highest parsing complexity of every format studied).** Legacy binary `.xls`, "obtained via web interface" (a plausible self-service source, unlike PUMB). By far the most complex layout: a metadata preamble, then the sheet may contain TWO sub-tables in sequence ("Операції по рахунку" / account-level, "Операції по картам" / card-level, whose header spans TWO rows requiring a merge), rows identified by a date-pattern REGEX rather than a fixed column, and a closing-balance row found by scanning for a text prefix across the whole row. Given this complexity against ProCredit's likely small share of Kiko's user base, treat a future build of this as its own small research spike, not a "just add a registry entry" task.

**ProCredit business, Ukrsibbank business, Alfa business (OUT OF SCOPE for this plan).** All three (`procredit_business.py`, `ukrsib_business.py`, `alfa_business.py`) are CSV exports from a BUSINESS/CORPORATE online-banking WEB PORTAL, cp1251-encoded, `;`-delimited, keyed by EDRPOU (Ukrainian company registration number) — built for a FOP/company bookkeeper, not an individual's personal banking. This mirrors `docs/plans/bank-providers.md`'s own PrivatBank-AutoClient eligibility caveat (a FOP/business-only credential) — same class of "real format, wrong audience" finding. uabean has NO personal/retail Ukrsibbank importer at all (its author apparently never needed one), and NO personal/retail Alfa importer either (superseded by Sensebank, C.0). Do not assume either exists to build against.

**Oschadbank (NOT APPLICABLE — no file format exists to study).** See C.0 — `oschad_api.py` is a live API/session-cookie downloader, not a statement importer. If Oschadbank support is ever wanted, it belongs in `docs/plans/bank-providers.md`'s live-provider world, not this plan's `StatementFormat` registry.

### C.4 Reusing uabean's fixtures as Kiko's own parser test data

uabean ships real (not synthetic) fixture files for only 4 of the banks studied for this plan — `tests/importers/{monobank,privatbank_xlsx,sensebank,alfabank_business}/` (`tests/importers/procreditbank-business/` also has one, but that bank is out of scope). No fixture exists in uabean at all for PrivatBank XLS/XML, PUMB, ProCredit retail XLS, or Ukrsibbank — those formats would need HAND-AUTHORED synthetic fixtures if ever built, from this plan's C.1-C.3 column facts, since there is nothing in uabean to reuse for them.

Per-fixture disposition, checked by reading each file's ACTUAL bytes during this research (not assumed):

- **Monobank** (`tests/importers/monobank/monobank-black-UAH_01-06-23_15-03-59.csv`) — 4 rows, real-looking merchant names ("Google", "Uklon") and amounts, but the Monobank CSV format itself carries NO account/card identifier column at all — the lowest-PII-risk fixture of the four studied. **Reuse as-is, credited**, at `src/statement-import/formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv`.
- **Sensebank** (`tests/importers/sensebank/alfabank-uah.csv`) — confirmed SYNTHETIC: placeholder IBAN (`UA111111111111111111111111111`, all 1s), a test-pattern Visa card number (`4111xxxxxxx1111` — the well-known `4111 1111 1111 1111` test-card prefix), year-2000 dates. **Reuse as-is, credited.**
- **Alfa business** (`tests/importers/alfabank_business/ReportAlfa-Bank_20221005_124902.csv`) — confirmed SYNTHETIC (`XYZ COMPANY`/`JOHN DOE` placeholders, all-1s IBANs/EDRPOU, literal `[REDACTED]` markers in description text). Not needed (bank is out of scope), not reused.
- **PrivatBank XLSX** (`tests/importers/privatbank_xlsx/obYFD4Q-....xlsx`) — **FLAGGED: this looks like REAL, non-synthetic personal data.** Read directly during this research: three DIFFERENT real-looking masked card numbers (Privat24's own bank-applied masking — not a redaction the fixture author added), real-looking merchant names WITH geography (`THE HOME DEPOT #7079, NEPEAN`, `DOLLARAMA # 380, NEPEAN` — Nepean, Ontario, Canada), a real-looking one-year date range, and no accompanying anonymization script the way `tests/importers/procreditbank-business/anonymize.py` exists for that bank. **Do NOT copy this file into Kiko's repo.** This plan's own use of it was read-only, in the scratch clone, to verify the column/date/currency-abbreviation facts recorded in C.1 above — the file itself was never persisted into `pff-ios`. **Action for the implementer:** hand-author a SYNTHETIC fixture for `src/statement-import/formats/privatbank-xlsx/__fixtures__/` instead — same header row and column types, invented masked-card/merchant/amount values in the Sensebank fixture's own placeholder style (an all-1s or clearly-fake `1234 **** **** 5678` card, "Test Merchant" descriptions).
- **General rule for any OTHER uabean fixture a future implementer considers reusing:** read it first, the way this research did — an explicit anonymization script or obviously-fake placeholder data (repeated digits, `XYZ`/`JOHN DOE`/`REDACTED`) means safe to reuse, credited; anything else (masked-but-real numbers, real merchant/geography, no anonymization pass) means hand-author a synthetic replacement instead, exactly as this plan does for PrivatBank XLSX above.

### C.5 New parser dependencies (recommendations — DO NOT INSTALL)

| Dependency | Needed for | Recommendation | Bundle-size / maintenance note |
|---|---|---|---|
| CSV parser | Monobank, Sensebank | `papaparse` (+ `@types/papaparse` if it ships no own types) | Small, ~20KB minified; well-established, delimiter auto-detection built in |
| Spreadsheet reader (XLS + XLSX) | PrivatBank XLSX (P1); PUMB, ProCredit retail XLS if ever built (P3) | `xlsx` (SheetJS Community Edition) — the one library that reads BOTH legacy binary `.xls` and modern `.xlsx` through one API, covering every spreadsheet format studied in this plan with a single dependency | Real cost: SheetJS's full CE build is historically several hundred KB to ~1MB unminified (it covers many legacy codec paths Kiko will never touch). Evaluate lazy-loading it only when the import screen mounts (RN/Metro dynamic `import()`) at implementation time. Also confirm the CURRENT recommended install source — SheetJS has, at times, recommended installing from their own CDN tarball URL rather than a stale npm-published version; verify this is still the case before pinning |
| XML parser | PrivatBank XML — **P3/deferred, NOT needed for this plan's near-term scope** | `fast-xml-parser` if/when that format is ever scheduled | Small (~30KB), pure JS, no native deps. Do not request approval for this until PrivatBank XML is actually scheduled |
| cp1251 (windows-1251) decoder | Sensebank (P2); the deferred/out-of-scope business CSVs | A small, dependency-free single-codepage table package (e.g. `windows-1251` on npm) over a general iconv binding — `iconv-lite` depends on Node `Buffer` semantics that don't reliably match Hermes/RN without extra polyfilling. **Confirm the specific package's current name/maintenance/size at implementation time** — this is the one dependency in this table not independently re-verified against a live npm listing during this research pass | Expected tiny (a fixed 256-entry lookup table); RN's `RNFS.readFile` only supports a small fixed encoding set (`utf8`/`ascii`/`base64`, NOT `windows-1251`), so the file must be read as `base64` and decoded byte-by-byte in JS |

All four are additional to the two already-flagged native-adjacent dependencies from the original plan (document picker, file-read library — B.1/Phase 1's file list, unchanged). Every one of these six needs explicit approval before the phase that first requires it starts (Global Constraints); none is installed by writing this plan.

---

## D. Dedup

**Re-importing an overlapping statement must not duplicate rows.** This reuses `transactionsRepo.addManyDedup`'s existing `(source, external_id)` upsert (Grounding, above) wholesale — no new dedup mechanism is built. The only new work is computing a stable `externalId` for a format that carries no bank-issued row id — which, per section C's research, is EVERY format studied (Monobank, PrivatBank in all three of its shapes, PUMB, ProCredit in both its shapes, Sensebank, and the out-of-scope business CSVs alike). This universality is itself a useful finding: `computeDedupKey` is not a Monobank-specific fallback, it is the NORMAL path for this whole feature.

### D.1 The synthetic key

```ts
// src/statement-import/mapping/mapping.ts (computeDedupKey, full shape)
export const computeDedupKey = (
  holdingId: string,
  transaction: ParsedTransaction,
  occurrenceIndex: number,
): string => {
  const normalizedDescription = normalizeTransactionName(transaction.description);
  const base = [
    holdingId,
    String(transaction.timeSeconds),
    String(transaction.amountMinorUnits),
    normalizedDescription,
  ].join(' ');

  // A running per-parse occurrence count distinguishes two rows that are
  // EXACT duplicates of date+amount+description within one file (two
  // identical coffee purchases in the same minute) — see the limitation
  // note below. `0` is omitted so the common (unique) case's key is stable
  // even if this suffixing scheme changes later; only a genuine collision
  // grows the key.
  return occurrenceIndex === 0 ? base : `${base} ${occurrenceIndex}`;
};
```

`occurrenceIndex` is the Nth time this EXACT (holding, time, amount, normalized-description) tuple has been seen so far in THIS parse (computed by `importStatement`'s `seenKeys` map, A.4) — deterministic and ORDER-STABLE: re-parsing the identical file produces rows in the identical order, so the identical sequence of occurrence indices, so the identical sequence of keys, so a re-import upserts onto the SAME existing rows rather than either duplicating them or colliding two genuinely-different transactions into one.

**date + amount + description, an external id when present**: no format studied for this plan ever sets `ParsedTransaction.externalId` today — this remains the fallback path for a hypothetical future format that DOES carry a real per-row id (none of uabean's Ukrainian-bank importers do; its Binance/Wise/IBKR/Kraken importers, out of scope for this plan, are a different story).

### D.2 Where the check runs

Entirely inside `transactionsRepo.addManyDedup` (`src/transactions/repo/transactions.repo.ts:586`), inside its own `write(...)` transaction — the importer never queries for "does this already exist" itself, exactly mirroring `kiko-architecture`'s explicit warning against a JS-side "already imported" filter (the Monobank sync used to have one and it was a bug: it could drop a re-fetched item before the database ever compared it). `importStatement` (A.4) hands the WHOLE batch to `addManyDedup` in one call, regardless of which format produced it.

### D.3 Accepted limitation

Two GENUINELY different transactions sharing the exact same holding, second-or-minute-precision timestamp, minor-units amount, AND normalized description are indistinguishable from two occurrences of the same key and will dedup onto ONE stored row on a re-import that reorders them (a same-file re-import is safe — reparsing preserves row order — but importing two DIFFERENT overlapping exports of the same window whose row order differs is not guaranteed safe against this edge case). Sensebank's coarser `DD.MM.YY HH:MM` (minute, not second) precision makes this collision marginally more likely there than for Monobank/PrivatBank's second-precision timestamps — worth re-confirming once Sensebank ships (P2) whether this widens the risk meaningfully in practice. This is the same class of accepted, documented risk as the `image-size`/`decode-uri-component` CVEs and the crypto-price all-or-nothing debt already recorded in the root `CLAUDE.md` — real, narrow, and not silently swept under a suppression. Do not "fix" it with a broader key (e.g. dropping the description entirely) without a concrete false-negative report; a broader key trades this rare collision for a common one.

### D.4 Deletability: `'import'` rows follow the synced-row rule, not the manual one

New `transactions.source` enum member `'import'` (`src/db/schema.ts:125`, TS-only, no migration — the same one-line-widening precedent `docs/plans/bank-providers.md` sets for `'privatbank'`), shared by every bank format in the registry (no per-bank `source` value — the FORMAT is recorded only via `ParsedStatement.formatId`, which this plan does not currently persist anywhere; add it to a future metadata column only if a concrete need for "which bank did this row come from" arises after import, which nothing in this plan needs today). Because `isSyncedTransaction` (`src/holdings/deletable/deletable.ts:11`) is `row.source !== 'manual'`, an imported row is — like a `'monobank'`/`'binance'` row — REFUSED by `transactionsRepo.remove` (an individual-row delete). This is a deliberate choice, not an oversight: `addManyDedup`'s upsert means a deleted-then-re-imported row would silently resurrect on the next overlapping import (exactly the reason a live-synced row is protected the same way today). The user still has two real outs: (1) `transactionsRepo.setCategory` has NO source gate, so a mis-categorized imported row is freely recategorizable, and a later re-import never clobbers that pick (`addManyDedup`'s update set excludes `category`, Grounding above); (2) `holdingsRepo.remove` deletes an ENTIRE holding and every transaction under it unconditionally (no per-row gate in its delete loop) provided the holding itself is not `isSyncedHolding` — and an imported holding never is, since it carries no `syncedMetadataFields` key (`src/holdings/holding-metadata/holding-metadata.ts:57`) and its account need not be institution-connected. So a whole bad import is fully undoable by deleting its holding; a single bad row inside an otherwise-good import is not individually deletable, only recategorizable.

---

## E. Phasing

### Phase 1 — Document-picker infrastructure + Monobank CSV (pure JavaScript, ship first)

**New dependencies (need approval before this phase starts):** a document picker (`@react-native-documents/picker` recommended — the actively maintained successor to the now-archived `react-native-document-picker`; confirm current npm status at implementation time), a file-read library (`react-native-fs` recommended; `react-native-blob-util` as a fallback if `react-native-fs`'s maintenance has lapsed by implementation time), and `papaparse` (+ `@types/papaparse` if needed) for CSV. Each is pinned exact (`.npmrc`) and added to `jest.config.js`'s `transformIgnorePatterns` allow-list ONLY if it ships untransformed source (`kiko-code-style`'s "Testing a native/ESM dependency" — check each package's actual `node_modules` output before assuming it needs the entry).

**Files:**

- Create `src/statement-import/NOTICE.md` — uabean's MIT license text + credit (C.0).
- Create `src/statement-import/parser/parser.ts` (+ `.test.ts`, + `index.ts`) — A.1's types, `StatementParseError`.
- Create `src/statement-import/formats/monobank-csv/monobank-csv.format.ts` (+ `.test.ts`, + `index.ts`, + `__fixtures__/uabean-monobank-sample.csv` credited per C.4) — C.1.
- Create `src/statement-import/registry/registry.ts` (+ `.test.ts`, + `index.ts`) — A.2 (Monobank entry only in this phase; PrivatBank/Sensebank entries land in their own phases below).
- Create `src/statement-import/mapping/mapping.ts` (+ `.test.ts`, + `index.ts`) — A.3, D.1.
- Create `src/statement-import/import-statement/import-statement.ts` (+ `.test.ts`, + `index.ts`) — A.4.
- Modify `src/db/schema.ts`: add `'import'` to `transactions.source`'s enum tuple (line 125).
- Create `src/screens/statement-import/statement-import.screen.tsx` (+ `.styles.ts`, + `.screen.test.tsx`) — B's shared preview + target-holding screen.
- Create `src/screens/statement-import/target-holding-sheet/` (`.component.tsx` + `.props.d.ts` + `.styles.ts` + `.component.test.tsx` + `index.ts`) — the `BottomSheet` + `SelectableRow` holding picker (B, mirrors `docs/plans/bank-providers.md`'s `AddBankProviderSheet` shape).
- Modify `src/navigation/types.d.ts`: add `StatementImport: { filePath: string; accountId?: string }` to `AccountsStackParamList`.
- Modify `src/navigation/accounts.stack.tsx`: register the `StatementImport` screen.
- Modify `src/screens/account-detail/account-detail.screen.tsx`: the two-button footer row + `pickAndOpenStatement` handler (B.1) — the picker's accepted-type list includes `xlsx` from the start (B.1), even though this phase only ships the Monobank CSV format.
- Modify `src/i18n/locales/en.ts` and `uk.ts`: `accountDetail.importStatement`, `statementImport.previewHeading`, `statementImport.unrecognizedFormat`, `statementImport.chooseHolding`, `statementImport.createNewHolding`, `statementImport.importButton`, `statementImport.importedCount`. Check: `en.uk.parity.test.ts`.

**Tests (Jest + RNTL):**

- [ ] `parser.test.ts` — `StatementParseError` construction; the shared types compile.
- [ ] `monobank-csv.format.test.ts` — `detect` accepts the fixture, rejects an unrelated CSV; `parse` on the fixture produces the expected `ParsedStatement` (transaction count, currency, first/last row's exact fields, matching C.1's 4-row fixture content).
- [ ] `registry.test.ts` — `detectFormat` returns the Monobank format for a matching input, `undefined` for a non-matching one.
- [ ] `mapping.test.ts` — `mapParsedTransaction` produces the exact `NewTransaction` field set (including `source: 'import'`, `category` from `categoryForMcc`, null `hold`); `computeDedupKey` is stable across two calls with identical input and DIFFERS only by `occurrenceIndex` for exact duplicates.
- [ ] `import-statement.test.ts` — injected-`transactionsRepo` style (mirrors `src/monobank/sync/sync.test.ts`'s deps-injection): a first import calls `addManyDedup` once with every mapped row; a second import of the SAME text against the same holding calls it again and `addManyDedup`'s own dedup (exercised for real against an in-memory/test DB, not re-mocked) reports 0 newly imported; an unrecognized file throws `StatementParseError` before any repo call.
- [ ] `statement-import.screen.test.tsx` — renders the preview for a valid file; renders the "unrecognized format" state for an invalid one; selecting a holding then pressing Import calls `importStatement` and shows the imported count.
- [ ] `target-holding-sheet.component.test.tsx` — lists holdings (scoped to `accountId` when provided), selecting one closes the sheet and reports the choice, "Create new holding" navigates to `HoldingForm`.
- [ ] `account-detail.screen.test.tsx` — extend to cover the new footer button rendering and `pickAndOpenStatement`'s picker-cancelled / picker-succeeded paths (mock the document-picker and file-read modules).

**Maestro:** no live-credential constraint applies here (unlike Monobank/PrivatBank connect) — the checked-in Monobank fixture CAN be shared via the picker in a headless simulator run. Add `.maestro/statement-import.yaml`: open Accounts -> an account -> Import statement -> pick the fixture -> assert the preview shows the expected transaction count -> pick a holding -> Import -> assert the success text. Functional flow assertion, not a screenshot-diff check.

**Risks:**

- The three new dependencies are unapproved; if the coordinator/user rejects one, the concrete package choice changes but the shapes in section A/B.1 (a `uri` in, a `filePath`/text out) do not.
- Monobank's English-locale header text is still `[VERIFY LIVE]` (C.1) — uabean's own source doesn't independently confirm it; the user's own real export (per the coordinator's brief) is the actual verification step for this, not this plan.
- `noExcessiveCognitiveComplexity` (Biome, cap 15) on `monobank-csv.format.ts`'s `parse` — budget for a helper-per-column-group split from the start.

**Checkpoints:** `make gate` after the schema/parser/mapping/import-statement tasks land; `make gate` again after the screen/sheet/account-detail UI tasks land; `make verify` before Phase 1 is declared done.

### Phase 2 — PrivatBank XLSX (still pure JavaScript; highest user value per the coordinator)

**New dependency (needs approval before this phase starts):** `xlsx` (SheetJS CE) — see C.5 for the bundle-size and install-source caveats.

**Files:**

- Create `src/statement-import/formats/privatbank-xlsx/privatbank-xlsx.format.ts` (+ `.test.ts`, + `index.ts`, + `__fixtures__/synthetic-privatbank-sample.xlsx` — HAND-AUTHORED per C.4, not copied from uabean).
- Modify `src/statement-import/registry/registry.ts`: add the PrivatBank entry.
- Modify `src/statement-import/parser/parser.ts`: add `'privatbank-xlsx'` to `statementFormatIds`.
- Modify `src/screens/account-detail/pickAndOpenStatement` (already reads every file as `base64` since Phase 1, per B.1 — no change needed there) and `StatementImportScreen`: branch on the detected/candidate format to decide whether to decode the base64 payload as UTF-8 text (CSV formats) or hand it to the `xlsx` reader (spreadsheet formats) before calling `detectFormat`/`parse`.
- Modify `src/statement-import/formats/privatbank-xlsx/`'s target-holding-sheet integration: surface the per-row masked-card hint (C.1) in the preview list, since a single PrivatBank export can span multiple cards.

**Tests:**

- [ ] `privatbank-xlsx.format.test.ts` — `detect` accepts the synthetic fixture (cell-A1 content match), rejects a non-matching spreadsheet and a CSV; `parse` produces the expected `ParsedStatement` including the currency-word mapping (`грн`/`дол`/`євро` -> UAH/USD/EUR) and correctly reads the card-currency amount pair, not the transaction-currency one; a row whose currency word is unmapped surfaces a recoverable "confirm currency" state rather than throwing.
- [ ] `mapping.test.ts` — extend to confirm a PrivatBank-sourced `ParsedTransaction` (no MCC) maps to `category: null`, not a thrown error or a guessed category.
- [ ] `statement-import.screen.test.tsx` — extend to cover the multi-card-per-file case: the preview surfaces each row's masked-card hint, and picking a holding still requires an explicit user action even when a hint is shown.

**Maestro:** extend `.maestro/statement-import.yaml` with a second scenario using the synthetic PrivatBank fixture, or add a sibling flow file if the two scenarios don't compose cleanly in one `.yaml`.

**Risks:**

- `xlsx`'s bundle-size cost (C.5) is real and worth re-measuring once it's actually added to `package.json` — if it meaningfully regresses app size, evaluate the lazy-import mitigation noted in C.5 before shipping, rather than after.
- The currency-abbreviation map is confirmed INCOMPLETE by uabean's own source — do not assume the 4 mapped words are exhaustive; the "confirm currency" fallback (above) is not optional polish, it is how an unmapped word is handled correctly rather than silently mis-imported.

**Checkpoints:** `make gate` after the format/mapping tasks land; `make gate` again after the screen/preview tasks land; `make verify` before Phase 2 is declared done.

### Phase 3 — Sensebank CSV (near-term follow-on)

**New dependency (needs approval before this phase starts):** a cp1251/windows-1251 decoder (C.5).

**Files:**

- Create `src/statement-import/formats/sensebank-csv/sensebank-csv.format.ts` (+ `.test.ts`, + `index.ts`, + `__fixtures__/uabean-sensebank-sample.csv` — reused as-is per C.4, confirmed synthetic).
- Modify `src/statement-import/registry/registry.ts`: add the Sensebank entry.
- Modify `src/statement-import/parser/parser.ts`: add `'sensebank-csv'` to `statementFormatIds`.
- Modify the base64-decode branch added in Phase 2: Sensebank's bytes decode through the new cp1251 table BEFORE `Papa.parse` ever sees them (papaparse operates on JS strings, not raw bytes — the codepage decode must happen first).

**Tests:**

- [ ] `sensebank-csv.format.test.ts` — `detect` accepts the fixture (content-prefix match), rejects Monobank's/PrivatBank's fixtures; `parse` correctly handles the debit-XOR-credit column pair, the comma-decimal amount, the multi-block (multiple cards under one account) layout, and skips every documented footer/section line.
- [ ] A cp1251-decode unit test asserting a known byte sequence round-trips to the expected Ukrainian string (independent of the CSV parser, so a decode bug and a CSV-shape bug never look identical in a failing test).

**Maestro:** extend `.maestro/statement-import.yaml` with a third scenario using the Sensebank fixture.

**Risks:**

- D.3's dedup-collision risk is marginally higher for Sensebank than Monobank/PrivatBank (minute-precision timestamps, not second-precision) — worth a specific look once real usage data exists, not a blocker to shipping.
- Confirm the recommended cp1251-decoder package's current maintenance status before pinning (C.5 — the one dependency in this plan not independently re-verified against a live npm listing).

**Checkpoints:** `make gate` after the format/decoder tasks land; `make verify` before Phase 3 is declared done.

### Phase 4 — iOS Share Extension (native target, ship last)

Deliberately sequenced after Phases 1-3: the extension's OWN job (B.2, steps 1-5) is narrow — receive a file, stage it in the App Group container, hand off a path — and everything downstream of "the app now has a `filePath`" is the SAME `StatementImportScreen` built in Phase 1 and extended in Phases 2-3, reused as-is with no changes. Shipping the Share Extension last also means it benefits from whichever formats have landed by then, rather than needing its own format-coverage decision.

**Files:**

- Create `ios/KikoShareExtension/` — new Xcode target (Xcode surgery: `project.pbxproj` gains a `PBXNativeTarget` of `productType = "com.apple.product-type.app-extension"`, a `PBXBuildPhase` embedding it in the host app's `Copy Files` phase, and its own `Build Configuration List`), `ShareViewController.swift` (B.2's 5 steps), `Info.plist` (the `NSExtension` dict, B.2), `KikoShareExtension.entitlements` (the App Group, B.2).
- Modify `ios/Kiko/Info.plist`: add `CFBundleURLTypes` for the `kiko://` scheme (B.2).
- Modify `ios/Podfile` if the extension target needs any CocoaPods dependency of its own (none are required by B.2's design — it uses only `Foundation`/`UIKit`); otherwise no Podfile change.
- Create `src/statement-import/pending-share/pending-share.ts` (+ `.test.ts`, + `index.ts`) — `usePendingStatementImport(navigationRef)` (B.2's cold/warm-start hook).
- Modify `App.tsx`: add `const navigationRef = createNavigationContainerRef<RootParamList>()`, pass `ref={navigationRef}` to `<NavigationContainer>`, mount `usePendingStatementImport(navigationRef)` inside `AppRoot` alongside the existing `useAutoSync()` call.
- Modify `src/navigation/types.d.ts` if `RootParamList` needs a new export for the ref's generic (check the current shape before assuming one is missing).

**Tests:**

- [ ] `pending-share.test.ts` — given a mocked `Linking.getInitialURL` resolving a `kiko://import-statement?path=...` URL, the hook navigates once `navigationRef.isReady()` is true; given a mocked `Linking` `url` event, the same; given no pending URL, it navigates nothing.
- [ ] No Jest coverage of `ShareViewController.swift` — Jest does not execute Swift. Its correctness against the App-Group-write hardening rule is covered by `check:security`/`check:rules` (the ALREADY-EXISTING `kiko-appgroup-write-needs-protection` fixture pair, Grounding above) at the harness level, not by a unit test.
- [ ] Maestro: a live Share Extension flow (launching another app, sharing into Kiko, backgrounding/foregrounding across the extension boundary) is NOT something Maestro's `.yaml` flow language can drive end-to-end reliably (it operates within one app's accessibility tree) — this is a MANUAL QA checklist item: share a real Monobank CSV (and, once available, a real PrivatBank XLSX) from Files.app into Kiko on a physical device, cold-start AND warm-start, and confirm the app opens directly to the correct holding-picker preview. Note this explicitly rather than silently having zero test coverage for this phase — the same honest carve-out `docs/plans/bank-providers.md` takes for PrivatBank's live-credential flow.

**Risks:**

- This is genuinely new native-project surface for Kiko (first-ever second target) — get one clean `make gate`-passing archive build BEFORE wiring the RN-side hook, so a build break is isolated to the Xcode-project change, not conflated with JS changes.
- `NSExtensionContext.open(_:completionHandler:)`'s exact cold-launch timing needs device verification; do not assume `Linking.getInitialURL()` alone covers every cold-launch race without confirming on a real device (mirrors the project's existing "prefer device over simulator" verification norm).
- The App Group container is NOT itself encrypted by this plan — it inherits whatever `FileProtectionType` is set (step 3, B.2), which is weaker than Kiko's own SQLCipher-gated database (`kiko-architecture`'s DB-encryption section) when that flag is on. The file is deleted immediately after being read (B.2's last bullet) specifically to bound this exposure window, not to eliminate it.

**Checkpoints:** `make gate` after the Xcode-target-only commit (no RN changes yet, just confirm the project still builds); `make gate` again after the RN hook lands; `make verify` before this phase is declared done; `make deep` before the WHOLE feature (Phases 1-4) is declared done.

---

## F. Local-first

Every step of this plan — file read, format detection, CSV/spreadsheet parsing, domain mapping, and the `addManyDedup` write — runs entirely on the device, synchronously within the JS thread (for parsing) or the local op-sqlite connection (for the write). No statement file, and no row derived from one, is ever sent to any server; Kiko has no backend today (the same fact `docs/plans/bank-providers.md`'s section C uses to explain why a consent-flow aggregator needs a NEW backend it doesn't yet have — this plan needs none, because nothing here calls out to any API at all — and, notably, unlike uabean's Monobank/Sensebank importers, which DO call out to a third-party GitHub-hosted MCC-description JSON at import time, Kiko's port deliberately drops that call entirely in favor of its own offline `categoryForMcc`, C.1/C.2). This is consistent with, and requires no exception to, Kiko's existing local-first model: the database is local (`@op-engineering/op-sqlite`, `kiko-architecture`), every credential lives in the Keychain rather than a server, and the one place this plan touches a shared filesystem location at all (the Share Extension's App Group hop, section B.2) is a same-device, same-app-group hand-off between two processes of the SAME app install — not a network boundary.

---

## Self-review

- **Spec coverage.** A (`StatementImporter`/registry design, now covering 3 shipped formats + a documented deferred/out-of-scope set, reuse of the exact domain-mapping layer, output-shape equality with the live-provider plan) — section A. B(1)/B(2) unchanged in substance, cross-checked against the expanded format set (binary-format base64 handling noted in B.1; UTI-inconsistency note in B.2 broadened from CSV-only to CSV+XLSX). C (uabean cloned to scratch and studied per the coordinator's brief, per-bank fact table for all 8 requested-plus-adjacent banks, 2 genuine scope findings — Oschadbank has no file format, "Alfa personal" doesn't exist — recorded rather than silently substituted, uabean credit/license/NOTICE, fixture-reuse disposition with the PrivatBank real-data flag, new dependency table with bundle-size notes) — C.0-C.5, all of the coordinator's 7 numbered asks addressed by name. D (dedup design now explicitly confirmed universal across every studied format, deletability decision unchanged) — D.1-D.4. E (phasing re-sequenced to Monobank -> PrivatBank -> Sensebank -> Share Extension, per the coordinator's explicit priority, each with steps/files/tests/risks) — E, 4 phases fully enumerated. F (local-first, no upload, plus the new MCC-JSON-call-dropped finding) — F.
- **Type consistency.** `ParsedTransaction`/`ParsedAccountHint`/`ParsedStatement`/`StatementFormat`/`StatementFormatId` (A.1) are unchanged in shape from the prior revision and referenced identically through A.2-A.4, C, and E's file lists; `statementFormatIds` grows by exactly the 2 new format ids Phases 2-3 add, matching A.2's registry array 1:1. `NewTransaction`'s field set in A.3 is unchanged and still matches `transactions.repo.ts`'s own type. `computeDedupKey`'s signature is identical in A.3's stub and D.1's full implementation, unchanged from the prior revision.
- **No placeholders left unresolved as fact.** Every unverified external detail (Monobank's English header text, PrivatBank's full currency-abbreviation set, the cp1251 decoder's exact current package) is marked **[VERIFY LIVE]** or "confirm at implementation time," never asserted as confirmed. Every new dependency (document picker, file-read, CSV, spreadsheet, XML, cp1251) is named with a concrete recommendation AND flagged as needing approval — none is installed by this plan. The PrivatBank XLSX fixture is explicitly flagged as likely-real data with a concrete synthetic-replacement instruction, not silently reused.
