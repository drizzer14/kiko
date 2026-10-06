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
restated here (it changes every time a bank is added). `detectFormat(input)` returns the FIRST format whose `detect`
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

**The preview of the balance runs the import's own reads.** Both screens
(statement-import and column-mapping) show an `ImportBalanceLine` from
`useImportBalancePreview` (`src/statement-import/use-import-balance-preview/`)
-> `previewParsedStatementBalance` (`import-statement.ts`) ->
`transactionsRepo.previewImportBalance`, which shares
`readImportPlanDatabaseTransaction` and `resolveImportBalance` with `importRows`
so the preview equals the stored result (pinned by a parity test on real
SQLite). `previewParsedStatementBalance` throws
(the "preview-pending" error) until BOTH one-shot rewrites have settled
(`settings.dedupKeysUpgraded` and `settings.importTimesRezoned`): the preview
does not run `upgradeStoredDedupKeys` / `rezoneImportTimes`, so before they
settle its dedup could differ from the import's. The hook logs the failure
(tag only, through `logFailure`) and shows no line; a refusal of the import
itself (a synced or ledgerless holding) also shows none. The hook needs a
statement that keeps its identity between renders, since a new one is a new
request, and the newest request wins. Never add a second copy of the balance
rule for the preview.

**An imported row can be deleted, and its amount goes with it.** `transactionsRepo.remove`
takes the row's full amount back from its holding whatever its date against the
boundary (user rule 2026-10-05, "Every transaction updates its balance" in
kiko-domain): the balance moves only, `balanceSetAt` stays, and no bank figure
is stored, so deleting every row of an import ends on the statement's opening
balance. Re-importing the same file brings a deleted row back (no tombstone;
accepted): with a closing balance its amount returns with it, and a no-closing
file's row dated before the boundary returns as history without its amount.
`dropRowsHeldBySync` still stops a duplicate of a bank row from returning
once the account is disconnected, and a connected account refuses the import.

**A synced account refuses the import.** `importRows`
(`src/transactions/repo/transactions.repo.ts`) throws an Error with the
message statement-import/synced-account, before it writes anything, for any
holding of an account `isSyncedAccount` owns (a hand-added holding there
included): the sync already writes those rows under its own `source`, so
an `import` copy would be a second one. Account detail hides "Import statement" there with no caption;
the guard covers a stale route. The target-holding picker
(`useTargetHoldingOptions`) applies the same `isSyncedAccount` test, so it
never offers a holding the guard refuses; it also drops closed and
ledgerless holdings.

**A ledgerless holding refuses the import.** Right after its anchored and
synced-account checks, `importRows` throws an Error with the message
statement-import/ledgerless-holding for a holding of an
`isLedgerlessHoldingType` type (a stale route can still name one). The
statement-import and column-mapping screens derive the effective target at
render: they keep `pickedHoldingId`, and `selectedHoldingId` is the picked id
only when it is in the live options. The `[holdingId]` effect never clears
it, because the live options can lag the `popTo`.

**A disconnected bank's synced rows count as present.** A disconnected
account is manual again and imports, but its holdings keep their synced
(`monobank`, ...) rows. `importRows` drops every statement row with a
synced row of the same holding and the same amount dated within ±60 s
(`dropRowsHeldBySync`): it is not inserted and adds nothing to the
balance. One synced row stands for one statement row. Pairing is a sweep
per amount, never in file order: the statement rows claim in order of
where their reach ends, and each takes the EARLIEST unclaimed same-amount
synced row in its reach. The reach end is the only primary key; a
date-only row claims after a timed row only where both reaches end at the
same instant. That holds as many statement rows as any pairing can. A
nearest-first pairing does not: at the edge of the synced period it can
give a synced row to the nearer of two statement rows and strand the
other one's only match, so a row the bank already synced goes in twice.
Neither does putting every timed row first: a timed row at 23:59:30 can
take the synced 23:59:00 row that a date-only row of that day needed,
although a synced 00:00:20 row the next day was in the timed row's reach
too. When only one of two statement rows can be held, the earliest row in
reach claims, and the later one goes in and counts toward the balance.
That is correct, not a tie-break: the sync is complete up to its newest
synced row, so a statement row before it with no synced twin cannot be a
real extra; the earlier row is the synced row's twin, and the later one
is a real purchase after the disconnect. The sweep builds no pair list:
each amount's synced times stay sorted, and a linear scan finds the first
one in reach (taking it out of the list is linear anyway).
`importParsedStatement` hands
`ParsedTransaction.timeReading` to `importRows` unchanged; the repository
converts its seconds itself. A row
whose clock is coarser than a second carries `ParsedTransaction.timeReading`:
- `{ kind: 'minute' }` (Sensebank, the `HH:MM` column-mapping presets):
  the distance runs from any second of that minute, so a floored `09:00`
  row is not pushed behind a `09:01` row for a synced row at `09:00:40`.
