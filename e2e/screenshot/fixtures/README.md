# Demo `.kiko` fixtures

Two committed, encrypted export files, generated from the pure demo dataset
in `../seed/screenshot-seed.ts` and used by two consumers, through the app's
**real Import UI** — there is no boot-time seed, no build flag, no launch
argument (Guideline 2.5.19):

- **`kiko-demo-uk.kiko`** — imported by `.maestro/screenshots/duo-import-demo.yaml` (`FILE=`)
  or by hand, and used for the screenshots.
  Ukrainian names (Монобанк, Сільпо, Брокер, ...) and `language: 'uk'`, so it
  imports with the UI in Ukrainian. It no longer matches the shipped
  `screenshots/appstore/**/uk/` deliverables: the dataset has changed since they
  were shot (two fiats and two coins only, many more merchants, categorized
  top-ups, and the live rule demo rows below), so a reshoot differs from the
  shipped images.
- **`kiko-demo-en.kiko`** — handed to the **App Store reviewer**. English
  names for every user-visible text the file carries (Broker, Euro,
  Government bonds (OVDP), Real estate, Owed to Andrii, ...) and
  `language: 'en'`, so an English-reading reviewer is not dropped into a
  Ukrainian app (`restoreDataSnapshot` takes the `settings` row from the file
  except the columns in `KEPT_FROM_LIVE_ON_RESTORE`, see
  `src/db/kept-from-live-on-restore.ts`; `language` comes from the file). Real
  merchant and brand names stay (Silpo, ATB, Uklon, Bolt, Rozetka, Netflix, KFC, Lidl, Amazon,
  Booking.com, Wise, Binance). The names
  live in `../seed/demo-text.ts`; numbers, dates, and structure are identical
  in both files, and a test pins that the English file holds no Cyrillic letter.

## Files

| File | What it is |
|---|---|
| `kiko-demo-uk.kiko` | AES-256-GCM `ExportEnvelope` JSON (`src/data-transfer/crypto/envelope.ts`), Ukrainian dataset |
| `kiko-demo-en.kiko` | Same, English dataset |
| `kiko-demo-en-1.1.kiko` | A frozen copy of the English file as release 1.1 wrote it (export version 1, none of 1.2's settings columns); never regenerated or edited, read only by `src/data-transfer/import-data.back-compat.test.ts` |
| `kiko-category-check-en.kiko` | The English demo plus the rows that check the category automation on a simulator ("The category check file"); not for the reviewer or the screenshots |
| `kiko-demo.key` | The base64 AES-256 key, **shared by all the files** |
| `build-category-check-snapshot.ts` | Pure mapper: the English demo snapshot plus the check rows, one category and the 1.3 settings mark |
| `build-demo-snapshot.ts` | Pure mapper: `ScreenshotDataset` -> `DataSnapshot` (every logical table, the transaction templates included) |
| `generate-demo-kiko.ts` | Pure encoder: `DataSnapshot` + key + anchor -> the `.kiko` file's JSON, via the app's real `encryptEnvelope` |
| `demo-anchor.ts` | Picks the regen anchor: `KIKO_DEMO_ANCHOR` or the local day |
| `generate-demo-kiko.test.ts` | REGEN (writes the fixtures) + GUARD (decrypts and diffs them against the current builder — this is what `make gate` runs on every future commit) |

## The anchor: a file thins out within weeks of being regenerated

Every date in the dataset (transactions, loan schedules, bond coupons, price
points, rate history, reminders, `createdAt`, `exportedAt`) is measured from one
**anchor**: 09:00 UTC on the day the files were regenerated. The app opens its
Home list and charts on the last 30 days before the **device date**
(`src/dates/default-range.ts`), and the newest demo row sits four days before the
anchor (Silpo, then Uklon on day 5, then the two day 6 rows). So the files fill Home and the
charts from the anchor day onward, but they thin out as the device date moves past it: the
default 30-day window holds 49 rows on the anchor day, 40 a week later, 26 after two weeks,
10 after three, and none from the 27th day on. The data thins from about the second week, so
about four weeks is an upper bound, not a safe age: a file anchored on a past day imports fine
but shows a sparse, then empty, Home list and spending charts.

There is no date shifting at import time (Guideline 2.5.19): the app imports the
file as written. Keep the files fresh instead: regenerate the files and refresh
the reviewer kit for **every App Store submission and resubmission**, and
before a screenshot session.

The GUARD test never compares against the current date. It reads the anchor back
from each decrypted file (its `exportedAt`) and rebuilds the dataset for that
anchor, so a stale-by-calendar file still passes; only a file that differs from
what the builder produces for its own anchor fails.

## `kiko-demo.key` is not a secret

It encrypts **fabricated demo data only** — invented account/holding/
transaction rows built by `screenshot-seed.ts` (real Ukrainian merchant and
bank *names* for realism, no real account, balance, or transaction ever
existed). The payload carries **no `secrets` block** (no Monobank token, no
Binance credentials, no DB key — see `src/data-transfer/payload.d.ts`), and
the key unlocks nothing outside these two files. It is committed so a
reviewer or the user can import the demo dataset through the same real
Import UI a real export would use.

## Regenerating

Run this after any change to `screenshot-seed.ts`, `demo-text.ts`, or
`build-demo-snapshot.ts`, after any change to the snapshot shape (a new table,
a new `settings` column, or a changed column default), and on the days named
above. Regenerate in the same commit as the migration:

```bash
KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts
```

The anchor is today's local date (under Jest, the Europe/Kyiv date, since
`jest.config.js` pins `TZ`). To anchor another day, add
`KIKO_DEMO_ANCHOR=YYYY-MM-DD` (a malformed value fails the run instead of
falling back to today).

