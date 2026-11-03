# Category automation design (1.4)

Track: 1.4-category-automation. Base: 57130e23c. Read from code; the app was not run. Every file:line
below holds on this base only: re-grep the named symbol on the actual base before building on it.
Counts of files, cases and call sites are floors; the developer measures.

Product purpose: Kiko answers "how much money do I have now". A category changes which slice a row
sits in. It never changes a balance or net worth (section 5.3). Nothing here budgets or plans.

## 1. Claim check

Claims of `memory/refs/category-automation-ideas-2026-11-02.md`, read at d7cd40fa1.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | The MCC map has 38 codes | True | `MCC_CATEGORIES`, `src/monobank/mcc-category/mcc-category.ts:51-61` (5+3+7+8+3+4+4+1+3) |
| 2 | Every other code goes to `other` | True for a code; a statement row with NO code gets NULL, not `other` | `categoryForMcc` `mcc-category.ts:69`; `mapParsedTransaction` `src/statement-import/mapping/mapping.ts:118` |
| 3 | Five matcher kinds: nameIs, nameStartsWith, amount, direction, time | True | `CategoryRuleMatcher`, `src/categories/category-rules/category-rules.d.ts:9-14` |
| 4 | All conditions must match | True | `matchesRule`, `prepare-rules.ts:188-189` |
| 5 | "Apply" adds a rule for the name | True, and more: it also rewrites every eligible same-name row and frees the source row of its hand flag. The sheet shows no count | `applyNameRule` `category-rules.repo.ts:488-517`, `nameIs` at `:494`; `giveSourceRowCategory` `:394-397`; `applyCategoryMessage` `src/i18n/locales/en.ts:625` |
| 6 | Hand-set rows carry `categorySetByHand` | True, with holes: Apply clears it on the source row; every row older than migration 0056 holds 0 whatever the user picked | `schema.ts:146`; `category-rules.repo.ts:396`; `drizzle/migrations/0056_add_category_rules.sql:26` |
| 7 | `normalizeTransactionName` fixes only unicode form, spaces, case | True | `src/transactions/normalize-name/normalize-name.ts:8-9` |
| 8 | "ATB 0212" and "ATB 0340" stay different names | True by the code. The repo itself holds only one store-number sample, "Silpo Market 12"; "ATB 0212" is not in any fixture | section 4 |
| 9 | An older build reads a new matcher as unreadable and that rule never matches | True of the parser; **false as a statement about the shipped builds**. v1.2.0 and v1.1.0 refuse the file by its version before any rule is read. Only a build that reads export version 5 reaches the parser: `release-1.3` | section 3.4.5 |
| 10 | Old rows keep their category unless also rewritten | True: the upsert never writes `category` for a row no rule won | `BANK_OWNED_TRANSACTION_COLUMNS` `transactions.repo.ts:1392`; `ruleWonTransactionSet` `:1439-1448` |
| 11 | Monobank rows have an MCC; most CSV rows may not | Refined: the sync, `monobank-csv` and `sensebank-csv` set it; `privatbank-xlsx` and the three business formats do not | `sync.ts:257`; `formats/monobank-csv/monobank-csv.format.ts:83`; `formats/sensebank-csv/sensebank-csv.format.ts:174`; `formats/privatbank-xlsx/privatbank-xlsx.format.ts:79-82` |
| 12 | A device count decides between items 1 and 5 | Void: item 5 is out of scope by ruling | section 3.1.5 |
| 13 | Review list risk "Low" | Understated: a name rule also moves same-name rows that are NOT in `other`, so the list's count and the write can differ | `planRuleRewrite` has no `other` filter, `plan-rule-rewrite.ts:41-48`; section 3.2.4 |
| 14 | "Rent follows an IBAN" | Only for rows that hold one: Monobank sync transfers and a mapped column of a CSV. Monobank CSV and PrivatBank XLSX rows hold none | `schema.ts:160-165`; `apply-column-mapping.ts:152` |
| 15 | Old rows' raw MCC is available for a back-fill (implied) | True: a stored column since the first migration; null on rows saved before the code was persisted | `schema.ts:149`; `drizzle/migrations/0000_aromatic_carmella_unuscione.sql:47`; `transfer-exclusion.ts:4-8` |

## 2. Scope

In: B1 more MCC codes and a seeded Travel category (ruling Q2, section 3.1.6). B2 review list of names in `other`; one tap assigns a category and adds the
rule. B3 better "Apply": offer "starts with ATB" when the name ends in a store number. B4 new rule
conditions: name contains, MCC, account, counterparty IBAN. B5 suggestions from the user's history.

Out, not to be added: the built-in merchant list, the day-of-month condition, on-device AI, anything
about budgets or planning.

Not built, could be added later: "Keep in Other" on a review line.

Open run-log gaps: none covers this work; this track closes none and leaves all open, the nearest being
`20261015T1035-kiko-release-1-2/3` (the rule-form barrel export for a demo test).

## 3. Design per item

### 3.0 Shared definitions

Both live in `src/categories/category-rules/`, beside `isRewriteEligible`.

**`hasNoRealCategory(row, knownCategoryKeys): boolean`**, one definition for B1, B2 and B5. True when
the stored `category` is:
- null or empty, or
- `other` compared by `categoryKeyOf` (the literal `categoryForMcc` writes, `mcc-category.ts:69`), or
- a key not in `knownCategoryKeys` (an orphan: it already folds into the default,
  `category-display.ts:64-69`).

Everything else is a real category, including `settings.defaultCategoryKey` when the user set it to
something else: a row moved there by a category delete cannot be told from a row picked there.

A row with no real category is open to an automatic write only when all of these hold too:
- `isRewriteEligible(row)` (not hand-set, not balance-setting, not a split change), and
- no rule wins it (`winningRule` is undefined): a rule that targets `other` is a deliberate result.