- `{ kind: 'day', fromSeconds, untilSeconds }` (a date-only
  column-mapping cell, stored at noon; `readDateWithFormat` in
  `date-formats.ts` reads the bounds from local midnight to the next one
  in the mapping's zone, 23 or 25 hours on a summer-time switch day): it
  is held only by a synced row of the same amount on that same local day,
  with no ±60 s widening. Its reach ends at local midnight, so it claims
  before a timed row whose reach runs past it, and after one whose reach
  ends sooner; only on an exact tie does the timed row, which places the
  same purchase more precisely, claim first. Two equal date-only rows on
  one day against one synced row drop only one. A day after the newest
  synced row has no synced row of its own, so its rows always go in.
Rows an earlier build already imported over synced ones stay, and so do
the ones a later import writes where the sync cannot match them (below); no
migration removes them.

**The sync adopts its import twin after a reconnect.** The reverse
direction of `dropRowsHeldBySync`: a statement imported over a disconnect
writes `import` rows, and the reconnect sync fetches the same purchases under
keys no import row holds. `transactionsRepo.addManyDedup` (the sync's insert
path, never `importRows`) lets each NEW input (a key not stored yet)
adopt a stored `import` row of the same holding and signed amount dated within
±60 s of the input's time (inclusive), one to one, earliest unclaimed row in
reach first, inputs claiming in (time, external id) order
(`pairSyncInputsWithImportRows`, `src/transactions/sync-adoption/`). One
UPDATE by the import row's id writes the bank-owned columns, `source` and
`external_id` onto it: the row keeps its id, its category and comment (a
missing one is filled from the sync) and every structural column, including a
loan link and an exchange pair with its marker. The adopted input is not
inserted and not counted, no `holdings` row is written (the sync overwrites the
stored balance from the bank), and the row is bank-owned from then on, so the
ledger keeps one row per purchase and no balance moves. The marker stays only
while the leg it names lives: a delete that keeps the adopted row clears the
marker in the same write only when that leg goes with it (the manual leg of the
same pair deleted, or the holding the marker names), so the purchase counts as
spending again. A marker naming something else stays: a deposit source leg
Converted again keeps `deposit` while the dollar leg is deleted, and the deposit
still holds the contribution (`kiko-domain`, "A bank-owned (synced) partner is
kept"). A manual twin is not
adopted: the user deletes that duplicate. A later import of the same file finds
the adopted row as a synced row and holds its rows.
RESIDUAL, left doubled: the adoption sees only the stored time, so an import
row from a date-only file (stored at local noon), a minute-clock row whose bank
stamp is more than 60 s past its floored minute, and a legacy row stored at
Kyiv noon for a time near midnight are never adopted; a pending file amount
against a settled tip is not equal either. The user deletes the import
duplicate, which takes its amount back until the next sync overwrites the
balance. OPEN ITEM, not built: a clock-reach column on import rows (and a
migration) would let the adoption mirror `clockRangeOf` for those.

## Dedup

Every studied format ships with no bank-issued per-row id, so
`mapping.ts`'s `computeDedupKey(holdingId, transaction,
occurrenceIndex)` derives a deterministic key from `(holdingId, time,
amount, normalized-description)` — `computeDedupKeyBase` — with
`occurrenceIndex` (the Nth time that exact tuple has been seen in this
parse) appended only when non-zero, joined by `␟` (U+241F), so the
common unique case's key stays stable. The separator is INJECTIVE on
purpose: `normalizeTransactionName` is JS-only (never in SQL), so SQL
alone cannot tell an occurrence suffix from a description that itself
ends in a digit — a plain-space join let occurrence 1 of "Top up"
collide with occurrence 0 of "Top up 1" (both produced the literal
string "... top up 1"); `␟` can never appear in a real description.
`mapParsedTransaction` writes rows with `source: 'import'` and this
key as `externalId` (or the format's own `externalId` when one is
present), and `importParsedStatement` hands the whole batch to
`transactionsRepo.importRows` in one call — see "Detect → import
pipeline" above; `addManyDedup` is the separate, still-live
dedup-write path every sync route uses instead. A key an old build
already wrote with the plain-space join is upgraded once, in place:
`upgrade-dedup-key.ts`'s pure `upgradeLegacyDedupKey(row)` recomputes
`computeDedupKeyBase` from a STORED row and rewrites an exact
`base + ' ' + digits` match to `base + '␟' + digits`, leaving anything
else (an edited description, a bank-issued id) untouched.
`upgrade-stored-dedup-keys.ts`'s `upgradeStoredDedupKeys` is the launch
step `MigrationsGate` runs it under — see `kiko-architecture`'s
"Storage" section for the migration/gate mechanism and "Data transfer"
for the restore-side mirror. `rezone-import-times/`'s
`rezoneImportTimes` runs right after it (also from
`importParsedStatement`, before any import): it rewrites a stored
import row's `time` from the legacy wall-clock-as-UTC convention to a
real instant, and the dedup key's time token along with it
(`rezoneDedupKey`) — see "Column mapping" below for the zone reading
itself.

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

Every dedicated bank format (`parse-date-time.ts`'s
`parseDateTimeSeconds`, Sensebank's own parse) reads its raw wall clock
as Europe/Kyiv local time, through `@kiko/dates`'s hand-rolled
`kyivWallClockToUtcMilliseconds`. Column mapping (`date-formats.ts`'s
`partsToSeconds`) reads it in the mapping's own source zone
(`ColumnMapping.timeZone`, see "Source time zone" below), through
`zoneWallClockToUtcMilliseconds`; a mapping with no zone reads Kyiv. All
of them go through ONE hand-rolled zone rule (`@kiko/dates`'s
`zone-wall-clock.ts`: a `ZoneRule` is a standard offset plus, optionally,
the EU summer-time rule — last Sunday of March/October, both switches at
01:00 UTC; Kyiv is `KYIV_ZONE_RULE`), never `Intl`, since Hermes'
timeZone support is unverified on device and Jest runs Node's own ICU.
Never the device's own zone: the instant feeds the dedup key
(`computeDedupKeyBase`), so a device-zone reading would give the same
file a different key once the phone changes zone, and an overlapping
re-import would duplicate every row. One rule covers both the stored
`time` and the key, since the key's time token IS the stored time:
`upgradeLegacyDedupKey` recomputes the key base from the stored row, and
`rezoneDedupKey` rewrites only the time token, in step with `time`. A
real spreadsheet `Date` cell is read off its own UTC parts
(`table-rows.ts`'s `formatUtcDateTime`) into `'YYYY-MM-DD HH:MM:SS'`
before parsing — those UTC digits ARE the cell's own wall clock, so a
mapping pointed at an Excel date column behaves exactly like one pointed
at a text date column. An XLSX number cell is used as-is (no
reformatting) — only a `Date` cell gets this wall-clock conversion. Only
DATE-ONLY input reads as noon in the source zone, so the same calendar
day shows on a device at most 12 hours behind, and less than 12 hours
ahead of, that zone (for Kyiv, UTC-9 to UTC+13:45 all year): a date-only preset (`date-formats.ts`'s `dateOnlyParts`), and
a spreadsheet `Date` cell with no time part (exact UTC midnight —
`formatUtcDateTime` writes it as plain `'YYYY-MM-DD'`, the one step that
still knows the value was a date cell, so the raw preview shows the date
alone, and the `YYYY-MM-DD HH:MM:SS` preset accepts that date-only value
and reads it as noon). Input with a real time — every named format,
every timed preset — keeps an exact `00:00:00` at midnight: as noon it
would sort after a later row on the same day and pick the wrong row as
Monobank's newest (closing-balance) row. A legacy stored row keeps the
noon reading on rezone (`noonIfMidnight`), since it records no format.

**A real `00:00:00` row never duplicates.** An older build read a real
Kyiv `00:00:00` bank time as a date-only noon, and a legacy rezone still
does, so the ledger can hold that row at Kyiv noon under a noon-time key
while a fresh import keys it at midnight. `mapping.ts`'s
`noonAliasDedupKey` gives every row whose Kyiv wall clock is exactly
`00:00:00` (and that has no bank-issued id) its Kyiv-noon key, with the
same occurrence index; `importParsedStatement` passes it to
`transactionsRepo.importRows` as the row's `aliasExternalId`, and
`importRows` drops every row whose alias a stored row of the same
`source` already holds, before the dedup partition and the upsert. That
stored row IS the row: nothing is inserted, nothing is added to the
balance, and it keeps its own 12:00 time and key. The closing-balance
path counts that stored row by the incoming row's real time: a stored
noon row whose real `00:00:00` is at or before the closing as-of is not
part of the post-closing net (`aliasedNetBeforeClosing` in
`transactions.repo.ts`). No migration; every
other key stays byte-identical. The rule is Kyiv-only on purpose: every
stored noon key was written in Kyiv time. So the alias applies only to a
statement read in Kyiv time — every named format, and a column mapping
whose source zone is Kyiv or absent. `applyColumnMapping` writes the
mapping's zone to `ParsedStatement.sourceTimeZone`, and
`importParsedStatement` gives no alias when that zone is not Kyiv: a
UTC-10 row at Kyiv `00:00:00` is a new row, even when a stored row sits
at that day's Kyiv noon.

Every bank-export date/time parser in
this project — column mapping's own presets, `parseDateTimeSeconds`,
and each dedicated format with its own date shape (Sensebank's
`DD.MM.YY HH:MM`) — additionally rejects a rollover: `Date.UTC` (and
the local-time `Date` constructor) silently NORMALIZES an out-of-range
day/month/hour/minute into a different, wrong instant instead of
rejecting it (`31.02.2026` rolling into 3 March, `25/01/2026` read
MM/DD-first rolling into 2028), so the zone rule validates the digits
independently of any zone (`@kiko/dates`'s `isRealCalendarInstant`)
before resolving them, and a mismatch there is treated exactly like a
shape mismatch: `undefined` (a recoverable row error) for column
mapping, a thrown `StatementParseError` for a dedicated format. The
preset set (`dateFormatIds`) includes both `MM/DD/YYYY` and
`DD/MM/YYYY` — read that file directly for the current member list
rather than trusting a count restated here.

### Source time zone

`source-time-zone.ts` lists the zones a mapping can pick
(`sourceTimeZoneIds`): Kyiv (the default), the EU summer-time zones
(Western Europe UTC+0/+1, Central Europe UTC+1/+2, Eastern Europe
UTC+2/+3 — the same switch instants as Kyiv), then every real UTC
offset in use, standard or summer (Newfoundland's summer `UTC-02:30`
too), from `UTC-12:00` to `UTC+14:00`, half-hour and 45-minute ones
included (`fixedOffsetZoneIds`), each read as a fixed offset with no
summer time. `zoneRuleFor` looks an id up in one
`Record<SourceTimeZoneId, ZoneRule>`; `sourceTimeZoneOrKyiv` reads a stored value,
falling back to Kyiv when the field is missing or unknown. The
column-mapping form shows it as a "Time zone" `SelectField` in the Dates
group (no required marker — it always has a value), and the zone is
saved with the mapping in `settings.statementMappings`
(`SavedColumnMapping`, no DB migration). Both the mapped time and its
dedup key are read in the chosen zone; with Kyiv, every key is
byte-identical to one from a saved mapping without the field.

A Semgrep rule (`kiko-no-date-utc-in-statement-import`,
`rules/semgrep-prewrite.yml`) forbids `Date.UTC(...)` and the
local-time `new Date($Y, $M, ...)` constructor anywhere in
`src/statement-import/**` (tests excluded) — every wall-clock read in
this feature goes through `kyivWallClockToUtcMilliseconds` or
`zoneWallClockToUtcMilliseconds`, never a raw constructor call. A second
rule (`kiko-no-device-zone-in-statement-import`, same file and scope)
bans every other device-zone read there; read its pattern list in
`rules/semgrep-prewrite.yml`, not here. Read stored digits
with `utcDigitsOf`, and an instant's wall clock in a zone with
`zoneWallClockOf`. The display formatters (`formatDate`, used by
`preview-stats.ts`) stay allowed — they render an instant, never
produce one. A `new Date(text)` whose argument TypeScript cannot type as
`string` (an untyped `TableCell`) is not caught. The rules match on
types: a `toLocaleString` on a `number` stays allowed, and a `Date` typed
`any` is not caught.

Tests that must prove a result does not depend on the device zone wrap
the call in `@kiko/test-support/device-zone-offset`'s
`withDeviceZoneOffset(offsetHours, run)`: it swaps the global `Date` for
a fixed-offset one, since `jest.config.js` pins Europe/Kyiv for the whole
process and a `process.env.TZ` assignment inside a test changes nothing.
It retargets ONLY the multi-argument local-time constructor; every other
device-zone read (local getters/setters, a string constructor,
`Date.parse`, `toLocale*`, `Intl`) still sees Kyiv — the Semgrep rule
above covers those. `run` must be synchronous: a promise-returning `run`
is a type error, since its awaited half would run after the real `Date`
is back. Read the file's header for the rest of its limits.

**Known limits:**
- The EU summer-time rule (last Sunday of March/October, 01:00 UTC) is
  valid from 1996 onward and has no expiry date coded in. A 2024 Rada
  bill to abolish Ukraine's DST has not been signed as of this writing;
  if it ever is, update `@kiko/dates`'s `kyiv-wall-clock.ts`
  (`KYIV_ZONE_RULE`) AND `zone-wall-clock.ts`: `ZoneRule` has no date
  field, so the effective-date guard needs a new field there. The
  column-mapping `eastern-europe` zone
  (`src/statement-import/column-mapping/source-time-zone.ts`) must keep
  the EU rule — it covers more than Ukraine.
- A key written by a device outside Kyiv's zone rules before every path
  read a fixed zone — a legacy row the old rezone read in that device's
  zone, or a column-mapped row imported there — carries device-zone
  seconds, so one overlapping re-import duplicates those rows once. The
  only user's device was in Kyiv, so no repair step ships (single-user
  rule).
- Changing the time zone of an existing saved mapping changes every key
  that mapping produces, so an overlapping re-import of a file already
  imported under the old zone duplicates its rows.
- A zone with a non-EU summer-time rule (North America, Chile, Australia,
  New Zealand, …) picked as a fixed offset reads 1 h off for the part of
  the year its summer time differs.
- The noon alias also matches a genuine stored `12:00:00` row with the
  same amount and description on the same Kyiv day: the `00:00:00` row
  is then taken to be that row and skipped.
- ProCredit business rows stamped `00:00:00` (a value date) show the
  previous calendar day on a device west of Kyiv.
- Unverified on device: a column-mapped row in Kyiv's autumn repeated hour
  (03:00-03:59) that a Kyiv device imported before column mapping read
  Kyiv time keeps its old key only if Hermes' local `Date` constructor
  picked the EARLIER instant, as `zoneOffsetMinutes` does.

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
time" rule Monobank CSV's own `resolveClosingBalance` uses, reading the cell with the mapping's own
`decimalSeparator` (`parseAmountCell`, same as every other amount cell
this mapping reads). `parseAmountCell` (`amount.ts`) validates the
OTHER separator's thousands-group shape, not just the groups after it —
the LEADING group must also be 1-3 digits with no leading zero (a lone
`'0'` is fine only when no group follows it) — so a cell whose decimal
separator was actually misread as the grouping character (the wrong
chip) parses to `NaN` instead of a value silently 100x too large or
malformed; `applyColumnMapping` turns that into a recoverable per-row
`'amount'` error, the same as any other unparseable cell. A tie on the
newest time is broken by FILE ORDER,
not "last one wins":
`pickClosingBalanceRow` reads the resolved rows' own first-vs-last time
to tell a newest-first file from an oldest-first one, then takes the
FIRST tied row in a newest-first file or the LAST in an oldest-first
one; when that orientation can't be determined (the file's first and
last resolved rows share one time), it falls back to the tied rows'
own balance cells — identical cells resolve to that value, genuinely
different cells yield no closing balance at all, rather than guess. A
missing or non-numeric cell on the chosen row also yields no closing
balance (never a `NaN` written to the ledger), and so does leaving the column unmapped. Unlike
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
compatible, no migration needed). `timeZone` works the same way (see
"Source time zone" above): a saved mapping without it reads Kyiv.

### The fixed currency follows the target holding

`importParsedStatement` skips every row whose currency is not the
target holding's, so in fixed-currency mode the default currency is the
SELECTED target's own (the account's first holding only before a target
is picked), and it follows a target change until the user picks a
currency by hand. A saved mapping does not restore its fixed currency: a
`bank:<bankId>` mapping is shared by every account of that bank, and the
currency belonged to the holding it was saved for. A saved currency
COLUMN is still restored.

## Saved mappings

A confirmed mapping is saved to `settings.statementMappings`
(`src/statement-import/column-mapping/saved-mapping.ts`, migration
`0034`) so a later import can pre-fill instead of asking the user to
remap every column. It's keyed by `mappingKeyFor`: a known catalog
bank uses `bank:<bankId>` (one shared mapping per bank, checked for an
EXACT fingerprint match against the file's actual header row before
being trusted as exact); any other account (bank id `other`, or no recognized bank id; `isSpecificBankId` decides) is keyed by
`header:<fingerprint>` instead and matched by scanning every `header:`
entry for a fingerprint hit. Either way, `findSavedMapping` only
PRE-FILLS the mapping form — a saved mapping never imports a file
without the user tapping Import.

The column-mapping screen's pre-fill is a ONE-SHOT effect, so it waits
until the file rows exist AND the account and settings queries have loaded
(`accountsLoading || settingsLoading` returns early) — both queries are
uncached, so on the auto-replace path the file can be read first, and an
early run settles on a guessed header row for good. Its twin,
`statement-import.screen.tsx`'s auto-replace check, makes the same wait
(`accountIsLoading || settingsIsLoading`).

## Entry points

Two entry points reach the column-mapping screen: "Import statement"
shows on every bank account no sync owns in account-detail (not gated
on a recognized `bankId`/format), and "Map columns manually" in
`statement-import.screen.tsx` offers a manual escape hatch from the
generic statement-import screen whenever a file was read at all
(including an unrecognized-format or bank-mismatch preview), routing
to `src/screens/column-mapping/column-mapping.screen.tsx`.

**`ownsFile` — which screen owns deleting the local copy.**
`ColumnMapping`'s route param `ownsFile` (`src/navigation/types/types.d.ts`,
`ColumnMapping.ownsFile` doc comment is the source of truth) is `true`
only when `ColumnMapping` was reached via `StatementImportScreen`'s
auto-`replace` (no `StatementImport` route left below it on the stack),
making `ColumnMapping` the file's sole owner, responsible for deleting
the local copy on unmount/cleanup. It is absent/falsy on the "Map
columns manually" PUSH entry point above, where `StatementImport`
stays mounted underneath and still owns the file — `ColumnMapping` must
NOT delete it out from under that still-reachable screen. A future
third entry point to `ColumnMapping` must set this flag correctly or it
silently either deletes a file another screen still needs, or leaks a
file nobody deletes.

**React Navigation 7: `navigate()` to a screen already on the stack
pushes a COPY rather than reusing the existing instance.** Use
`navigation.popTo(name, params, { merge: true })` instead whenever the
target route may already be on the stack (e.g. returning to
`AccountDetail` after column-mapping/statement-import finishes). See
`useImportResultSheet`'s doc comment
(`src/statement-import/use-import-result-sheet/`) for the canonical
explanation and the real-router proof
(`src/navigation/root-navigator/statement-import-return.navigator.test.tsx`); the same
rule is applied at `holding-form.screen.tsx`. Jest's shallow navigation mocks cannot catch
a `navigate`-vs-`popTo` regression — verify a fix here with a real
navigator test (as in the return-navigator test above) or a device
check, not a mocked-navigation unit test.

## Screen layout

Both `statement-import.screen.tsx` and `column-mapping.screen.tsx`
follow the same layout conventions as every other Kiko screen:

- **Import (and, on the statement-import screen, "Map columns
  manually") live in `Screen`'s own `footer` slot**, not inline in the
  scrolling body — the same footer slot every other screen's main
  action uses. `statement-import.screen.tsx` extracts its own
  `StatementImportFooter` (`statement-import-footer/`) for this
  (gated on `hasStats`/`hasInput`,
  `undefined` — not an always-defined element that renders `null` —
  when neither applies, since `Screen.footer` reserves clearance for
  ANY defined node); `column-mapping.screen.tsx` gates its own footer
  on `loadState.kind === 'ready'`.
- **The "import finished" sheet is `useImportResultSheet`**
  (`src/statement-import/use-import-result-sheet/`), shared by both
  screens: `useImportResultSheet({ navigation, accountId, accountName })`
  returns `{ sheetProps, show }`. A screen calls `show(await import…())`
  after the import and spreads `sheetProps` onto `ImportResultSheet`.
  The hook owns the visible flag, the never-cleared result, the
  Done-closes-first rule, and the one `popTo('AccountDetail', …)` (or
  `goBack()` while `accountName` is `undefined`, i.e. the account row has
  not loaded) on `onClosed`, at most once. Each screen reads the account
  name at render (`accountRows.at(0)?.name`, `account?.name`) and passes
  it in: never re-derive the sheet state or the navigation in a screen.
  The first-invalid-field scroll on a blocked Import is
  `useScrollToField()` (kiko-design-system), not hand-rolled geometry.
- **"Choose a holding" is a labeled SELECT FIELD, not a Button.**
  `src/design-system/components/target-holding-field/` wraps the
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
- **`ExampleTransaction`** (`src/design-system/components/example-transaction/`)
  is the ONE shared "first parsed row" preview, rendered
  under the summary table on both screens from `PreviewStats.firstTransaction`
  (the first `ParsedTransaction` in ON-FILE order, not chronological order
  — `previewStats` sets it via `parsed.transactions.at(0)`, optional
  since an existing `PreviewStats` object literal predates the field). It
  renders through the shared `TransactionCard`
  (`src/design-system/components/transaction-card/`) — the SAME
  presentational card Home's own `TransactionRow` uses, extracted out of
  that component, NOT a rebuilt card wrapping the base `Card` primitive
  (a rebuilt card risks showing the date as its title and
  the amount with no income color). This
  is NOT pixel-identical to a real Home row, though: a preview
  row has no real transaction id / account / holding-type row to read, so
  its footer content differs from Home's own `"<account> · <category>"` +
  time (see below), by design.
  The category comes from the row's own `mcc` via `categoryForMcc` (the
  same key `mapParsedTransaction` writes), resolved through the live
  categories table exactly as Home resolves a real row's category
  (`ExampleTransaction` queries `categoriesRepo`/`settingsRepo` itself),
  and `TransactionCard` always renders its amount with `MoneyText`'s
  `"transaction"` context (not a caller-configurable prop, since every
  consumer wants exactly that), so an
  income preview row shows the same icon and income (green) color a Home
  row would. The title resolves through the SAME `transactionRowDescription`
  Home uses — an empty mapped description falls back
  to the income/expense default label (fed the chosen target holding's
  name, via each caller's own `holdingName` prop, `undefined` before a
  holding is chosen) instead of rendering blank; `exchangeCounterpartHoldingId`
  is always `null` here (an import never creates an exchange-marked row).
  The footer shows the category title and the row's own date
  (`formatDate`) via `TransactionCard`'s existing optional `footerMeta`/
  `footerTrailing` props — the user's only per-row check that the chosen
  date format/column is right; Home is unaffected, since it already
  passes its own footer content through those same two props.
  `ExampleTransaction` owns its own `Divider`s above and below
  — a caller renders just `<ExampleTransaction ... />`, not a
  Divider/ExampleTransaction/Divider triple.
- **The raw preview grid** (`src/screens/column-mapping/raw-preview/`) gives each
  column a CONSISTENT width across every row
  (`raw-preview/column-widths.ts`'s `computeColumnWidths`, keyed off
  the longest cell text seen in that column across the previewed
  rows) instead of a flat per-cell minimum, takes more vertical
  breathing room (`gap={2}` between rows, up from `1`), keeps each row
  a real 44pt layout box (`ROW_MIN_HEIGHT`, `raw-preview.styles.ts`) —
  every row is a tap target (it sets the header row), and the rows sit
  too close together for `hitSlop` to reach 44pt without overlapping
  the next row, the one documented exception to `kiko-design-system`'s
  "hitSlop, never a bigger visual" touch-target rule — and paints the
  tapped header row with the theme's accent BLUE
  (`theme.colors.accent`) with `onAccent` cell text — replacing the
  former neutral `surfaceHigh` tint — matching the app's standard
  filled-accent selection vocabulary (ChipRow/SelectableRow),
  with its own cell text turned SEMIBOLD too (`fontWeight:
  '600'` — the app's selected-label weight everywhere else, not `'700'`)
  so the
  selected row reads as distinct even without color.
  "Tap the row with the column names" (`columnMapping.rawPreview`)
  renders at the `heading` type step instead of a muted `body`/
  `textSecondary` caption, so it reads clearly above the grid, and
  doubles as this section's own heading. The grid STARTS AT the header
  row (guessed or tapped; row 0 before one is known) and shows
  `PREVIEW_ROW_COUNT` (5) rows from there. A "Show all" toggle below the
  grid (the pie legend's link look: caption `tone="accent"` + chevron,
  reusing the `components.pieChart.showAll`/`showLess` keys, a 44pt tap
  target via vertical `hitSlop`) expands to every row
  `guessHeaderRowIndex` scans (`HEADER_SCAN_ROW_COUNT`, 10, exported from
  `table-rows.ts` so the two never drift) — never fewer than the
  collapsed window — INCLUDING the rows above the header, so the user can
  tap another row to correct a wrong guess (Sensebank's real header is
  row index 5; under UTF-8 the guess lands on row 8). "Show less"
  collapses back to the 5-row window from the header. The toggle renders
  only when expanding reveals a row the collapsed window hides; a tap in
  either mode selects the tapped row's own file index as the header. The
  grid shows at most `PREVIEW_COLUMN_COUNT` (5) columns per row — a wide export
  (multi-card PrivatBank, say) no longer scrolls dozens of columns
  before the user has even picked a header row; every
  `ColumnSelectField`'s own option list is unaffected, since that is
  derived from the FULL header row in `column-mapping.screen.tsx`, not
  from this capped preview.
- **Only the amount-mode and currency-mode toggles are the shared
  `SegmentedControl`** (`src/design-system/components/segmented-control/`)
  — an iOS `UISegmentedControl` per the HIG (see `kiko-design-system`'s
  own `SegmentedControl` entry for the full HIG citation, contrast fix,
  and accessibility details). `AmountFields` and `CurrencyFields` pass
  their own `accessibilityLabel` (the section heading text,
  `columnMapping.sectionAmount`/`sectionCurrency`), a REQUIRED prop.
  **ENCODING, DELIMITER, and DECIMAL SEPARATOR are all `ChipRow`**
  (`src/design-system/components/chip-row/`), per
  `kiko-design-system`'s tabs-vs-chips rule: none of the three changes
  which fields the screen shows — picking a value just re-parses the
  SAME preview with the SAME fields visible — while amount-mode/
  currency-mode DO change the visible fields. Never move
  encoding/decimal-separator to `SegmentedControl` as a DEFAULT the
  user did not ask for — tabs are ONLY for amount and currency modes.
  All three keep `ChipRow`'s approved compact chip look (34pt visible,
  44pt tap target via `hitSlop` — see `kiko-design-system`'s `ChipRow`
  entry); never grow a chip's visible size to meet the tap-target floor.
  Each `ChipRow` composes its own visible
  `FieldLabel` above it (`label` prop) since encoding/delimiter/decimal-
  separator sit inside a shared "File Format" section alongside each
  other, unlike the amount/currency sections where the section heading
  itself is the only label needed.
- **Every section shows its own heading, at ONE uniform spacing, on
  BOTH screens**: the screen's former
  in-body title (duplicating the native stack header's own `title:
  t('columnMapping.title')`, `accounts.stack.tsx`) is REMOVED;
  every section — raw preview, file format, dates, amount columns,
  currency, additional details (description/counterparty/balance), and
  result — shows its own `heading`-step `Text` as the PLAIN
  FIRST CHILD of its section's own `gap={3}` Box — no wrapper `Box` and
  no `marginBottom` style of its own. Do NOT give a heading an explicit
  `marginBottom: spacing(3)` INSIDE a `gap={3}` parent — Yoga adds a
  child's own margin ON TOP OF the parent's `gap`, same as CSS flexbox,
  so the two stack rather than dedupe, breaking the uniform spacing.
  `column-mapping-form.styles.ts`
  (`column-mapping-form/`) has no `sectionHeading` style at
  all. `MappingResult` renders its
  own `columnMapping.result` heading UNCONDITIONALLY, in BOTH the
  `stats === undefined` and `stats !== undefined` branches, passing NO
  `title` to `SummaryTable` in the complete branch — `SummaryTable`'s own
  `title` row sits in a `gap={1}` Box (4pt below it), which is not the
  same spacing as the plain first-child heading, so passing `title`
  there would make the heading jump position the
  moment the last required column got mapped. The statement-import screen's
  `StatementPreviewBlock` (`statement-preview-block/`) follows the SAME rule: it renders
  its own `<Text variant="heading">{stats.displayName}</Text>` as the
  plain first child of its own `gap={3}` `previewBlock` Box, passing NO
  `title` to ITS `SummaryTable` either, for the same reason. `SummaryTable` itself
  keeps its `title` prop optional, simply
  unused by both these call sites.
- **Fields are grouped with the shared `Divider`** between: (a)
  encoding/separators, (b) dates, (c) amounts/currency, (d)
  description/counterparty/balance (moved to the BOTTOM, in their own
  group, below amounts/currency — description used to sit between the
  date and amount groups), (e) result.
- **The target-holding picker shows each holding's own icon**
  (`target-holding-sheet.component.tsx`'s `SelectableRow` rows and
  `target-holding-field.component.tsx`'s `FieldTrigger`), the same
  `icon ?? defaultHoldingSymbol(holding)` / `resolveEntityColor` pair
  `transaction-form.screen.tsx`'s exchange `HoldingSelectField` resolves
  — `useTargetHoldingOptions` (shared by both statement-import screens)
  now resolves `icon`/`color` onto every `TargetHoldingOption` it
  returns.
- **`useTargetHoldingOptions` returns `{ options, isLoading }`**, not a
  bare list (kiko-architecture's useLiveQuery consumer rule: an empty
  `options` while either its holdings or its accounts query is still on
  its first load is not "no holdings"). Both call sites
  (`statement-import.screen.tsx`, `column-mapping.screen.tsx`) forward
  `isLoading` straight to `TargetHoldingField`'s `disabled` prop, so the
  picker cannot be opened onto an incomplete list while it is still
  loading.
- **Required fields show the red asterisk marker** (`FieldLabel`'s
  `required` prop, forwarded through `ColumnSelectField` and
  `FieldTrigger`) — date, date format, amount/debit/credit column(s),
  currency column (when in column mode), description, and the target
  holding field are marked required;
  counterparty stays unmarked (optional), and
  `columnMapping.counterpartyColumn` no longer carries an
  "(optional)"/"(необов'язково)" suffix — the absent marker IS the
  optional signal now, matching every other optional field.
