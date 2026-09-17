# Statement-File Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a user get their bank's exported CSV statement into Kiko two ways — an in-app document-picker button on the account screen, and an iOS Share Extension that receives a file shared directly from the bank app — parsed on-device into the exact same `Account -> Holding -> Transaction` rows Kiko's live provider sync writes, with re-import-safe dedup.

**Architecture:** A `StatementFormat` abstraction (`detect` + `parse`, one implementation per bank/export shape, starting with Monobank's CSV) sits behind a small registry that auto-detects which format a file is. Its parser output is mapped, by a dedicated `mapping.ts` module, into the identical `NewTransaction` shape `src/monobank/sync/sync.ts`'s `mapStatementItem` already produces, and is written through the SAME `transactionsRepo.addManyDedup` (`src/transactions/repo/transactions.repo.ts`) upsert every other sync path uses — so a file import is a third producer of ordinary rows, not a parallel ledger. The two entry points (document picker, Share Extension) both resolve to one on-device file path and hand off to one shared screen; nothing is uploaded anywhere.

**Tech Stack:** React Native + TypeScript, op-sqlite + Drizzle (`src/db/schema.ts`), a CSV parser (new dependency, `papaparse` recommended), a document picker + a file-read library (new dependencies — see Phase 1), a native iOS Share Extension target (Swift, Phase 2), i18next (`src/i18n/locales/{en,uk}.ts`), Jest + RNTL, Maestro (`.maestro/`).

**Spec:** `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md` (domain model, storage) plus `docs/plans/bank-providers.md` (the live-API `BankProvider` abstraction this importer must stay output-compatible with — read there for `ProviderAccount`/`ProviderStatementItem`, which this plan's `ParsedAccountHint`/`ParsedTransaction` deliberately mirror). Read `kiko-architecture`, `kiko-domain`, `kiko-code-style` (project skills) before implementing — they are the source of truth for storage/domain/style conventions, not restated here.

## Global Constraints

- Every DB write goes through `db.transaction()` (`kiko-architecture`) — this plan adds no new write path; it reuses `transactionsRepo.addManyDedup`, which already wraps its upsert in one `write(...)`.
- `Money.minorUnits` is always an integer, never a float (`kiko-domain`) — every parsed amount converts through `Money.fromMajor`/`parseAmount` (`src/currency/`), never a bare `Number(...) * 100`.
- Parsing runs entirely on the device. No statement file, or any row parsed from one, is ever sent to a server — Kiko has no backend (see section F).
- `transactions.source` (`src/db/schema.ts:125`) is a Drizzle TS-only enum — adding `'import'` is a one-line change, no migration, exactly the precedent `docs/plans/bank-providers.md` sets for adding `'privatbank'`.
- Every new native-module/CSV dependency is pinned exact (`.npmrc` `save-exact=true`, root `CLAUDE.md` "Pin exact dependency versions") and needs explicit approval before Phase 1/2 starts — none of the three libraries named below (document picker, file-read, CSV parser) are on the project's pre-approved list.
- `npm run check:all` (`make gate`) after every task; `make verify` (lint + full Jest + gate) before a phase is declared done; `make deep` before the whole feature is declared done (root `CLAUDE.md`).

---

## Grounding: what already exists

Read directly, not restated in full here:

- **The exact target shape** — `transactionsRepo.addManyDedup` (`src/transactions/repo/transactions.repo.ts:586-643`): upserts a batch on the `(source, external_id)` unique index (`transactions_source_external`, `src/db/schema.ts:130`), applies name→category override rules, and refreshes only the BANK-owned columns on conflict (`amountMinorUnits`, `description`, `hold`, `mcc`, `counterIban`, `time` — never `category`/`comment`). This is the exact dedup engine this plan needs; it is not rebuilt, only fed.
- **The exact mapping precedent** — `mapStatementItem` (`src/monobank/sync/sync.ts:232-259`) turns one bank statement item into a `NewTransaction`; `mapAccountToHolding` (`sync.ts:261-279`) turns one bank account into a `NewHolding`. This plan's `mapping.ts` (section A) produces the identical `NewTransaction` field set for a parsed CSV row.
- **Currency + category mappers already generic enough to reuse** — `categoryForMcc` (`src/monobank/mcc-category/mcc-category.ts:69`) takes a bare MCC number, nothing Monobank-specific about its signature. `currencyFromCode` (`src/monobank/currency-code/currency-code.ts`) maps a NUMERIC ISO 4217 code; a CSV's currency column is more likely an ALPHABETIC code (`'UAH'`), which instead validates directly against `isCurrency`/`currencyOptions` (`src/currency/currency/currency.ts:15,378`) — confirm the real column's format against an actual exported file before Phase 1 ships (see section C).
- **The amount/money boundary** — `parseAmount` (`src/currency/parse/parse.ts`) turns a decimal-separator-ambiguous string into a `number`; `Money.fromMajor(currency, major)` (`src/currency/money/money.ts:22`) turns that into integer minor units at the correct per-currency scale. Both are already used together in `holding-form.screen.tsx`.
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
 * discipline applies to a file-sourced row as to a live-API one — a future
 * provider's live sync and this importer could even share a mapper if their
 * field names are kept in lockstep. */
export type ParsedTransaction = {
  /** A bank-issued unique id, when the export format actually carries one.
   * Monobank's CSV export carries none (see section C) — `undefined` here,
   * NOT a placeholder string. The mapper (A.3) synthesizes a deterministic
   * key when this is absent (section D). */
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
   * holding — matching is always the user's explicit pick (section C). */
  suggestedName?: string;
  iban?: string;
  maskedPan?: string;
};

export type ParsedStatement = {
  formatId: StatementFormatId;
  account: ParsedAccountHint;
  transactions: ParsedTransaction[];
};

export const statementFormatIds = ['monobank-csv'] as const;
export type StatementFormatId = (typeof statementFormatIds)[number];

export type StatementFormatInput = { text: string; fileName: string };

export interface StatementFormat {
  id: StatementFormatId;
  displayName: string;
  /** A cheap, non-throwing header-signature sniff — see section C for
   * Monobank's exact signature and its known ambiguity (export language). */
  detect: (input: StatementFormatInput) => boolean;
  /** Throws `StatementParseError` on a file that `detect` accepted but whose
   * body doesn't actually parse (a truncated download, a locale variant the
   * column mapper doesn't recognize). */
  parse: (input: StatementFormatInput) => ParsedStatement;
}

export class StatementParseError extends Error {}
```

### A.2 The registry

```ts
// src/statement-import/registry/registry.ts
import { monobankCsvFormat } from '../formats/monobank-csv';
import type { StatementFormat, StatementFormatInput } from '../parser';

export const statementFormats: StatementFormat[] = [monobankCsvFormat];

/** First format whose `detect` accepts the input, or `undefined` — a file
 * matching no known format is NOT an error here, it is the screen's "we
 * don't recognize this file" state (section B.1). */
export const detectFormat = (input: StatementFormatInput): StatementFormat | undefined =>
  statementFormats.find((format) => format.detect(input));
```

Adding a second bank/format later (PrivatBank's own CSV/XML export, Wise, Binance — see uabean, section C) is exactly one new entry in `statementFormats`; nothing else in this plan changes shape.

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
 * see section D for the full algorithm and its accepted limitation. */
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

This is deliberately the SAME field set `mapStatementItem` writes (minus `hold`, which stays unset/`null` — an exported statement row is always settled, there is no pending-authorization concept in a file export). `categoryForMcc`, `normalizeTransactionName`, and the `NewTransaction` shape itself are imported, not reimplemented.

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

`importStatement` takes already-read file TEXT, not a path — file reading (native, path-shaped) is the caller's job (section B), keeping this module pure and trivially unit-testable against fixture strings.

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

`pickAndOpenStatement` (a new handler in `account-detail.screen.tsx`, same style as `connectMonobank`): opens the document picker (`pick({ type: [types.csv, types.plainText] })`, the new `@react-native-documents/picker` dependency — see Phase 1's file list for the exact package and the alternative), reads the picked `uri` with the file-read library (`RNFS.readFile(uri, 'utf8')`) into a plain-text local copy if needed (iOS document-picker URIs are security-scoped and directly readable; no App-Group hop is needed for this entry point, unlike the Share Extension), and navigates to `StatementImport` with the resulting local `filePath` and this screen's `accountId`.

Design-system components used: `Box`, `Button` (existing, no new component needed for this entry point).

### B.2 iOS Share Extension (Phase 2) — the honest native shape

**A new Xcode target, not a plist tweak.** Kiko's `ios/Kiko.xcodeproj` today has exactly one `PBXNativeTarget` (`productType = "com.apple.product-type.application"`, confirmed by reading `project.pbxproj`). Phase 2 adds a SECOND native target, `KikoShareExtension`, of `productType = "com.apple.product-type.app-extension"`, embedded in the host app's `Copy Files` build phase — the standard, only way iOS lets an app deliver a Share Extension. This is Xcode-project surgery (a new target via Xcode's "Share Extension" template, or hand-added `PBXNativeTarget`/`PBXBuildPhase` entries), not something `react-native.config.js` or an npm postinstall script can fake.

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

Deliberately a BROAD "any single file" rule, not a CSV-specific UTI predicate (`NSExtensionActivationSupportsAttachmentsWithMaxCount` keyed to `public.comma-separated-values-text`): different banking apps tag their exported file's UTI inconsistently when sharing it directly from their own in-app share sheet (some register a specific UTI, some fall back to generic `public.data`), so a UTI-scoped rule risks Kiko silently not appearing in the share sheet for a bank whose export the rule doesn't recognize. The extension itself validates the file (extension + a successful `detectFormat`) after receiving it and shows an honest "we don't recognize this file" state rather than silently failing — the same non-error `detectFormat` returns `undefined` state the in-app picker uses (section A.2).

**`ShareViewController.swift`** (new file, `ios/KikoShareExtension/ShareViewController.swift`) — a minimal `UIViewController`, NOT `SLComposeServiceViewController` (that base class is for the "compose a post" UI Kiko doesn't want; a plain `UIViewController` lets the extension do its work with no visible UI beyond a brief system-presented sheet):

1. Read `extensionContext?.inputItems` -> the shared file's `NSItemProvider` -> `loadFileRepresentation(forTypeIdentifier:completionHandler:)` to get a temporary file URL.
2. Copy its bytes into the App Group container: `FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.dmytro-vasylkivskyi.kiko")` (the ALREADY-DECLARED group — Grounding, above) `.appendingPathComponent("StatementImports/\(UUID().uuidString).csv")`, then `try data.write(to: fileURL, options: .atomic)`.
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

### C.1 Monobank CSV — the first format

Monobank's personal-banking app exports a "statement" CSV from Card -> Statement -> Export/Share, in the app's currently selected display language (Ukrainian or English) — this means the header row's text is LOCALE-DEPENDENT, a real ambiguity `detect` must handle (below). The known column set, based on the publicly documented export and cross-checked against `OSadovy/uabean`'s Monobank statement importer (MIT-licensed; a REFERENCE for the real-world column shape and edge cases across several Ukrainian/international bank/exchange exports — Monobank, PrivatBank, Wise, Binance — never copied verbatim, only consulted):

| Column (uk) | Column (en) | Maps to |
|---|---|---|
| `Дата i час операції` | `Date and time` | `timeSeconds` (parse as local Kyiv time unless the export states otherwise — **[VERIFY LIVE]** against a real exported file) |
| `Деталі операції` | `Description` | `description` |
| `MCC` | `MCC` | `mcc` (kept as `MCC` in both locales per Monobank's own export — **[VERIFY LIVE]**) |
| `Сума в валюті картки` | `Card currency amount` | `amountMinorUnits` (via `parseAmount` + `Money.fromMajor`) |
| `Валюта картки` | `Card currency` | `account.currency` — **[VERIFY LIVE]** whether this is the ALPHABETIC ISO code (`'UAH'`, validated via `isCurrency`) or something else; do not assume the live API's numeric-code convention (`currencyFromCode`) applies here without confirming against a real file |
| `Залишок після операції` | `Balance after operation` | not imported (no running-balance column in the domain model; `holdingsRepo` balance is the holding's live field, not derived from a statement) |

**Delimiter is not necessarily a comma.** A Ukrainian-locale CSV export commonly uses `;` (semicolon) as the field separator, since `,` is the decimal mark in that locale's own number formatting. `parse` uses the CSV library's delimiter AUTO-DETECTION (`papaparse`'s `Papa.parse(text, { delimiter: '', header: true })` — an empty `delimiter` triggers its own sniffing) rather than hardcoding `,`.

**`detect`'s header signature** matches EITHER the Ukrainian OR the English header row (a `Set` of known header-column-name variants, checked against the parsed header row after the same auto-detected delimiter), not a single fixed string — a rule that matches only one export language would silently fail to recognize the file for every user whose Monobank app is set to the other language.

```ts
// src/statement-import/formats/monobank-csv/monobank-csv.format.ts (shape, not final)
const HEADER_SIGNATURES: readonly (readonly string[])[] = [
  ['Дата i час операції', 'Деталі операції', 'MCC'],
  ['Date and time', 'Description', 'MCC'],
];

export const monobankCsvFormat: StatementFormat = {
  id: 'monobank-csv',
  displayName: 'Monobank',
  detect: ({ text }) => {
    const header = Papa.parse(text, { delimiter: '', preview: 1 }).data.at(0) as string[] | undefined;

    return HEADER_SIGNATURES.some((signature) =>
      signature.every((column) => header?.includes(column)),
    );
  },
  parse: (input) => { /* Papa.parse with header: true, map each row via C.1's table */ },
};
```

A fixture pair — a real, anonymized Monobank CSV export in each supported language — lives at `src/statement-import/formats/monobank-csv/__fixtures__/` and backs the format's own test (Phase 1's file list). **Obtaining a real exported file (not a hand-authored guess at its exact bytes) is a prerequisite for this task**, since every `[VERIFY LIVE]` cell in the table above can only be closed by reading one.

### C.2 Currency, dates, and the holdings-vs-transactions distinction

- **Currency**: resolved once per file from `ParsedAccountHint.currency` (C.1's mapping), used both to validate/suggest a target holding (the picker, section B, hints at holdings whose `currency` matches, without hard-filtering — a user may still deliberately import into a mismatched holding, e.g. recording a card statement onto a cash holding they use as a shadow ledger) and, when creating a NEW holding from the sheet, to seed `HoldingForm`'s currency field.
- **Dates**: `ParsedTransaction.timeSeconds` is a UNIX seconds value the mapper multiplies by 1000 (A.3), the identical convention `mapStatementItem` uses for the live API's `item.time`. The CSV's own date/time STRING format and timezone convention is a **[VERIFY LIVE]** item (C.1) — parse it explicitly (a named format string, e.g. `DD.MM.YYYY HH:mm:ss`), never `Date.parse` on a locale-ambiguous string (mirrors the `kiko-domain` "Dates" section's warning against ambiguous native `Date` parsing).
- **Holdings-vs-transactions distinction**: this plan's `ParsedStatement` shape is a LEDGER (a list of `ParsedTransaction`, one `ParsedAccountHint`) — the Monobank CSV format is exactly this shape. A future format that instead exports a POINT-IN-TIME balance sheet (e.g. a crypto exchange's holdings snapshot, closer to uabean's Binance/Wise handling) does not fit `ParsedStatement` as defined and needs its own sibling type (e.g. `ParsedHoldingSnapshot`, out of scope for this plan — flagged here so a future format author does not force a holdings export through the transactions-shaped contract). Monobank CSV is transactions-only; no Phase of this plan needs the holdings-snapshot shape.

### C.3 Choosing or creating the target account

The user NEVER has a target auto-selected without confirmation. Section B's `StatementImportScreen` always shows the holding picker; a holding is either:

- an EXISTING plain holding (any `holdings` row whose account is not the same institution the file was detected as, though nothing technically prevents importing into a `monobank`-institution-connected holding too — the picker does not forbid it, since a user might import an older statement predating their live connection), selected via `SelectableRow` in the `BottomSheet`, or
- a brand NEW holding, created via the existing `HoldingForm` screen (navigated to with the detected currency pre-filled), through the existing `holdingsRepo.create` path — no new holding-creation code is added by this plan.

---

## D. Dedup

**Re-importing an overlapping statement must not duplicate rows.** This reuses `transactionsRepo.addManyDedup`'s existing `(source, external_id)` upsert (Grounding, above) wholesale — no new dedup mechanism is built. The only new work is computing a stable `externalId` for a format (like Monobank's CSV) that carries no bank-issued row id at all.

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

**date + amount + description, an external id when present**: when a future format DOES carry a real per-row id (uabean's Wise/Binance exports, for example, or a future Kiko-native bank integration that expands the CSV importer), `ParsedTransaction.externalId` is set directly and `mapParsedTransaction` uses it as-is (A.3) — `computeDedupKey` is only the fallback for a format that has nothing better.

### D.2 Where the check runs

Entirely inside `transactionsRepo.addManyDedup` (`src/transactions/repo/transactions.repo.ts:586`), inside its own `write(...)` transaction — the importer never queries for "does this already exist" itself, exactly mirroring `kiko-architecture`'s explicit warning against a JS-side "already imported" filter (the Monobank sync used to have one and it was a bug: it could drop a re-fetched item before the database ever compared it). `importStatement` (A.4) hands the WHOLE batch to `addManyDedup` in one call.

### D.3 Accepted limitation

Two GENUINELY different transactions sharing the exact same holding, second-precision timestamp, minor-units amount, AND normalized description are indistinguishable from two occurrences of the same key and will dedup onto ONE stored row on a re-import that reorders them (a same-file re-import is safe — reparsing preserves row order — but importing two DIFFERENT overlapping exports of the same window whose row order differs is not guaranteed safe against this edge case). This is the same class of accepted, documented risk as the `image-size`/`decode-uri-component` CVEs and the crypto-price all-or-nothing debt already recorded in the root `CLAUDE.md` — real, narrow, and not silently swept under a suppression. Do not "fix" it with a broader key (e.g. dropping the description entirely) without a concrete false-negative report; a broader key trades this rare collision for a common one (two DIFFERENT small transactions of the same amount on the same day would then collide constantly).

### D.4 Deletability: `'import'` rows follow the synced-row rule, not the manual one

New `transactions.source` enum member `'import'` (`src/db/schema.ts:125`, TS-only, no migration — the same one-line-widening precedent `docs/plans/bank-providers.md` sets for `'privatbank'`). Because `isSyncedTransaction` (`src/holdings/deletable/deletable.ts:11`) is `row.source !== 'manual'`, an imported row is — like a `'monobank'`/`'binance'` row — REFUSED by `transactionsRepo.remove` (an individual-row delete). This is a deliberate choice, not an oversight: `addManyDedup`'s upsert means a deleted-then-re-imported row would silently resurrect on the next overlapping import (exactly the reason a live-synced row is protected the same way today). The user still has two real outs: (1) `transactionsRepo.setCategory` has NO source gate, so a mis-categorized imported row is freely recategorizable, and a later re-import never clobbers that pick (`addManyDedup`'s update set excludes `category`, Grounding above); (2) `holdingsRepo.remove` deletes an ENTIRE holding and every transaction under it unconditionally (no per-row gate in its delete loop) provided the holding itself is not `isSyncedHolding` — and an imported holding never is, since it carries no `syncedMetadataFields` key (`src/holdings/holding-metadata/holding-metadata.ts:57`) and its account need not be institution-connected. So a whole bad import is fully undoable by deleting its holding; a single bad row inside an otherwise-good import is not individually deletable, only recategorizable.

---

## E. Phasing

### Phase 1 — Document-picker import (pure JavaScript, ship first)

**New dependencies (need approval before this phase starts):** a document picker (`@react-native-documents/picker` recommended — the actively maintained successor to the now-archived `react-native-document-picker`; confirm current npm status at implementation time), a file-read library (`react-native-fs` recommended; `react-native-blob-util` as a fallback if `react-native-fs`'s maintenance has lapsed by implementation time), and a CSV parser (`papaparse`, plus `@types/papaparse` if it ships no own types). Each is pinned exact (`.npmrc`) and added to `jest.config.js`'s `transformIgnorePatterns` allow-list ONLY if it ships untransformed source (`kiko-code-style`'s "Testing a native/ESM dependency" — check each package's actual `node_modules` output before assuming it needs the entry).

**Files:**

- Create `src/statement-import/parser/parser.ts` (+ `.test.ts`, + `index.ts`) — A.1's types, `StatementParseError`.
- Create `src/statement-import/formats/monobank-csv/monobank-csv.format.ts` (+ `.test.ts`, + `index.ts`, + `__fixtures__/monobank-statement.uk.csv`, `__fixtures__/monobank-statement.en.csv`) — C.1.
- Create `src/statement-import/registry/registry.ts` (+ `.test.ts`, + `index.ts`) — A.2.
- Create `src/statement-import/mapping/mapping.ts` (+ `.test.ts`, + `index.ts`) — A.3, D.1.
- Create `src/statement-import/import-statement/import-statement.ts` (+ `.test.ts`, + `index.ts`) — A.4.
- Modify `src/db/schema.ts`: add `'import'` to `transactions.source`'s enum tuple (line 125).
- Create `src/screens/statement-import/statement-import.screen.tsx` (+ `.styles.ts`, + `.screen.test.tsx`) — B's shared preview + target-holding screen.
- Create `src/screens/statement-import/target-holding-sheet/` (`.component.tsx` + `.props.d.ts` + `.styles.ts` + `.component.test.tsx` + `index.ts`) — the `BottomSheet` + `SelectableRow` holding picker (B, mirrors `docs/plans/bank-providers.md`'s `AddBankProviderSheet` shape).
- Modify `src/navigation/types.d.ts`: add `StatementImport: { filePath: string; accountId?: string }` to `AccountsStackParamList`.
- Modify `src/navigation/accounts.stack.tsx`: register the `StatementImport` screen.
- Modify `src/screens/account-detail/account-detail.screen.tsx`: the two-button footer row + `pickAndOpenStatement` handler (B.1).
- Modify `src/i18n/locales/en.ts` and `uk.ts`: `accountDetail.importStatement`, `statementImport.previewHeading`, `statementImport.unrecognizedFormat`, `statementImport.chooseHolding`, `statementImport.createNewHolding`, `statementImport.importButton`, `statementImport.importedCount`. Check: `en.uk.parity.test.ts`.

**Tests (Jest + RNTL):**

- [ ] `parser.test.ts` — `StatementParseError` construction; the shared types compile (a type-only test if nothing else is runtime-testable there).
- [ ] `monobank-csv.format.test.ts` — `detect` accepts both fixture files, rejects an unrelated CSV (e.g. a header-less or differently-shaped file); `parse` on each fixture produces the expected `ParsedStatement` (transaction count, currency, first/last row's exact fields).
- [ ] `registry.test.ts` — `detectFormat` returns the Monobank format for a matching input, `undefined` for a non-matching one.
- [ ] `mapping.test.ts` — `mapParsedTransaction` produces the exact `NewTransaction` field set (including `source: 'import'`, `category` from `categoryForMcc`, null `hold`); `computeDedupKey` is stable across two calls with identical input and DIFFERS only by `occurrenceIndex` for exact duplicates.
- [ ] `import-statement.test.ts` — injected-`transactionsRepo` style (mirrors `src/monobank/sync/sync.test.ts`'s deps-injection): a first import calls `addManyDedup` once with every mapped row; a second import of the SAME text against the same holding calls it again and `addManyDedup`'s own dedup (exercised for real against an in-memory/test DB, not re-mocked) reports 0 newly imported; an unrecognized file throws `StatementParseError` before any repo call.
- [ ] `statement-import.screen.test.tsx` — renders the preview for a valid file; renders the "unrecognized format" state for an invalid one; selecting a holding then pressing Import calls `importStatement` and shows the imported count.
- [ ] `target-holding-sheet.component.test.tsx` — lists holdings (scoped to `accountId` when provided), selecting one closes the sheet and reports the choice, "Create new holding" navigates to `HoldingForm`.
- [ ] `account-detail.screen.test.tsx` — extend to cover the new footer button rendering and `pickAndOpenStatement`'s picker-cancelled / picker-succeeded paths (mock the document-picker and file-read modules).

**Maestro:** no live-credential constraint applies here (unlike Monobank/PrivatBank connect) — a small CSV fixture CAN be checked into `.maestro/` and shared via the picker in a headless simulator run. Add `.maestro/statement-import.yaml` (a NEW flow, not folded into `regression.yaml`, since it needs a fixture file staged into the simulator's Files app first — out of scope for the existing regression baseline's screenshot-diff pipeline): open Accounts -> an account -> Import statement -> pick the fixture -> assert the preview shows the expected transaction count -> pick a holding -> Import -> assert the success text. This is a functional flow assertion, not a screenshot-diff check (`docs/harness/screenshots-check.md`'s pipeline is unrelated).

**Risks:**

- The three new dependencies are unapproved; if the coordinator/user rejects one, the concrete package choice changes but the shapes in section A/B.1 (a `uri` in, a `filePath`/text out) do not.
- Every `[VERIFY LIVE]` cell in C.1's table blocks writing the real fixture files — this phase cannot ship a correct Monobank parser without at least one real exported CSV in each supported app language.
- `noExcessiveCognitiveComplexity` (Biome, cap 15) on `monobank-csv.format.ts`'s `parse` — budget for a helper-per-column-group split from the start (mirrors `mapStatementItem`'s own flat, small shape) rather than one large row mapper.

**Checkpoints:** `make gate` after the schema/parser/mapping/import-statement tasks land; `make gate` again after the screen/sheet/account-detail UI tasks land; `make verify` before Phase 1 is declared done.

### Phase 2 — iOS Share Extension (native target, ship second)

Deliberately sequenced after Phase 1: the extension's OWN job (B.2, steps 1-5) is narrow — receive a file, stage it in the App Group container, hand off a path — and everything downstream of "the app now has a `filePath`" is Phase 1's `StatementImportScreen`, reused as-is with no changes.

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
- [ ] Maestro: a live Share Extension flow (launching another app, sharing into Kiko, backgrounding/foregrounding across the extension boundary) is NOT something Maestro's `.yaml` flow language can drive end-to-end reliably (it operates within one app's accessibility tree) — this is a MANUAL QA checklist item: share a real Monobank CSV from Files.app into Kiko on a physical device, cold-start AND warm-start, and confirm the app opens directly to the correct holding-picker preview. Note this explicitly rather than silently having zero test coverage for Phase 2 — the same honest carve-out `docs/plans/bank-providers.md` takes for PrivatBank's live-credential flow.

**Risks:**

- This is genuinely new native-project surface for Kiko (first-ever second target) — get one clean `make gate`-passing archive build BEFORE wiring the RN-side hook, so a build break is isolated to the Xcode-project change, not conflated with JS changes.
- `NSExtensionContext.open(_:completionHandler:)`'s exact cold-launch timing (whether the host app's `application(_:didFinishLaunchingWithOptions:)` — which React Native's own `AppDelegate` already owns — receives the `kiko://` URL via `application(_:open:options:)` reliably on EVERY cold launch, or only after the app has already been launched once) needs device verification; do not assume `Linking.getInitialURL()` alone covers every cold-launch race without confirming on a real device (mirrors the project's existing "prefer device over simulator" verification norm).
- The App Group container is NOT itself encrypted by this plan — it inherits whatever `FileProtectionType` is set (step 3, B.2), which is weaker than Kiko's own SQLCipher-gated database (`kiko-architecture`'s DB-encryption section) when that flag is on. The file is deleted immediately after being read (B.2's last bullet) specifically to bound this exposure window, not to eliminate it.

**Checkpoints:** `make gate` after the Xcode-target-only commit (no RN changes yet, just confirm the project still builds); `make gate` again after the RN hook lands; `make verify` before Phase 2 is declared done; `make deep` before the WHOLE feature (Phase 1 + Phase 2) is declared done.

---

## F. Local-first

Every step of this plan — file read, format detection, CSV parsing, domain mapping, and the `addManyDedup` write — runs entirely on the device, synchronously within the JS thread (for parsing) or the local op-sqlite connection (for the write). No statement file, and no row derived from one, is ever sent to any server; Kiko has no backend today (the same fact `docs/plans/bank-providers.md`'s section C uses to explain why a consent-flow aggregator needs a NEW backend it doesn't yet have — this plan needs none, because nothing here calls out to any API at all). This is consistent with, and requires no exception to, Kiko's existing local-first model: the database is local (`@op-engineering/op-sqlite`, `kiko-architecture`), every credential lives in the Keychain rather than a server, and the one place this plan touches a shared filesystem location at all (the Share Extension's App Group hop, section B.2) is a same-device, same-app-group hand-off between two processes of the SAME app install — not a network boundary.

---

## Self-review

- **Spec coverage.** A (`StatementImporter`/registry design, reuse of the exact domain-mapping layer, output-shape equality with the live-provider plan) — section A, citing `mapStatementItem`/`addManyDedup`/`categoryForMcc` by exact file:line. B(1) (in-app document-picker button, named design-system components) — B.1. B(2) (Share Extension, honest native detail: new Xcode target, App Group entitlement, RN hand-off, cold/warm start) — B.2, grounded in the ALREADY-EXISTING App Group entitlement and the ALREADY-EXISTING `kiko-appgroup-write-needs-protection` Semgrep rule. C (Monobank CSV first, extensible registry, uabean as reference not copy, mapping, user-chosen account, currency/dates/holdings-vs-transactions) — C.1-C.3. D (dedup key design, where it runs) — D.1-D.4, including the deliberate deletability decision the task didn't explicitly ask for but the domain model forces a choice on. E (phasing: Phase 1 = document picker first, Phase 2 = Share Extension second, each with steps/files/tests/risks) — E, both phases fully enumerated. F (local-first, no upload) — F, explicit.
- **Type consistency.** `ParsedTransaction`/`ParsedAccountHint`/`ParsedStatement`/`StatementFormat`/`StatementFormatId` (A.1) are defined once and referenced identically through A.2-A.4, C, and E's file list. `NewTransaction`'s field set in A.3 matches `transactions.repo.ts`'s own `NewTransaction` type (same Pick/Partial shape) plus the plan's own `source: 'import'` addition — no renamed field slipped through a later section. `computeDedupKey`'s signature (`holdingId, transaction, occurrenceIndex`) is identical in A.3's stub and D.1's full implementation.
- **No placeholders left unresolved as fact.** Every unverified external detail (Monobank CSV's exact date format, its currency column's alphabetic-vs-numeric convention, whether the MCC column header stays `'MCC'` in both locales, the App-Group-write's exact cold-launch timing) is marked **[VERIFY LIVE]** or called out as a device-verification risk, never asserted as confirmed. The three new npm dependencies are named with a concrete recommendation AND flagged as needing approval, not left as "pick something."