Accepted: a row in `other` won by a rule that targets ANOTHER category (the user saved that rule as "New
transactions only") leaves B2 and the back-fill and never appears on the list. No wrong write comes of it:
the user chose to leave old rows out of that rule, and "Apply to existing" on the rule still moves them.

### 3.1 B1 More MCC codes

#### 3.1.1 Source and what was not verified

Source read: `github.com/greggles/mcc-codes`, `mcc_codes.csv`, 981 rows, fetched raw on 2026-11-03.
Each description below was read from that file.

Not verified: ISO 18245, the Visa Merchant Data Standards Manual and the Mastercard Quick Reference
Booklet (not read); which codes Monobank really sends (no sample beyond the fixtures); how an acquirer
assigned a code to a given merchant. The file does not list 6536-6538 or 7833, so they are not added.
The developer re-checks each code against the file. One exception, by ruling Q2: the hotel range
3501-3999 is mapped whole, though the file lists 292 of its 499 codes (207 are unlisted, mostly
3791-3999). All 292 listed rows name a lodging brand or carry the IRS text "Hotels/Motels/Inns/Resorts".

#### 3.1.2 Codes

Additive only: none of the 38 changes its category (5912 pharmacy stays in `shopping`). A pin holds
all 38 as they are. Measured against `MCC_CATEGORIES`: no original code is an airline, airport, hotel
or travel agency code, so ruling Q2 does not touch the pin. Every target is a seeded key: the existing
ones (`src/db/__fixtures__/seeded-categories.ts`) and the new `travel` (section 3.1.6).

| Category | Added codes |
|---|---|
| groceries | 5300, 5441, 5921 |
| dining | 5811 |
| transport | 4112, 4789, 5532, 5533, 5983, 7512, 7531, 7534, 7535, 7538, 7542, 7549; range 3351-3441 (car rental brands, 91 rows in the source) |
| travel | 4511, 4582, 4722, 7011; ranges 3000-3299 (airline brands, 300 rows), 3501-3999 (hotel brands, 499 codes, 292 rows) |
| shopping | 4812, 5200, 5211, 5231, 5251, 5261, 5310, 5311, 5331, 5399, 5621, 5631, 5641, 5655, 5661, 5699, 5712, 5713, 5714, 5719, 5722, 5733, 5734, 5735, 5931, 5940, 5942, 5943, 5947, 5948, 5949, 5964, 5965, 5969, 5992, 5995, 5999 |
| utilities | 4816 |
| entertainment | 5815, 5816, 5817, 5818, 7829, 7841, 7911, 7929, 7932, 7933, 7941, 7991, 7992, 7993, 7994, 7998, 7999 |
| health | 4119, 5975, 5976, 7298, 8031, 8041, 8043, 8049, 8050, 8071, 8099 |

That is 86 single codes plus 890 in ranges: 976 distinct added codes, 769 of them listed in the source.
Measured on `mcc_codes.csv`: all 86 singles present, no overlap with the 38, none in
`ALWAYS_EXCLUDED_MCCS` or `OWN_ACCOUNT_TRANSFER_MCC`.

| Code | was: earlier draft of this table | Now, ruling Q2 |
|---|---|---|
| 7011, 3501-3999 hotels; 4722 travel agencies | `other` | `travel` |
| 3000-3299, 4511 airlines; 4582 airports | `transport` | `travel` |
| 3351-3441, 7512 car rental; 4112, 4789 rail and other land transport | `transport` | `transport` |

Left in `other`; B2 clears them:
- insurance 6300, education 8211, 8220, 8299, charity 8398, government 9311, 9399
- advertising and business 7311, 7399; couriers 4215; beauty and laundry 7230, 7211, 7216
- car dealers 5511, 5571; betting 7995; tobacco 5993
- cruise lines 4411, truck and motor home rental 7513, 7519: named in no ruling
- 3300-3350 and 3442-3500: outside the ruled ranges and not in the source file

Never mapped here: 6010 and 6051 (cash and quasi-cash). A code placed in `cash` or `transfers` without
joining `ALWAYS_EXCLUDED_MCCS` would still count as spending (`transfer-exclusion.ts:41`). What counts
as spending is not this track's change.

#### 3.1.3 Which old rows are `other` by accident

The raw code is on the row (`schema.ts:149`); a re-sync refreshes it, never `category`
(`transactions.repo.ts:1392-1399`). `other` can be deliberate four ways:
1. A live rule that targets `other`: detected by `winningRule`.
2. A hand pick: flagged, detected by `isRewriteEligible`.
3. A pick before 0056: flag 0, **cannot be told apart** (`0056_add_category_rules.sql:26`).
4. A rule since deleted or narrowed, or a category delete that folded rows into `other` and cleared the
   flag (`categories.repo.ts:109-112`): cannot be told apart in general.

A code in the OLD map never produced `other`, so such a row was moved there by something. The back-fill
therefore reads the **added codes only**. Residual, accepted by ruling Q1: a row with an added code
under case 3 or 4 moves to the new category.

Structural rows, left out by `isRewriteEligible`: `categorySetByHand`, `setsBalance`, `changeGroupId`. An
exchange leg is NOT structural, by the existing ruling (`plan-rule-rewrite.ts:6-14`): statistics exclude a
leg by its marker whatever its category.

#### 3.1.4 Back-fill design

`planMccBackfill(prepared, rows, knownCategoryKeys): { id, category }[]`, pure, in
`plan-rule-rewrite.ts`. A row is planned when ALL hold:
- its `mcc` is in `ADDED_MCC_CODES` (derived from the same lists as the map, so they cannot differ)
- `hasNoRealCategory(row, knownCategoryKeys)`
- `isRewriteEligible(row)`
- `winningRule(prepared, subjectOfStoredRow(visible row))` is undefined
- the target `categoryForMcc(mcc)` is in `knownCategoryKeys`: a category the user deleted is never
  brought back, and the row stays for B2

Write path: `backfillMccCategories()` in `src/categories/category-rules-repo/`, copying the shape of
`recostStoredLots` (`src/holdings/lot-recost/lot-recost.ts:60-97`):
- Reads the flag, then one `write()`: read the flag again, read rows `WHERE mcc IN (added) AND
  (category IS NULL OR lower(category) = 'other' OR orphan)`, plan, update in `IN_CLAUSE_CHUNK_SIZE`
  chunks by `category` group with `categorySetByHand = 0` in the WHERE, set the flag, commit.
- **Crash safety:** rows and mark commit together; a crash rolls back and the next open repeats.
- **Once only:** `settings.mccCategoriesBackfilled` (section 7). A mark is needed: a later run would
  overwrite a row that later became `other` by a deleted rule or a category delete.
- Wired as `useMccBackfill()` in `App.tsx` beside `useLotRecost` (`App.tsx:39`), and in `importData`
  right after `recostStoredLots` (`import-data.ts:235`): an older file restores with the mark unset.
- **Order on a restore:** Travel first, back-fill second. The back-fill plans a row only when its target
  is a known key, and `restoreDataSnapshot` (`import-data.ts:226`) commits the file's categories, Travel
  included (section 3.1.6), before `import-data.ts:235`. On a live device the migrations run before the
  first render, so `useMccBackfill` also finds it.
- Never rejects: `logOnFailure` with a fixed text, no name or IBAN in the log.
- The row keeps no hand flag and gets none: a hand flag also changes exchange-funding exclusion
  (`exchange-funding-match.ts:280`).

New rows get the new category at once through `categoryForMcc` (`sync.ts:263`, `mapping.ts:118`); a
rule still wins (`withCategoryRules`, `transactions.repo.ts:1518-1547`). `ExampleTransaction` follows
by itself.

Upgrade-world note for the plan: this adds owed state, so before a line "existing suites green
unchanged" the planner asks which seeds are 1.2-upgrade worlds (harness-workflow).

UI of the back-fill: none, no text beyond a What's New line. The Travel tile is visible UI: section 3.1.6.

#### 3.1.5 Does a count from the iPhone change the design?

No, so it is not asked. The back-fill touches only rows with an added code, whatever their share; B2
shows what is left. The question it once decided (item 1 against the merchant list) is closed by the
ruling. A per-code count could only add codes later, one safe additive edit.

#### 3.1.6 The seeded Travel category (ruling Q2)

**Precedent.** Yes: `drizzle/migrations/0039_seed_loan_interest_category.sql:8` added the eleventh
default after launch. It is a data-only migration with no `meta/NNNN_snapshot.json`
(`meta/` holds `0038_snapshot.json`, none for 0039), a journal entry and a `migrations.js` line. Travel
is the twelfth default and copies it.

How a seeded row is defined:
- Row: `categories` (`key`, `title`, `icon`, `color`, `sort_order`), the English seed text as `title`.
- Title: `resolveDefaultCategoryTitle` (`default-category-title.ts:45-46`) translates only a row whose
  stored title equals the seed text for its key in `DEFAULT_CATEGORY_SEED_TITLES` (`:8`). A renamed row
  shows verbatim. Travel adds `travel: 'Travel'` there and `categories.travel` in both catalogues.
- Icon: a system symbol name stored on the row. Every default is in `KIKO_CATEGORIES_ICONS`
  (`icon-pools.ts`, comment above the pool), so a user can pick it back.
- Color: seeded rows store a **literal dark-palette hex** in the column, not a token name (`0017` and
  `0039:8`; the restore mirror reads the token, `restore-snapshot.ts:355`). A stored hex passes through
  unchanged in both palettes: on the `1.4-light-scheme` tip `entityColorsDark` stays and
  `entity-tint.test.ts` pins "passes an unknown/custom stored hex through unchanged". So Travel stores
  one too. This is the one literal hex of the track; no UI code holds one.

```sql
INSERT OR IGNORE INTO `categories` (`key`, `title`, `icon`, `color`, `sort_order`) VALUES ('travel', 'Travel', 'airplane', '#40C8E0', (SELECT COALESCE(MAX(`sort_order`), -1) + 1 FROM `categories`));
```

| Field | Value | Why |
|---|---|---|
| Icon | `airplane` | In `sf-symbols-typescript`, in the pool at `icon-pools.ts`, so `__tests__/symbol-deployment-target.test.tsx` already proves it at the iOS 18.2 target; also in 1.3's pool. Not an iOS 27 symbol (memory rule `sf-symbols-ios27-availability`) |
| Color | `#40C8E0`, `entityColorsDark.teal` (`palette.ts:18`) | Free among the seeded hues: green, orange, blue, pink, red, khaki, white, gray, indigo are stored; `utilities` hashes to orange and `entertainment` to blue (`categoryColor`). `blue` is `transport`, so teal keeps them apart |
| Title | en `Travel`, uk `Подорожі` | Section 7 |

**Sort order.** `other` is not last today, so there is no such rule to keep: a fresh install holds
`other` at 9 and `loan_interest` at 10 (0002, 0039; `build-demo-snapshot.ts` mirrors it). Travel takes
`MAX + 1`: 11 on a default grid, after Loan interest. A device with a reordered grid gets it at the end
of the user's own order, and no other row's `sort_order` changes. The user drags it where they want it.

**Key collision.** A user's own category cannot hold `travel`: `categoriesRepo.create` writes `key = id()`
(`categories.repo.ts:49`), a v4 UUID (`src/db/id.ts:11`), as v1.1.0 did, and `updateTitle` never changes a
key. Only a hand-built file could hold it. If a row with that key exists, `INSERT OR IGNORE` leaves it
whole, and the restore mirror below returns the file's rows untouched: never overwritten, retitled or
recolored. A user's own category titled "Travel" keeps its UUID key and shows as a second tile with its own
rows; ruling Q2 accepts this duplicate. `resolveDefaultCategoryTitle` reads key and title together, so it
never translates that row.

**The restore trap.** `restoreDataSnapshot` replaces the whole table (`restore-snapshot.ts:862`), and
`withLoanInterestReseeded` (`:341`) adds its row whenever the file lacks it. Copied as is, that would bring
Travel back in a file where the user deleted it. What tells the files apart:

- `settings.mccCategoriesBackfilled` is `NOT NULL`, so every database of this build holds it, as `true` or
  `false`. `readDataSnapshot` selects the whole row (`read-snapshot.ts:46`), so every file of this build
  carries the key. A build before 1.4 has no such column in its schema, so its file cannot.
- Presence, never value, with `Object.hasOwn`: the precedent is `withLegacyDedupKeysUpgraded`
  (`restore-snapshot.ts:418`). No second column is needed: the two migrations ship together.
- Read from `snapshot.settings`, the file's own row, since the file decides this column
  (`TAKEN_FROM_FILE_ON_RESTORE`, `settings-columns.test.ts`; not in `KEPT_FROM_LIVE_ON_RESTORE`).
- Rejected: a migration count (the payload holds none: `exportedAt`, `appVersion`, `tables`, `secrets`,
  `payload.d.ts`); `appVersion` (a string compare inside a restore that today takes only `tables` and the
  version, `import-data.ts:226`, for no better answer).

`withTravelReseeded(categories, settings)`, in `restore-snapshot.ts` beside `withLoanInterestReseeded`,
chained after it at `:941` so an old file gets loan interest at max + 1 and Travel at max + 2, the order a
live device runs them. It adds the row only when the file holds a settings row, without the key, and no
`travel` row. Color through `entityColorsDark.teal`.

| File | Mark key in settings | `travel` row in file | Categories after restore | Back-fill after restore |
|---|---|---|---|---|
| Before 1.4 (1.3, 1.2, 1.1) | absent | absent | **Travel added** at max + 1 | Mark defaults false: runs. Hotel rows move to `travel` |
| 1.4, Travel kept | present | present | The file's row verbatim, edits kept | By the file's mark |
| 1.4, user deleted Travel | present | absent | **Stays deleted** | Mark true: none. Mark false: runs; `travel` is unknown, so the rows stay for B2 |
| 1.3 export of a restored 1.4 file, row kept | absent | present | The file's row verbatim, edits kept | Runs (1.3 dropped the mark) |
| 1.3 export of a restored 1.4 file, Travel deleted in 1.4 or 1.3 | absent | absent | Travel added. It cannot be told from a pre-1.4 file; accepted: one empty tile, no row moves onto it unless it has an added code and no real category | Runs |
| Hand-built, no settings row | none | absent | Not added, as `withLegacyDedupKeysUpgraded` leaves such a file alone. A real export always holds the row | Runs; `travel` is unknown, so the rows stay for B2 |

`loan_interest` keeps its own unconditional reseed; this track does not change it.

**`EXPORT_VERSION` stays 5, decided again with this trap in view.** A bump would tell a 1.3 file from a 1.4
file too, but 1.3 would then refuse every 1.4 file, and the key already tells them apart. A bump is for a
file an older build would misread (0059, 0062). A `travel` row is not that: to 1.3 it is one more category
(next paragraph). `VERSION_DECISIONS` gains two notes and `migrationCount` plus two, `version` 5:
- The seed: a row in `categories`, no new shape. An older build restores it as a category of its own, and
  this build adds the row to an older file, told by the absent mark key. No bump.
- The mark: a column inside the settings row. An older build drops the key and its later upgrade runs the
  back-fill; this build restores an older file with the default `false`, so it runs on it. No bump.

**Older build, read on `release-1.3` tip 918683db3, journal tail `0063_add_transaction_operation`.**

(a) A 1.4 file into 1.3. Nothing refuses: version 5 is readable (`envelope.ts:13,19`), `isExportPayload`
(`import-data.ts:115`) checks table shape only, `categories` has no check, and no column references it, so
`transactions.category = 'travel'` is plain text. The settings key is dropped, as every earlier added column
was. `travel` is not in 1.3's `DEFAULT_CATEGORY_SEED_TITLES` (`:8-24`), so `resolveDefaultCategoryTitle`
returns the stored title (`:50`): **the English "Travel", on a uk device too**, with its own defaults still
translated beside it. A renamed row shows its name. Icon `airplane` draws, it is in 1.3's pool
(`icon-pools.ts:100`), and the stored teal shows. Rows and rules on `travel` work as on a custom category.
New 1.3 rows with a hotel code get `other`, as 1.3's map says. The user can delete the tile; the delete folds
its rows as usual.

(b) Export from 1.3, restore into 1.4. The file has no mark key. Its `travel` row comes back verbatim and,
if still titled "Travel", shows as `Подорожі` on a uk device. If the row is gone, Travel is added (table
above). The back-fill runs and moves 1.3's rows with an added code that have no real category. An in-place
update from such a 1.3 database gives the same: `INSERT OR IGNORE` leaves the restored row.

Nothing here reverses a ruling. No older build is harmed.

**Readers.** Section 5.3, B2 and B5 need no code change: Travel is one more row of the live `categories`
read, so one more pie slice, trend line, filter chip, option in the B2 sheet and possible B5 suggestion.
`hasNoRealCategory` calls it real while it exists; after a delete a `travel` row is an orphan, folds to the
default as any deleted category does, and appears in B2.

**Demo data.** `build-demo-snapshot.ts` carries Travel at `sortOrder` 11 and the mark `true`, so the demo
files read as 1.4 files and the reviewer sees the tile. Regenerate `kiko-demo-en.kiko` and `kiko-demo-uk.kiko`
in the same commit as the migration (`e2e/screenshot/fixtures/README.md`, "Regenerating"). Demo rows hold
`mcc: null` and no row moves to Travel. `kiko-demo-en-1.1.kiko` stays frozen and gains Travel when restored.
Screenshots that show the Categories grid pick up the twelfth tile at the next refresh. The rows B3 and B5
need are in section 3.2.5.

**Suites that pin the seeded list.**

| Suite | Pins | Effect |
|---|---|---|
| `e2e/screenshot/fixtures/build-demo-snapshot.test.ts` | exact key list, loan interest color and order | Own new line and a sibling case |
| `e2e/screenshot/fixtures/generate-demo-kiko.test.ts` | GUARD diff of the files | Regenerate |
| `src/categories/repo/categories.repo.test.ts` | 0002's ten; 0039 | Unchanged; a sibling case for the seed |
| `src/i18n/default-category-title/default-category-title.test.ts` | each translated default | New case |
| `src/design-system/components/icon-picker-modal/icon-picker-modal.component.test.tsx` | each default's icon in the pool | New case |
| `src/data-transfer/snapshot/restore-snapshot.test.ts` | `insertedRows.categories` by `toEqual` | Unchanged: its `emptySnapshot` holds `settings: []`, so no Travel; new cases |
| `src/db/schema.category-overrides.test.ts`, `src/statistics/category-breakdown/category-breakdown.test.ts`, `src/screens/settings/categories/categories.screen.test.tsx`, `src/screens/home/home.screen.test.tsx` | `SEEDED_CATEGORIES`, 0002's ten | Unchanged: `TRAVEL_CATEGORY` is its own export, as `LOAN_INTEREST_CATEGORY` is |

A new seeded entity is a visible default: **the user confirms the tile, icon and color on the device.**

### 3.2 B2 Review list

#### 3.2.1 Entry point

Settings > Categories: a card above the grid in `src/screens/settings/categories/categories.screen.tsx`
opens a new `CategoryReview` route in `src/navigation/settings-stack/settings.stack.tsx`. Always
shown, with or without data.

Why here: `1.4-small` is rewriting `settings.screen.tsx` (its diff does not touch the categories
screen). `1.4-tables` adds its own Tables screen, not a Statistics view; the overlap is additive:
`src/navigation/types/types.d.ts`, `title-keys.ts`, `help-topics.ts`, `en.ts` and `uk.ts`. Merge conflict
surface: one added route each in `settings.stack.tsx` and `types.d.ts`; added keys in `en.ts` and
`uk.ts`. `1.4-light-scheme`: the new UI uses theme tokens and shared components only.

#### 3.2.2 Query and grouping

Two live reads, `['transactions', 'category_rules', 'categories']`, `paused` while the screen is not
visible (`useIsScreenVisible`, `statistics.screen.tsx:218-226`), never `cached` (they lead to a write,
kiko-architecture):
1. `reviewCandidateRowsQuery`: `candidateColumns` for rows with a stored non-blank description and
   `category IS NULL OR lower(category) = 'other' OR orphan`. SQL only narrows; the pure function
   decides, as the rewrite queries do (`category-rules.repo.ts:60-63`).
2. The evidence read for B5 (section 3.5).

`planReviewGroups(prepared, rows, knownCategoryKeys): ReviewGroup[]`, pure:
- Keeps a row when `hasNoRealCategory`, `isRewriteEligible`, no winning rule, no exchange marker
  (`exchangeCounterpartHoldingId`, `untrackedCounterpart`: statistics leave them out anyway).
- Groups by `merchantNameOf(description).key` (section 4). Language-dependent blank labels are out of
  the list because blank rows are out.
- `ReviewGroup`: `key`, the distinct names, `rowCount`, the rule the group offers.
- Rule offered: one distinct name gives `nameIs` on the FULL name; two or more give `nameStartsWith` on
  the group's `prefix`. The line says which ("Starts with ATB · 3 names").
- Spelling: one pick everywhere, the smallest tidied spelling by code unit. Names shown (the line and the
  confirm) and a `nameIs` text use the full tidied name, per normalized name: rows `ATB 0212`, `ATB 0340`
  list as those two, under `nameStartsWith "ATB"`; a group of only `ATB 0212` gets `nameIs "ATB 0212"`. A
  `nameIs "ATB"` there would move 0 rows. The cut prefix is `nameStartsWith` text and nothing else.
- Order: `rowCount` descending, then newest `time`, then `key`. Deterministic. Not by total: a group
  can mix currencies, and a sum across currencies would be a wrong number.

A group needs one rule to cover all of it. Its names share a normalized prefix by construction, so a
`nameStartsWith` rule always matches every listed row (property pin).

#### 3.2.3 Cost

B2 adds no index and no migration. No category index exists (`schema.ts:309-320`), so both reads scan the
table. Measured on a Mac with the `sqlite3` CLI 3.51 on a synthetic narrow table of 100,000 rows:
candidates `SCAN transactions`, 20,000 rows returned, 0.027 s; evidence `SCAN` plus `TEMP B-TREE FOR
GROUP BY`, 4,000 groups, 0.068 s. Not measured: an iPhone, or the encrypted real file with its wider
rows.

Statistics already reads every row on a live query (`listAllQuery`, `statistics.screen.tsx:266`), so
these scans are no new class of cost, and they run only while this screen is focused. The plan adds a
pin on the 50,000-row `rules-performance-fixture`. If it fails its bound, the fix is a partial index in
its own migration with an EXPLAIN QUERY PLAN test and a `kiko:reviewer` step, not a weaker bound.

#### 3.2.4 What one tap writes, count against rows

The line's control opens the category options; picking one is the tap.
1. Calls `categoryRulesRepo.previewNameRule({ text, kind, category })`, which returns
   `{ count, names }` from a private `rowsRewrittenBy`. `rowIdsRewrittenBy` returns ids only
   (`category-rules.repo.ts:294-298`), so it becomes a map over `rowsRewrittenBy`, and the preview and
   the write share one function.
2. If `count` equals `rowCount`, writes at once. Every listed row moves: the plan skips only a row already
   in the target (`plan-rule-rewrite.ts:44-46`), the options leave `other` out, and an orphan key cannot
   be picked.
3. Otherwise opens a confirm sheet: "Move N transactions" with up to five names plus "and M more".

Step 3 exists because `planRuleRewrite` moves every eligible row the rule wins, not only rows in
`other` (`plan-rule-rewrite.ts:41-48`). Examples: a prefix "ATB" also wins "ATB Market" and "ATBANK"
(`nameStartsWith` is a plain `startsWith`, `prepare-rules.ts:173`); a name with 12 rows in `other` and 3
rows MCC-sorted into `groceries` moves 15. A silent 15 under a promise of 12 would break the binding
constraint. A pin holds `listed rows ⊆ planned rows`, and `planned = listed rows` when no such row exists.

Write: `categoryRulesRepo.applyNameRule({ name: text, kind, category, sourceTransactionId: null })`,
extended with `kind` (section 3.3). Not `saveRule`, which refuses an existing matcher as a duplicate.
Rule and rewrite go in ONE `write()` and the plan is redone inside it, so a sync between preview and
write cannot make the rows wrong (existing contract, `category-rules.repo.ts:291-293`).

A hand-set row: not counted, not listed, not written (`isRewriteEligible` and the SQL guard
`category-rules.repo.ts:336`). This path sets no flag. A wrong tap: editing the rule offers "Apply to
existing", which moves those rows again. No undo control is added.

**A name that should stay in `other`:** the existing rule form can target `other`, and that rule removes
the line through `winningRule`. A line left alone stays on the list; accepted, with no badge or count that
nags.

#### 3.2.5 Live behaviour, empty state, Guideline 2.5.19

A sync while the screen is open refreshes the list. `write()` flushes reactive queries once per commit
(`src/db/client.ts:138-143`), so a mass rewrite is one fire. Loading is gated on `isLoading`, never on
`data.length === 0`.

Guideline 2.5.19: no flag, no condition on the entry card. With no data, or nothing left, the screen shows `EmptyState`
("Nothing to review", and what would appear here), so a reviewer on a clean install sees the card,
opens the screen and reads what it does. The Help topic `categoryRules` gains a step
(`en.ts:1127-1137`), and the Notes for Review describe the feature.

The demo files must show what the reviewer cannot make alone. Measured on both committed files at this base:
no name holds a store number, so the B3 button never appears, and 19 review groups hold no evidence, so the
B5 chip never appears. Task 2 adds store-number rows in `other` to `screenshot-seed.ts`; task 6 adds a merchant
with real-category rows and one `other` row. The rule demo's merchants stay separate. Both tasks regenerate
`kiko-demo-en.kiko` and `kiko-demo-uk.kiko` in the same commit, after task 1's regeneration. A track that
regenerates merges main first and regenerates on the merged builder. Another track, `1.4-tables` for one,
may also touch the demo; a conflict is resolved by regeneration, never by a hand-merge of a binary.

### 3.3 B3 Better "Apply"

#### 3.3.1 Which names

`merchantNameOf(name).prefix !== null` (section 4): the name ends in a store number and at least three
letters remain. Other names see today's sheet unchanged.

#### 3.3.2 Flow

The form conditions stay as they are (`offersCategoryNameRule`, `category-rule.ts:77-93`;
`resolveCategoryOverrideRequest`, `:111-122`). `CategoryOverrideSheet` keeps "Apply" (the exact name,
still first) and "Just for this one". A new secondary button appears only with a prefix:
`All starting with "ATB"`.

Tapping it never writes. It shows the confirm step: `previewNameRule` returns the count and up to five
names; the user reads "23 transactions: ATB 0212, ATB 0340, ATB Market, and 2 more" and confirms or
goes back. Only the confirm calls `applyNameRule` with `kind: 'nameStartsWith'`. Cancel leaves what
the form already saved. The source row follows the same `giveSourceRowCategory` as today.

#### 3.3.3 Semantics

- Case and spacing: `withNormalizedText` normalizes the rule, `subjectOfStoredRow` normalizes the row,
  so "ATB", "atb" and "ATB  0212" read alike (`prepare-rules.ts:58-65`, `rule-subject.ts:38`). Cyrillic
  lowercases through JS. Latin "ATB" does not match Cyrillic "АТБ" (section 4).
- No word boundary: the stored text is trimmed (`rule-draft.ts:60`, normalize trims again), so "ATB "
  cannot be stored and "atb" also wins "ATBANK". Hence the name list in the confirm. A boundary is not
  added: it would be a new matcher kind beyond the four in scope.
- A blank row's label is a name too (`rowIdsForNamedRule` reads blank pages); the preview shows it.
- Tie with an older one-matcher rule: the newer wins by `updatedAt` (`prepare-rules.ts:51-55`), and the
  rows it takes are in the count. A rule with more conditions still wins.

### 3.4 B4 New rule conditions

#### 3.4.1 Types

```ts
| { type: 'nameContains'; text: string }
| { type: 'mcc'; code: number }
| { type: 'account'; accountId: string }
| { type: 'counterIban'; iban: string }
```

**A new condition is always a new `type` string, never a new field on an existing type.** The parsers
copy known fields only (`parseNameMatcher`, `parse-rule-matchers.ts:26-29`), so an older build would
silently drop a new field and match MORE rows: the one outcome the all-or-nothing guard exists to stop.

`RuleSubject` gains `mcc: number | null`, `counterIban: string | null`, `accountId: string | null`.

#### 3.4.2 Data on the row and the feeds

| Condition | Row data | Row with no value |
|---|---|---|
| `nameContains` | the visible name, as `nameStartsWith` | a blank name matches no name matcher |
| `mcc` | `transactions.mcc` `schema.ts:149` | null: no match |
| `account` | none on the row: `transactions.holding_id` joined to `holdings.account_id` | a holding not found: no match |
| `counterIban` | `transactions.counter_iban` `schema.ts:165` | null: no match. Sources: Monobank sync transfers, a mapped CSV column |

No match on a missing value is the existing rule (`prepare-rules.ts:22-23`). A new condition never
widens a rule.

Every feed must supply the new fields (the same rule-reads as today):
- `subjectOfStoredRow`, `subjectOfDraft` (`rule-subject.ts:32-57`)
- `candidateColumns` (`category-rules.repo.ts:43-58`) and `RewriteCandidate`
- `giveSourceRowCategory`'s own select (`category-rules.repo.ts:355-365`), which is not `candidateColumns`
- `withCategoryRules` (`transactions.repo.ts:1507-1538`), whose holdings read gains `accountId`, also
  feeding the adoption path (`:1689`)
- `CategoryDraft` in `category-rule.ts:20-26`: gains `accountId`, the picked holding's account. A form
  draft has no `mcc` or IBAN, so those rules never pre-select a draft

`isNameMatcher` (`category-rules.repo.ts:33-34`) adds `nameContains`, so such a rule uses the
description narrowing. `mcc`, `account` and `counterIban` rules take the id-keyset page path, as a rule
with no name does.

#### 3.4.3 Validation

Parser, form and `canEverMatch` must agree (`refusalOf` re-parses what it stores,
`category-rules.repo.ts:191-199`):

| Condition | Parser accepts | Form | Never matches when |
|---|---|---|---|
| `nameContains` | `isUsableName` | as a name; same minimum as `nameStartsWith` (non-blank); the rewrite sheet's count is the guard | an exact name in the rule does not contain it |
| `mcc` | integer 0-9999 | four digits, `number-pad`; stored as a number, shown padded to four | two different codes in one rule |
| `account` | non-empty string | `SelectField` of the live accounts by `accountDisplayName`; none picked is an error | two different accounts in one rule |
| `counterIban` | `IBAN_PATTERN` after normalize | typed, auto-capitalized; refused by format | two different IBANs in one rule |

IBAN normalize: remove spaces, uppercase, in `ibanKeyOf`; used by the parser, `withNormalizedText` and
`subjectOfStoredRow`. `IBAN_PATTERN` (`apply-column-mapping.ts:31`) moves to a shared export. No
checksum check: fixture and restored values fail it, and a typo gives a count of 0 at save.

`matcher-key.ts`, `MATCHER_MATCHES`, `withNormalizedText`, `draftOf`, `outcomeOf`, `describeMatcher`,
`MATCHER_TYPES` and the `typeLabels` record are exhaustive or keyed, so a missing case fails to compile.

#### 3.4.4 Priority, performance, UI, labels

Priority: unchanged, more DISTINCT matchers first, then `updatedAt`, `createdAt`, `id`
(`prepare-rules.ts:30-32`). Each new condition counts 1. No special rank for a kind.

Performance: rules without `nameIs` sit in `withoutName` and run per row. The fixture
(50,000 rows, 200 rules) is not edited, because a shape pin holds its rule counts
(`category-rules.performance.test.ts`). Each new pin gives its own rule list with the new kinds. The
bounds are counted work, never wall clock (`transactions.repo.category-rules.performance.test.ts`).

Rule form: `MatcherRow` gains the four inputs; `MatcherDraft` gains `mccText`, `accountId`, `ibanText`
(`nameContains` reuses `text`). A draft keeps every field, so switching type loses nothing. Rule card:
`describeMatcher` shows the account by its live name, the IBAN in full (the user's own rule on the
user's own device), the MCC padded.

| Key | en | uk |
|---|---|---|
| `ruleForm.nameContains` | Name contains | Назва містить |
| `ruleForm.mcc` | Merchant code (MCC) | Код продавця (MCC) |
| `ruleForm.account` | Account | Рахунок |
| `ruleForm.counterIban` | Counterparty IBAN | IBAN контрагента |
| `ruleForm.errorMcc` | Enter a four-digit code. | Введіть чотиризначний код. |
| `ruleForm.errorAccount` | Choose an account. | Виберіть рахунок. |
| `ruleForm.errorIban` | Enter a valid IBAN. | Введіть правильний IBAN. |
| `categoryPage.deletedAccount` | Deleted account | Видалений рахунок |

Texts are drafts; kiko-translator's casing and full-stop rules decide. `MatcherDraftError` and
`rowErrorMessage` extend exhaustively.

#### 3.4.5 Account gone, restore, older builds

**Deleted account.** `accountsRepo.remove` (`src/accounts/accounts.repo.ts:562`) leaves the rule. It can
no longer match: no holding names that id. Dropping only that condition would widen the rule, so that
is never done. The card reads "Deleted account"; the user edits or deletes it. Chosen over deleting
the rule: the same dead state is reachable by restore anyway, and a user's rule is never silently lost.
On edit the seed clears an id no longer listed, so Save asks for a pick.

Disconnecting Monobank keeps the account and its holdings (`disconnect.ts:5-16`), so the rule keeps
matching and a reconnect re-adopts them.

**`.kiko` with a different account id.** A restore replaces rules and accounts together from one file,
so ids agree. The only rewrite of an account id is `withImplicitAccountsMerged`, which folds property
and debt accounts; a file that holds an `account` matcher post-dates migration 0050. The plan pins that
restoring such a file keeps the id. If an id ever does not resolve: never matches, reads "Deleted
account". Never a wider match.

**The current parser, read on this base.** `release-1.3`'s `parse-rule-matchers.ts` was read with `git show`
at 918683db3 and equals the base, as its `default-category-title.ts` does (section 3.1.6). No frozen copy of
either goes into the tests: the round trip runs on raw JSON.
- Unknown `type`: `parseMatcher` `.otherwise(() => null)` (`parse-rule-matchers.ts:64`).
- Mix of known and unknown: `matchers.every(isMatcher) ? matchers : null` (`:81`): the **whole rule** is
  unreadable. The known conditions do NOT run, so no wider match. Pinned by the comment at `:70-71`.
- Unreadable rules go to `prepared.unreadable`, outside `ordered`, `byName`, `withoutName`
  (`prepare-rules.ts:95-96`), so no apply path sees them.
- Raw JSON is kept: nothing rewrites an unreadable row. `storeRule` updates by id only; `saveRule` and
  `applyNameRule` work from `ordered`. The card has no edit (`category-form.screen.tsx:87-91`, `:368-376`:
  `onPress` undefined), so an older build cannot save over it. It offers delete, and a category delete
  removes it (`categories.repo.ts:114-116`), both the user's explicit action.
- Export writes the raw row: `read-snapshot.ts:49`. Restore checks shape only: `isStoredCategoryRule`,
  `import-data.ts:82-88`. `assertKnownCurrencies` reads `amount` matchers only.

**The version gate exists:** `EXPORT_VERSION = 5`, `READABLE_EXPORT_VERSIONS` (`crypto/envelope.ts:13,19`),
checked in `isExportEnvelope` (`import-data.ts:53`) and `decryptEnvelope` (`envelope.ts:60`).

| Build | Reads | File from 1.4 (version 5) | was: brief |
|---|---|---|---|
| v1.1.0 (`envelope.ts`: `EXPORT_VERSION = 2`) | 1-2 | Refused whole: "not a valid Kiko export file". No rule reached | unreadable, never matches |
| v1.2.0 (`= 3`) | 1-3 | Refused whole, as every version 4 and 5 file already is | unreadable, never matches |
| `release-1.3` tip 918683db3 (`= 5`) | 1-5 | Restored; the B4 rule is unreadable, never matches | unreadable, never matches |

(a) **Restore of a new `.kiko` into 1.3:** every row restored with its category. A B4 rule's row is
stored verbatim, shows "This rule can't be read" on its category's page with delete only, and matches
nothing, not even its known conditions. New rows that rule would have sorted keep their MCC category.
No wrong write.

(b) **Export from 1.3, restore into 1.4:** the rule's JSON comes back byte for byte and reads again; it
works on rows from then on. Restore runs no rule rewrite, so rows 1.3 added in between keep the category
they got, until the user applies. One exception is the B1 back-fill: a 1.3 file has no mark, so
`importData` runs it once, and rows with an added code that have no real category move (section 3.1.4);
the same file gains or keeps Travel by the table in section 3.1.6. If the user deleted the card in 1.3, it is gone, by their action.
Same result for an in-place update from 1.3.

**Result: an older build cannot damage data; no fix is needed.** `EXPORT_VERSION` stays 5 for B4. A bump
would make 1.3 refuse every 1.4 file over a rule that is safely inert (precedent: `envelope.test.ts`, the
notes at 0054, 0058). B4 adds no migration, so that test forces no decision.

Cannot be fixed, since those builds shipped or are frozen: 1.3's text "This rule can't be read" gives no
reason, and a delete there is final; v1.1.0 and v1.2.0 refuse with a generic text, not "update the app".

### 3.5 B5 Suggestions

**One screen with B2, agreed:** a suggestion is one more thing a review line shows, with no route, list
or write path of its own.

**Evidence, exactly.** For a review group, every row with the same `merchantNameOf` key, a stored
non-blank description, `setsBalance` false, `changeGroupId` null and no exchange marker. Each is one
vote for its category key:
- Hand-set, rule-set and MCC-set rows all vote. An MCC-set row stands unchallenged, and it is what links
  a PrivatBank row with no code to the same merchant's Monobank rows. No provenance is computed.
- Only a real category votes: a `hasNoRealCategory` row has no vote, however it got there. A suggestion is
  still only a suggestion, and the user confirms it.

Read: an aggregate `GROUP BY description, lower(category)` for real-category rows.

**Thresholds, in `plan-review-groups.ts`:** suggest when the top category holds both:
- `SUGGESTION_MIN_AGREEING_ROWS = 2`: one row can be a "Just for this one" pick, the opposite of a pattern.
- `SUGGESTION_MIN_SHARE = 0.75`: at two or three votes any dissent stops it; from four, one stray row passes.

**Determinism:** pure, no clock, no order dependence; a share of 0.75 or more cannot tie.

**Shown:** a chip on the line with the category's icon, title and "5 of 6". Nothing changes until the user
taps it; the tap runs the same preview and write as B2 (section 3.2.4).

**Dismissal needs no mark, table or `.kiko` change:** ignoring a chip changes nothing; another pick resolves
the line by a rule. A hidden "not this" list would be a second place deciding what a line shows, with a migration and a restore path.

## 4. Name grouping

One pure function, used by B2, B3, B5 and later `1.4-recurring`.

```ts
// src/transactions/merchant-name/merchant-name.ts
export type MerchantName = {
  // The grouping identity: a normalized name, or its normalized prefix.
  key: string;
  // The text a "starts with" rule would hold, as written; null when no store number was cut.
  prefix: string | null;
};
export const merchantNameOf = (name: string): MerchantName;
```

It calls `normalizeTransactionName` and does not change it or its callers.

**Rules, in order.** `tidy` = NFC, whitespace collapsed, trimmed, case kept. `key` of a kept name =
`normalizeTransactionName(name)`.
1. Blank: `{ key: '', prefix: null }`. A caller never groups a blank key.
2. Split `tidy` on spaces; `last` is the final token.
3. `last` must match `/^[#№]?\d{2,6}$/`. Else keep the whole name.
   - One digit is no store number ("Top up 1"); seven or more is a phone, a reference or an id
     ("... 380670000000").
   - A masked card has letters or stars in the token, so it never matches ("4111xxxxxxx1111",
     "537541******1234").
4. Drop `last`; then drop trailing tokens made only of separators (`#`, `№`, `-`, `,`, `.`).
5. Count `\p{L}` in the remainder. Under `MERCHANT_PREFIX_MIN_LETTERS = 3`: keep the whole name. Two
   letters make a prefix that matches too much; a remainder of digits has none.
6. Otherwise `prefix` = the remainder, `key` = its normalized form.

One pass only: "ATB 12 0212" gives the prefix "ATB 12". The strip looks at the end only, because a rule
can express only a prefix.

**Guaranteed:** `normalizeTransactionName(prefix) === key`, and `normalizeTransactionName(name)
.startsWith(key)`, so a `nameStartsWith` on `prefix` matches every name of its group. Property pin.

**Ruling, Cyrillic against Latin: not one merchant.** No transliteration or homoglyph folding: "АТБ 0212"
and "ATB 0212" are two keys. Nothing in the repo proves they are one (`MERCHANT_WORDS` in
`rules-performance-fixture.ts` lists "Silpo" and "Сільпо" as separate words), and the rule matcher
compares text: a merged group could not be one rule, so the count would promise rows the write cannot
win. The user sees two lines and can assign both.

| Input (sample source) | key | prefix | Why |
|---|---|---|---|
| `Silpo Market 12` (repo tests) | `silpo market` | `Silpo Market` | store number at the end |
| `ATB 0212` (ideas file) | `atb` | `ATB` | same |
| `ATB` (fixture word) | `atb` | null | no number; same group, the prefix rule covers it |
| `ATB Market` (repo tests) | `atb market` | null | another key; a prefix rule on "ATB" reaches it: the confirm shows it |
| `АТБ 0212` | `атб` | `АТБ` | Cyrillic key |
| `ATB #0212`, `ATB № 0212`, `ATB - 0212` | `atb` | `ATB` | `#` joined; the others dropped at rule 4 |
| `ATB-0212` | `atb-0212` | null | one token; a miss is safe, the user can type the prefix |
| `7-Eleven` | `7-eleven` | null | last token is not a number |
| `7-Eleven 0212` | `7-eleven` | `7-Eleven` | six letters remain |
| `7 11` | `7 11` | null | no letters remain |
| `BP 1234` | `bp 1234` | null | two letters: "bp" would match too much |
| `0212` | `0212` | null | purely numeric: no letters remain |
| `ATB 0212 Kyiv` | `atb 0212 kyiv` | null | number in the middle: the end is not a number |
| `Top up 1` (repo tests) | `top up 1` | null | one digit |
| `Рахунок створений автоматично для поповнення балансу 380670000000` (sensebank fixture) | whole name | null | twelve digits |
| `Visa Signature 4111xxxxxxx1111` (sensebank fixture) | whole name | null | masked card |
| `537541******1234` (repo tests) | whole name | null | masked card |
| `Виведення кешбеку 464.40₴` (monobank fixture) | whole name | null | an amount token; each stays its own line, and count order sinks it |
| `WFP.OPENDATABOTM` (sensebank fixture) | `wfp.opendatabotm` | null | no number |
| `   ` | `` | null | blank |

False friends, accepted: "iPhone 15" and "iPhone 16", "Рента 2024" and "Рента 2025" group; the user sees the
names before anything moves. The repo holds few real store-number names, so the rule is conservative: a miss
means one more line, never a wrong write.

## 5. The plan function

### 5.1 Every category write path

| Path | Where | Through the plan? | Why |
|---|---|---|---|
| Form create | `recordManual`, `transaction-form.screen.tsx:941,1085`; `recordManualTransaction` `transactions.repo.ts:280-281` | No | the user's own row, a new row; flag = `userPickedCategory` |
| Form edit, category | `setCategory` `transactions.repo.ts:2782-2788`, from `transaction-form.screen.tsx:1311` | No | explicit, one row, sets the flag. `update` (`:2631`) does not write category |
| Just for this one | `setCategory` from `use-category-override.ts:77` | No | same |
| Apply | `applyNameRule` `category-rules.repo.ts:488` -> `rewriteWithPreparedRules` | **Yes**, `planRuleRewrite` | source row: `giveSourceRowCategory` writes directly, on purpose (`:342-347`) |
| Rule create, edit | `saveRule` `:456`; count `countRuleRewrite` `:432` | **Yes**, one `rowIdsRewrittenBy` | |
| Sync, statement import: new row | `withCategoryRules` `transactions.repo.ts:1478`, `:1713` | No plan; same `winningRule` | a new row has no prior category |
| Sync refresh | `ruleWonTransactionSet` `:1439-1448` | SQL built from `REWRITE_GUARD_FIELDS` | typed over the same list |
| Sync adoption | `adoptedValuesOf` `:1658`: `twin.category ?? input.category` | No | the import row's own value stays |
| Balance rows | `holdings.repo.ts:582,882`: `category: null` | No | structural |
| Restore | `restoreDataSnapshot`, verbatim | No | no rewrite by design (`import-data.ts:123-126`). Travel's mirror adds a `categories` row and writes no transaction |
| Category delete | `categories.repo.ts:109-112` | No | never-orphan fold; clears the flag, documented |
| **New: B1 back-fill** | `backfillMccCategories` | **Yes**: `planMccBackfill` on `isRewriteEligible`, `winningRule`, `hasNoRealCategory` | no user present, so the narrowest filter |
| **New: B2 one tap** | `applyNameRule` | **Yes**, `planRuleRewrite` | |
| **New: B3 prefix** | `applyNameRule` `kind: 'nameStartsWith'` | **Yes** | |
| **New: B5 accept** | `applyNameRule` | **Yes** | |

Rule for this track: a UI count and the write it predicts call one function. `previewNameRule` and
`applyNameRule` share a private stage step and `rowIdsRewrittenBy`. The list's `rowCount` is the same
eligibility (`isRewriteEligible`, `winningRule`), with the subset relation pinned (section 3.2.4).

### 5.2 Mass rewrite cost

One `write()`, one commit, one reactive flush (`client.ts:138-143`), so no storm: each subscriber to
`transactions` re-reads once. While the write runs it holds op-sqlite's one worker queue, as Apply does
today. The back-fill runs after first render, as `useLotRecost` does, so screen reads queue ahead of it;
after its first run an open costs one settings read.

### 5.3 What changes when a category changes

| Reader | Where | Effect |
|---|---|---|
| Spending pie | `category-breakdown.ts:192,217` | the row moves to another slice |
| Trend | `category-trend.ts:150,255` | same, across past months: history shifts |
| Loan payment split | `loan-payments.ts` | an excess keeps the payment row's own category |
| Home rows and filter chips | `transaction-row.component.tsx:41`, `home.screen.tsx:395,419` | new label and filter |
| Filter's category list | `contextCategoriesQuery` `transactions.repo.ts:2323` | `other` may drop out |
| Holding detail | `holding-detail.screen.tsx:570` | new label |
| Statistics live read | `listAllQuery` `statistics.screen.tsx:266`, `paused` when hidden | re-reads once on return |
| Reminders | `enteredByUser` `reminders.repo.ts:72`: `isNotNull(category)` on `source = 'manual'` | see below |

Not read by category: spending exclusion keys on `mcc` and IBAN (`transfer-exclusion.ts:19-21`); exchange
exclusion on markers; exchange funding on the hand flag (`exchange-funding-match.ts:280`), which these paths
do not set; no statistic names `'transfers'` or `'cash'` (grep of `src/statistics`, `src/screens/statistics`,
`src/screens/home`); balances and net worth do not read `category`. So the spending total and "how much
money do I have now" do not change. Travel changes none of these readers: it is one more live category row
(section 3.1.6).

Trap, `enteredByUser`: a manual row going from NULL to a category would count as an entry. Balance rows are
`setsBalance`, so ineligible, and a manual row has no `mcc`. B2 can reach only a manual, non-balance,
NULL-category row with a description. No live writer is known to make one; the plan measures that and pins
the result. The en and uk demo files hold 24 such rows: Salary 6, Crypto purchase 6, Account top-up 4, Jar
top-up 3, BTC purchase 2, ATM cash withdrawal 1, Freelance project 1, Brokerage account top-up 1. A B2 tap on
one feeds `enteredByUser`. Accepted: the row was entered by the user, so counting it is truthful. The only
reader is `manualEntryDaysQuery`, which feeds the offer of a reminder (`useReminderOffer`, two entries in its
window), never a fired reminder. The demo rows share one `createdAt`, so they are one entry per account.

## 6. Binding constraints and what enforces them

| Constraint | Mechanism |
|---|---|
| A hand-set row never changes | `isRewriteEligible` on `categorySetByHand` in every plan; SQL guard on the update (`category-rules.repo.ts:336`); `planMccBackfill` adds `categorySetByHand = 0` to its update. Known exceptions, unchanged: the row the user is editing under Apply, and a category delete |
| An automatic guess never overwrites a category without confirmation, unless the row has no real category | Only the B1 back-fill writes with no tap, and only under `hasNoRealCategory` (section 3.0), an added code and no winning rule. B2, B3, B5 write only after a tap; a count beyond the list, and every B3 prefix, goes through a confirm with names |
| The Travel seed never touches a user's row; a deleted Travel stays deleted | `INSERT OR IGNORE` at `MAX + 1`; the restore mirror adds only when the file lacks both the mark key and the row (section 3.1.6) |
| "No real category", exactly | `hasNoRealCategory`: NULL or empty, `other`, or an orphan key; and no hand flag, no structural field, no winning rule |
| A wrong prefix guess changes no row unconfirmed | B3's button opens a confirm from `previewNameRule`; only the confirm writes |
| A new condition never widens a rule | New `type` strings only; null subject means no match; all-or-nothing parser |
| An older build damages nothing | Sections 3.4.5 and 3.1.6, each with a two-path restore test |
| Product purpose | Section 5.3: no balance or net worth reads; no budget or planning item in scope |

## 7. Compliance, i18n, migrations

**Compliance (kiko-compliance).**
- No new network call, domain, SDK, permission or required-reason API. The MCC source is a build-time
  list; nothing fetches it at runtime. App Privacy stays "Data Not Collected"; the policy is unchanged.
- An IBAN typed into a rule is a local value in `category_rules`, in the encrypted database and the
  encrypted `.kiko`. Never logged: failure logs use fixed text.
- 2.5.19: no flag; the feature shows in a release build with no data (section 3.2.5); the Travel tile shows
  on every install. No demo or seed import from `src/`. The Notes for Review describe it specifically (2.3.1(a)); What's New per its format.
- Trademarks: no merchant name in the catalogue or placeholders; "ATB" here is only an example. The app
  shows only the user's own names.

**i18n (kiko-translator).** Both catalogues together; the parity test holds. Plurals carry
`_one/_few/_many/_other` in both. A count goes through `count`. A list of names goes through
`common.listedName`. uk apostrophe is U+02BC. Seeded category titles through
`resolveDefaultCategoryTitle`.

| Key | en | uk |
|---|---|---|
| `categories.travel` | Travel | Подорожі |

The uk text is a draft and holds no apostrophe; kiko-translator decides. New keys, floors, beyond this table
and section 3.4.4:
- `categoryReview.*`: route title, entry card label, group line ("Starts with {{name}}", names plural,
  transactions plural), suggestion text, empty title and message, confirm heading, confirm message, "and
  {{count}} more"
- `forms.transaction.applyToAllStartingWith`, its confirm
- `help.topics.categoryRules`: the new condition list in step 2, a review step, the prefix option

Removed or renamed keys: none. Theme: tokens only in UI code, so `1.4-light-scheme` applies by itself; the
one stored hex is Travel's seeded color (section 3.1.6).

**Migrations.** Two in this track, both in task 1. The numbers are not assigned; merge order decides. Never
rename a shipped one.

| Item | Migration | Why |
|---|---|---|
| B1 | `seed_travel_category`: data only, no snapshot, one `INSERT OR IGNORE` | ruling Q2, section 3.1.6 |
| B1 | `add_mcc_categories_backfilled`: `settings.mcc_categories_backfilled` integer NOT NULL DEFAULT false | the once-only mark, and what tells a 1.4 file from an older one |
| B2 | None | no index; a pin decides (section 3.2.3) |
| B3 | None | rule JSON |
| B4 | None | rule JSON, already a text column read through a guard |
| B5 | None | no dismissal table |

For both migrations the plan includes `kiko:reviewer` before BATCH READY and a test file each. The mark adds
`settings-columns.test.ts` and restore pins beside `restore-dismissed-tips.test.ts`. The seed adds its restore
mirror and the two-path test. `crypto/envelope.test.ts` gains two `VERSION_DECISIONS` notes (section 3.1.6) with
`migrationCount` plus two and **no bump**.

## 8. Order and split

Each set merges into `next` alone. A shared function ships with its first caller, or Knip fails.
Mutation gates are paused by the user; verify and review apply. Counts are mutable files, as
`mutable_source_files` in `scripts/checks/mutation.sh` filters each task's file list, and are floors.

1. **1.4-category-automation task 1/6: more MCC codes, Travel and the back-fill.** Goal: old and new rows with
   an added code leave `other`, hotels and flights into a new seeded Travel. Needs nothing. Includes
   `hasNoRealCategory`, both migrations and the restore mirror. 10 mutable.
2. **1.4-category-automation task 2/6: prefix offer in Apply.** Goal: B3 with its confirm, and store-number
   rows in the demo. Needs nothing. Includes `merchantNameOf`, `previewNameRule`, `applyNameRule` `kind`.
   7 mutable.
3. **1.4-category-automation task 3/6: name-contains and MCC conditions.** Goal: two B4 kinds in the parser,
   matching, feeds, form, card, help. Needs task 1: it edits `backfill-mcc-categories.ts` and `MccBackfillRow`.
   15 mutable.
4. **1.4-category-automation task 4/6: account and IBAN conditions.** Goal: the other two B4 kinds, the
   deleted-account state, the two-path older-build restore test. Needs task 3. 18 mutable.
5. **1.4-category-automation task 5/6: review list.** Goal: B2 screen, entry card, one tap, empty state, help
   step. Needs tasks 1 and 2. 9 mutable.
6. **1.4-category-automation task 6/6: suggestions.** Goal: B5 chip on the review line, and a merchant in the
   demo that shows it. Needs task 5. 4 mutable.

Tasks 1 and 2 stand alone; tasks 3 and 4 follow their needs. Help text naming a condition or the review list
ships in the set that adds it, never before. Each set: `kiko:retrospect` and `kiko:scribe` for skill
drift (kiko-domain's rule text, kiko-architecture's one-time steps, kiko-design-system if a shared
component changes); the coordinator's queued verify; the coordinator's merge.

## 9. User rulings, 2026-11-03

Relayed by the coordinator.

**Q1 = A. Old rows with a newly mapped code move once per data set, at the next app open, with no prompt.**
Hand-set rows never move. Past months' slices shift silently. A pick of `other` made before version 1.2 on
such a row, or a since-deleted rule's result, moves too and cannot be told apart. "Once" holds per device and
per file: `importData` also runs the back-fill for a file without the mark, so restoring a backup made before
1.4 repeats the move on that file's rows.

**Q2 = B, against the planner's recommendation. A new seeded "Travel" category.** Hotels 7011 and 3501-3999,
travel agencies 4722, airlines 3000-3299 and 4511, airports 4582 map to `travel`. One more migration, so two in
the track. A user with their own travel category sees a duplicate; accepted. Car rental (3351-3441, 7512), rail
and other land transport stay in `transport`. None of the 38 original codes changes: checked against
`MCC_CATEGORIES`, none is one of these. Section 3.1.6.

**Planner's calls, recorded, not questions** (reasons in the sections named): entry point on the Categories
screen (3.2.1); no index, a pin decides (3.2.3); no device count (3.1.5); sort by count, not total (3.2.2);
`EXPORT_VERSION` stays 5 (3.4.5, 3.1.6); a mapped hotel range wider than the source lists (3.1.1); Travel's
icon, color and sort order (3.1.6); dismissal needs no mark (3.5); evidence includes MCC-set rows (3.5);
the thresholds (3.5, 4); Cyrillic and Latin are two merchants (4); a deleted account's rule stays (3.4.5);
no undo control, since editing the rule moves the rows back (3.2.4).
