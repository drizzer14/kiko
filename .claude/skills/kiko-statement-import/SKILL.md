---
name: kiko-statement-import
description: Invoke whenever you touch src/statement-import/**, src/screens/statement-import/**, or src/screens/column-mapping/**, add or edit a StatementFormat, or debug an "importing a bank statement" issue. Read before writing a format's detect/parse, a column-mapping change, or a saved-mapping key.
---

# Kiko statement import

Source of truth: `docs/plans/statement-import.md`. This skill summarizes
the settled contract for both the dedicated-format pipeline and the
generic column-mapping fallback.

## Format registry and detection

`src/statement-import/registry/registry.ts` holds `statementFormats`,
the ordered array of every shipped `StatementFormat` — read that file
directly for the current member set rather than trusting a list
restated here (it changes every time a bank is added; six formats as
of T17). `detectFormat(input)` returns the FIRST format whose `detect`
accepts the input, or `undefined` when nothing matches — that
`undefined` is a normal "we don't recognize this file" state, not an
error. `supportedFormatNames` joins every registered format's
`displayName` for the unrecognized-format message.

## The `StatementFormat` contract

`src/statement-import/parser/parser.ts` is the format-agnostic
contract every format implements:

- `StatementFormat = { id, displayName, detect, parse }` — `detect` is
  a cheap, non-throwing header/content-signature sniff; `parse` throws
  `StatementParseError` on a file `detect` accepted but whose body
  doesn't actually parse.
- `ParsedStatement = { formatId, account, transactions,
  unresolvedRows? }` — `formatId` is a `StatementFormatId` (the
  registry id) or `'column-mapping'` (see below).
- `ParsedTransaction.currency` is REQUIRED and is THIS ROW's own
  currency — a single-currency CSV format sets the same value on every
  row; PrivatBank XLSX (one row per card) sets each row's own resolved
  currency. This is what lets `importParsedStatement` exclude a
  mismatched-currency row rather than silently writing a foreign
  amount's raw minor units into a differently-denominated holding.
- `StatementFormatInput.sheetRows` carries PRE-PARSED spreadsheet rows
  for a binary format (PrivatBank XLSX): `detect`/`parse` must stay
  synchronous, so the async `read-excel-file` call runs once, ahead of
  time, in the screen (`read-statement-file.ts`'s
  `readSheetRowsSafely`), and hands the already-resolved rows through
  this field. A text format never sets it and keeps reading `text`.
- `UnresolvedStatementRow` (`'unmapped-currency' | 'invalid-amount'`)
  surfaces a row a format's `parse` recognized structurally but
  couldn't resolve, instead of throwing (which would abort the whole
  file) or silently dropping it.

## Encodings

`read-statement-file.ts`'s `decodeStatementText(base64, encoding)` is
the one Hermes-safe base64-to-text decode path for a picked file:
`decodeBase64ToBytes` (table lookup + bit-shifting, no `Buffer`, no
`atob`) produces a raw byte array shared by both encoding branches —
`'utf-8'` decodes those bytes with a hand-rolled `decodeUtf8Bytes`
(1/2/3/4-byte UTF-8, surrogate-pair aware), `'windows-1251'` decodes
the SAME bytes through the `windows-1251` npm package (Sensebank and
the FOP/business CSVs are cp1251-encoded, not UTF-8). This module's
UTF-8 decoder is its own local implementation, not the shared
`src/data-transfer/utf8/utf8.ts` helper documented for `.kiko`
export/import Hermes-safety — same reasoning (no `TextDecoder` under
Hermes), two separate call sites; do not assume touching one updates
the other.

## Detect → import pipeline

`importStatement(input, holdingId)` (`import-statement.ts`) is the
dedicated-format path: `detectFormat` → `format.parse` →
`importParsedStatement`. The column-mapping path has no
`StatementFormat` to detect/parse through — it builds its own
`ParsedStatement` (`formatId: 'column-mapping'`) directly via
`applyColumnMapping` and calls `importParsedStatement` itself,
skipping `importStatement`. Both converge on the same
`importParsedStatement`, which excludes any row whose `currency`
doesn't match the target holding's, dedups, and hands the batch —
plus the parsed statement's own `closingBalance`, when it has one —
to `transactionsRepo.importRows` in one db transaction, which upserts
the rows AND moves the target holding's balance (see `kiko-domain`'s
"Statement import moves the target holding's balance too" section,
and `importRows`'s own doc comment, for the exact balance rule —
`addManyDedup` is a DIFFERENT, still-live upsert-only path the sync
routes use, not statement import).

## Dedup

Every studied format ships with no bank-issued per-row id, so
`mapping.ts`'s `computeDedupKey(holdingId, transaction,
occurrenceIndex)` derives a deterministic key from `(holdingId, time,
amount, normalized-description)`, with `occurrenceIndex` (the Nth time
that exact tuple has been seen in this parse) appended only when
non-zero, so the common unique case's key stays stable.
`mapParsedTransaction` writes rows with `source: 'import'` and this
key as `externalId` (or the format's own `externalId` when one is
present), and `importParsedStatement` hands the whole batch to
`transactionsRepo.importRows` in one call — see "Detect → import
pipeline" above; `addManyDedup` is the separate, still-live
dedup-write path every sync route uses instead.

## Column mapping

A generic fallback for any file a dedicated `StatementFormat` doesn't
recognize, so an account not covered by a shipped bank parser can
still import: `src/statement-import/column-mapping/` reads the file
into plain `TableCell[][]` rows (`table-rows.ts`'s `readTableRows`,
shared by both a delimited CSV/TSV text via `papaparse` and a
pre-parsed `StatementFormatInput.sheetRows`), then turns a user-picked
`ColumnMapping` plus those rows into the SAME `ParsedStatement` shape a
dedicated format produces (`apply-column-mapping.ts`'s
`applyColumnMapping`, `formatId: 'column-mapping'`), so the rest of the
pipeline treats a mapped file identically to a recognized bank export.
A dedicated format is tried FIRST and still wins whenever it matches —
column mapping is offered only once `detectFormat` fails or the
account's `bankId` disagrees with the detected format (see
`statement-import.screen.tsx`).

Every date-format preset in `date-formats.ts` reads UTC wall-clock
parts (`Date.UTC(...)`), the same convention `parseDateTimeSeconds`
already uses for a dedicated format — a real spreadsheet `Date` cell is
read off its own UTC parts into that identical combined `'YYYY-MM-DD
HH:MM:SS'` string (`table-rows.ts`'s `formatUtcDateTime`) before
parsing, so a mapping pointed at an Excel date column behaves exactly
like one pointed at a text date column. An XLSX number cell is used
as-is (no reformatting) — only a `Date` cell gets this wall-clock
conversion.

The mapped `ParsedStatement` reaches the DB through the SAME
`importParsedStatement` (`src/statement-import/import-statement/`)
every dedicated format uses — it excludes any row whose currency
doesn't match the target holding's, dedups, and writes via
`transactionsRepo.importRows` (upsert + balance write in one
transaction — see "Detect → import pipeline" above). Column mapping
has no dedicated `StatementFormat` to detect/parse through, so it
builds its own `ParsedStatement` directly and calls
`importParsedStatement` rather than `importStatement`.

### Column roles, and the optional Balance column

Every `ColumnMapping` field (`apply-column-mapping.ts`) is a "role" a
user assigns to one of the file's own columns: date, date format,
amount (single, or debit/credit), description, and currency are
REQUIRED; counterparty and balance are OPTIONAL. `balanceColumn`
(import-balance commit B) is the running balance after each row — when
mapped, `resolveMappedClosingBalance` derives the parsed statement's
`closingBalance` from it, using the SAME "row with the newest parsed
time" rule Monobank CSV's own `resolveClosingBalance` uses (review
follow-up M2), reading the cell with the mapping's own
`decimalSeparator` (`parseAmountCell`, same as every other amount cell
this mapping reads). A tie on the newest time is broken by FILE ORDER,
not "last one wins" (ruling I1, commit `245265a`):
`pickClosingBalanceRow` reads the resolved rows' own first-vs-last time
to tell a newest-first file from an oldest-first one, then takes the
FIRST tied row in a newest-first file or the LAST in an oldest-first
one; when that orientation can't be determined (the file's first and
last resolved rows share one time), it falls back to the tied rows'
own balance cells — identical cells resolve to that value, genuinely
different cells yield no closing balance at all, rather than guess. A
missing or non-numeric cell on the chosen row also yields no closing
balance (review follow-up I1's original guard — never a `NaN` written
to the ledger), and so does leaving the column unmapped. Unlike
PrivatBank XLSX's own `balance` column (left unset — see
`ClosingBalance`'s doc comment in `parser.ts`), column mapping has no
`maskedCardHint` concept and accepts ANY file via "Map columns
manually" (`statement-import.screen.tsx`), including a multi-card
PrivatBank export — a mapped Balance column on one CAN mix cards (the
newest row may belong to a different card than the target holding).
This is an accepted, opt-in risk (see `ClosingBalance`'s own doc
comment in `parser.ts`), not a guarded one. `balanceColumn` is part of
`ColumnMapping`, so a saved mapping (below) remembers it automatically
— an old saved mapping simply lacks the field (`undefined`, backward
compatible, no migration needed).

## Saved mappings

A confirmed mapping is saved to `settings.statementMappings`
(`src/statement-import/column-mapping/saved-mapping.ts`, migration
`0034`) so a later import can pre-fill instead of asking the user to
remap every column. It's keyed by `mappingKeyFor`: a known catalog
bank uses `bank:<bankId>` (one shared mapping per bank, checked for an
EXACT fingerprint match against the file's actual header row before
being trusted as exact); any other account ("Other") is keyed by
`header:<fingerprint>` instead and matched by scanning every `header:`
entry for a fingerprint hit. Either way, `findSavedMapping` only
PRE-FILLS the mapping form — a saved mapping never imports a file
without the user tapping Import.

## Entry points

Two entry points reach the column-mapping screen: "Import statement"
shows on every bank account in account-detail (not gated on a
recognized `bankId`/format), and "Map columns manually" in
`statement-import.screen.tsx` offers a manual escape hatch from the
generic statement-import screen whenever a file was read at all
(including an unrecognized-format or bank-mismatch preview), routing
to `src/screens/column-mapping/column-mapping.screen.tsx`.

## Screen layout (device-feedback-round-F1)

Both `statement-import.screen.tsx` and `column-mapping.screen.tsx`
follow the same layout conventions as every other Kiko screen, after
a P0 UI fix round driven by device feedback:

- **Import (and, on the statement-import screen, "Map columns
  manually") live in `Screen`'s own `footer` slot**, not inline in the
  scrolling body — the same footer slot every other screen's main
  action uses. `statement-import.screen.tsx` extracts a module-scope
  `StatementImportFooter` for this (gated on `hasStats`/`hasInput`,
  `undefined` — not an always-defined element that renders `null` —
  when neither applies, since `Screen.footer` reserves clearance for
  ANY defined node); `column-mapping.screen.tsx` gates its own footer
  on `loadState.kind === 'ready'`.
- **"Choose a holding" is a labeled SELECT FIELD, not a Button.**
  `src/screens/statement-import/target-holding-field/` wraps the
  existing `FieldTrigger` + `TargetHoldingSheet` pair (the same
  field-plus-sheet family `ModeSelectField`/`HoldingSelectField`
  follow) — shared by both screens, replacing what used to be two
  independent Button-plus-sheet duplicates. `TargetHoldingSheet` itself
  (`target-holding-sheet/`) is UNCHANGED.
- **The preview/result summary reuses `SummaryTable`** (see
  `kiko-design-system`) — the statement-import preview's own
  transaction-count/currency/date-span rows
  (`statementImport.transactionCountLabel`/`currencyLabel`/
  `dateSpanLabel`), and the column-mapping result section's
  transaction-count/date-span rows, both go through the SAME shared
  component the deposit/bond value-breakdown block also uses — never
  each other's columns, only the row layout.
- **`ExampleTransaction`** (`src/screens/statement-import/example-
  transaction/`) is the ONE shared "first parsed row" preview, rendered
  under the summary table on both screens from `PreviewStats.firstTransaction`
  (the first `ParsedTransaction` in ON-FILE order, not chronological order
  — `previewStats` sets it via `parsed.transactions.at(0)`, optional
  since an existing `PreviewStats` object literal predates the field). As
  of F3 fix round 1 (C1) it renders through the shared `TransactionCard`
  (`src/screens/home/transaction-row/transaction-card/`) — the SAME
  presentational card Home's own `TransactionRow` uses, extracted out of
  that component, NOT a rebuilt card wrapping the base `Card` primitive
  (the original F3 item 4 attempt, which showed the date as its title and
  the amount with no income color — see the review's C1 finding). This
  is NOT pixel-identical to a real Home row, though — that was a false
  claim in an earlier pass of this skill (F3 fix round 2, N2): a preview
  row has no real transaction id / account / holding-type row to read, so
  its footer content differs from Home's own `"<account> · <category>"` +
  time (see below), by design.
  The category comes from the row's own `mcc` via `categoryForMcc` (the
  same key `mapParsedTransaction` writes), resolved through the live
  categories table exactly as Home resolves a real row's category
  (`ExampleTransaction` queries `categoriesRepo`/`settingsRepo` itself),
  and `TransactionCard` always renders its amount with `MoneyText`'s
  `"transaction"` context (no longer a caller-configurable prop — F3 fix
  round 2, N5 ponytail, since every consumer wanted exactly that), so an
  income preview row shows the same icon and income (green) color a Home
  row would. The title resolves through the SAME `transactionRowDescription`
  Home uses (F3 fix round 2, N3) — an empty mapped description falls back
  to the income/expense default label (fed the chosen target holding's
  name, via each caller's own `holdingName` prop, `undefined` before a
  holding is chosen) instead of rendering blank; `exchangeCounterpartHoldingId`
  is always `null` here (an import never creates an exchange-marked row).
  The footer shows the category title and the row's own date
  (`formatDate`) via `TransactionCard`'s existing optional `footerMeta`/
  `footerTrailing` props — the user's only per-row check that the chosen
  date format/column is right; Home is unaffected, since it already
  passes its own footer content through those same two props.
  `ExampleTransaction` owns its own `Divider`s above and below (F3 item 5)
  — a caller renders just `<ExampleTransaction ... />`, not a
  Divider/ExampleTransaction/Divider triple.
- **The raw preview grid** (`column-mapping/raw-preview/`) gives each
  column a CONSISTENT width across every row
  (`raw-preview/column-widths.ts`'s `computeColumnWidths`, keyed off
  the longest cell text seen in that column across the previewed
  rows) instead of a flat per-cell minimum, takes more vertical
  breathing room (`gap={2}` between rows, up from `1`), and paints the
  tapped header row with the theme's accent BLUE
  (`theme.colors.accent`) with `onAccent` cell text — replacing the
  former neutral `surfaceHigh` tint — matching the app's standard
  filled-accent selection vocabulary (OptionPills/ChipRow/SelectableRow),
  with its own cell text turned SEMIBOLD too (F3 item 8, `fontWeight:
  '600'` — the app's selected-label weight everywhere else, not `'700'`;
  fixed from an initial `'700'` pass in F3 fix round 1, M3) so the
  selected row reads as distinct even without color.
  "Tap the row with the column names" (`columnMapping.rawPreview`)
  renders at the `heading` type step instead of a muted `body`/
  `textSecondary` caption, so it reads clearly above the grid, and
  doubles as this section's own heading. The grid shows at most
  `PREVIEW_COLUMN_COUNT` (5) columns per row (F3 item 7) — a wide export
  (multi-card PrivatBank, say) no longer scrolls dozens of columns
  before the user has even picked a header row; every
  `ColumnSelectField`'s own option list is unaffected, since that is
  derived from the FULL header row in `column-mapping.screen.tsx`, not
  from this capped preview.
- **The amount-mode, currency-mode, encoding, and decimal-separator
  toggles are the shared `SegmentedControl`**
  (`src/design-system/components/segmented-control/`, F3 item 9) — an
  iOS `UISegmentedControl` per the HIG, superseding the `ChipRow` pass
  21d53cc gave them (see `kiko-design-system`'s own `SegmentedControl`
  entry for the full HIG citation, contrast fix, and accessibility
  details — fix round 1 addressed I3/M1/M2/M4; fix round 2 corrected M1's
  hitSlop base and M4's accessibility shape). `AmountFields` and
  `CurrencyFields` pass their own `accessibilityLabel` (the section
  heading text, `columnMapping.sectionAmount`/`sectionCurrency`), a
  REQUIRED prop; encoding/decimal-separator (`column-mapping.screen.tsx`,
  F3 fix round 2, M5 — applied, not left as the round-1 DEFAULT any
  more) pass their own field's label text instead, composed with a
  visible `FieldLabel` above the control (`SegmentedControl` itself
  carries no VISIBLE label prop — only `accessibilityLabel` — since the
  amount/currency sections rely on their own section heading for that;
  encoding/decimal-separator sit inside a shared "File Format" section
  alongside delimiter, so they need their own visible caption).
  DELIMITER (3-way) stays `ChipRow` (`src/screens/forms/chip-row/`) —
  `SegmentedControl`'s own HIG reference is for a 2-3-way EXCLUSIVE mode
  toggle, and delimiter fits it structurally too, but a 3-way delimiter
  swap was not part of the M5 DEFAULT the coordinator ruled on; `ChipRow`
  remains the compact short-code/label picker for it. `OptionPills` is
  not used anywhere on this screen — its 44pt-minimum centered pill reads
  as oversized for a short code/label.
- **Every section shows its own heading, at ONE uniform spacing, on
  BOTH screens** (F3 items 12/13/14, fixed in fix round 1 I1/I2 for
  column-mapping, fix round 2 for statement-import): the screen's former
  in-body title (duplicating the native stack header's own `title:
  t('columnMapping.title')`, `accounts.stack.tsx`) is REMOVED (item 12);
  every section — raw preview, file format, dates, amount columns,
  currency, additional details (description/counterparty/balance), and
  result — shows its own `heading`-step `Text` (item 14) as the PLAIN
  FIRST CHILD of its section's own `gap={3}` Box — no wrapper `Box` and
  no `marginBottom` style of its own. An earlier pass (F3 item 13's first
  landing) gave each heading an explicit `marginBottom: spacing(3)` INSIDE
  a `gap={3}` parent, which — Yoga adds a child's own margin ON TOP OF the
  parent's `gap`, same as CSS flexbox — actually produced 24pt below most
  headings, 12pt below the raw-preview one (no `gap` sibling), and 20pt
  below `MappingResult`'s "incomplete" heading (`gap={2}`), not the
  uniform spacing the comment claimed; `column-mapping.styles.ts` no
  longer has a `sectionHeading` style at all. `MappingResult` renders its
  own `columnMapping.result` heading UNCONDITIONALLY, in BOTH the
  `stats === undefined` and `stats !== undefined` branches, passing NO
  `title` to `SummaryTable` in the complete branch — before this fix the
  complete branch's heading was `SummaryTable`'s own `title` row (a
  `gap={1}` Box, 4pt below it), so the heading visibly jumped position the
  moment the last required column got mapped. `statement-import.screen.tsx`'s
  `StatementPreviewBlock` gets the SAME fix (F3 fix round 2): it renders
  its own `<Text variant="heading">{stats.displayName}</Text>` as the
  plain first child of its own `gap={3}` `previewBlock` Box, passing NO
  `title` to ITS `SummaryTable` either — before this fix that screen's
  heading sat in `SummaryTable`'s own `gap={1}` Box (4pt), not the same
  12pt every column-mapping section heading gets. `SummaryTable` itself
  is UNCHANGED on both screens — its `title` prop stays optional, simply
  unused by both these call sites now.
- **Fields are grouped with the shared `Divider`** between: (a)
  encoding/separators, (b) dates, (c) amounts/currency, (d)
  description/counterparty/balance (moved to the BOTTOM, in their own
  group, below amounts/currency — description used to sit between the
  date and amount groups), (e) result.
- **The target-holding picker shows each holding's own icon** (F3 item
  3, `target-holding-sheet.component.tsx`'s `SelectableRow` rows and
  `target-holding-field.component.tsx`'s `FieldTrigger`), the same
  `icon ?? holdingTypeSymbol[type]` / `resolveEntityColor` pair
  `transaction-form.screen.tsx`'s exchange `HoldingSelectField` resolves
  — `useTargetHoldingOptions` (shared by both statement-import screens)
  now resolves `icon`/`color` onto every `TargetHoldingOption` it
  returns.
- **Required fields show the red asterisk marker** (`FieldLabel`'s
  `required` prop, forwarded through `ColumnSelectField` and
  `FieldTrigger`) — date, date format, amount/debit/credit column(s),
  currency column (when in column mode), description, and the target
  holding field are marked required (holding: commit `6a835dd`);
  counterparty stays unmarked (optional), and
  `columnMapping.counterpartyColumn` no longer carries an
  "(optional)"/"(необов'язково)" suffix — the absent marker IS the
  optional signal now, matching every other optional field.