`kiko-demo.key` is reused if already committed (a fresh key would make every
old fixture unreadable); a first-time run generates one and writes it. Both
`.kiko` files are always rewritten from the current dataset, with the same
anchor. The GUARD test then re-runs automatically inside the same file and
confirms both files decrypt back to what the current builder produces —
verify it passed before committing. Never regenerate or edit
`kiko-demo-en-1.1.kiko`.

Note: `encryptEnvelope` uses a fresh random nonce every call, so the
ciphertext bytes differ on every regen even when the underlying data is
unchanged — that is expected, not a bug.

The demo carries category rules; the contract is in `build-demo-snapshot.test.ts`
(rule-vs-ledger agreement over en and uk). Regenerating moves the anchor to the
regeneration day.

## The live rule demo

Six Monobank card rows (`KFC` four times, `KFC: refund` and `Sushi Master`, 7 to 24 days before
the anchor) sit in the default category with no rule over them, so a rule typed live in the app has
rows to move. Open the Settings tab, then Categories, then Dining, then Add rule, and enter three
conditions: Name starts with `KFC`; Amount, Less than, `800` (hryvnias); Type, Expense. Save asks
"This changes 3 transactions."; the three KFC orders under 800 move to Dining. The refund (an
income), the Sushi Master order (another name) and the KFC order of 1,450 (an amount over 800) each
fail one condition and stay.
The merchants are KFC and Sushi Master because the reviewer kit's fake Monobank statement names
neither of them, nor any other merchant of this rule demo: a rule on a merchant the statement does
name (Glovo has five rows under 800 that import as other) would count more rows once that
statement is imported.
`build-demo-snapshot.rule-demo.test.ts` pins the rule and the count with the app's own matcher.

## The store-number rows

Three Monobank card rows (`Varus 0212` twice and `Varus 0340`, 9 to 20 days before the anchor,
at uneven gaps) sit in the default category. Edit one of them, pick a category and save: the
Apply sheet then offers `All starting with "Varus"` below Apply, because the name ends in a store
number. Tapping it shows the transactions that would move, `Varus 0212` and `Varus 0340`, and
moves nothing until Move is tapped. `Varus` is a Latin brand name in both files, as `Novus` is.
The rows raise the card's opening deposit by their total, so the card keeps its end balance.
`build-demo-snapshot.test.ts` pins that the only name with a prefix is this one.

## The suggestion rows

Four Monobank card rows named `Mokko Coffee` (`Мокко Кава` in the Ukrainian file) sit 11, 17, 22
and 25 days before the anchor, at uneven gaps so they cannot read as a monthly series. The first
three are filed under Dining; the one 25 days back stays in the default category. In Settings,
open Categories, then "Sort transactions without a category": the `Mokko Coffee` line shows a
Dining chip, 3 of 3, and a tap on it files that one row. The `Varus` line shows no chip, because
none of its rows is filed.
The rows raise the card's opening deposit by their total, so the card keeps its end balance.
`build-demo-snapshot.test.ts` pins the suggestion on this line and none on `Varus`.

## The steady bills

Netflix, Kyivstar, Kyivteploenergo, YASNO and Kyivvodokanal keep their day every month, so the
Recurring charges list in Settings shows exactly these five. Every other merchant on the main card
moves in the odd months only: a row on a day under 15 moves ten days later, any other row ten days
earlier. The even months and month 0, the newest, never move. So a shop or the taxi reads as
spending that comes and goes, not as a subscription. The amount stays and the row stays in its
30-day month, so each month's total is unchanged.
`build-demo-snapshot.recurring.test.ts` pins the five on every anchor it tries.

## The category check file

`kiko-category-check-en.kiko` is a third file, for a person who checks the category automation on a
simulator. It is `kiko-demo-en.kiko` plus extras, built by `build-category-check-snapshot.ts` from
the same builder, and it is encrypted with the same `kiko-demo.key`. It never goes to the reviewer
or into a screenshot, and the demo files do not hold its rows. It has its own regeneration, so a
demo regeneration leaves it and it leaves the demo files:

```bash
KIKO_REGEN_CATEGORY_CHECK=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts
```

(`KIKO_DEMO_ANCHOR=YYYY-MM-DD` works as above; the file thins out the same way, so regenerate it on
the day of a check.) `build-category-check-snapshot.test.ts` pins what moves, what stays, the chip
and the confirm case.

Import it as in "Importing on a device", then open Settings, then Categories. The file reads as one
a 1.3 install wrote (`mccCategoriesBackfilled: false`), so the one-time move runs during the import.
Nothing else is needed to see it.

- **The one-time move.** The Travel tile holds four rows: `Hotel Dnipro` (code 7011, 6,200.00),
  `Ryanair` (4511, 4,100.00), `Wizz Air` (3100, an airline code in 3000-3299, 2,850.00) and
  `Sunrise Travel Agency` (4722, 11,500.00), 24,650.00 in all. `Bistro Zamok` (5811, 640.00) moves
  to Dining. `Spa Hotel Carpathia` (7011, 8,900.00) was picked by hand in Entertainment and stays
  there. Before the move the five other rows sat in Other.
- **The chip.** Sort transactions without a category lists 15 lines. The `Bud Depot` line (one row,
  `Other`, 1,420.00) shows the chip `Home renovation and garden supplies, 2 of 2`: two other
  `Bud Depot` rows are filed under that category, which is a user-made one with a long title.
- **The confirm sheet.** The `Podil Bakery` line lists 2 transactions (84.00 and 96.00). Select
  Dining for it: the Move Transactions sheet opens, because the rule for the name also moves a
  third `Podil Bakery` row (78.00) that is already in Groceries by its code and that the line does
  not show: "3 transactions move to "Dining"". Select Groceries for it instead and the two rows
  move at once, with no sheet.
- **Unchanged.** `Mokko Coffee` shows `Dining, 3 of 3`, `Varus` holds 3 rows with no chip, `KFC`
  holds 4.

## Importing on a device

Settings → Import Data → pick the `.kiko` file → paste the key from
`kiko-demo.key` → Import → confirm the replace-everything warning → **cold
relaunch the app** (kill it fully, then reopen) so `applyPersistedLanguage`
(`src/migration/migrations-gate/migrations.gate.tsx`) picks up the imported
language on the next launch. Leave the device clock on the real date; if the
files are more than a week or two old, regenerate them first.
