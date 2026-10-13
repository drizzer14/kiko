# Demo `.kiko` fixtures

Two committed, encrypted export files, generated from the pure demo dataset
in `../seed/screenshot-seed.ts` and used by two consumers, through the app's
**real Import UI** — there is no boot-time seed, no build flag, no launch
argument (Guideline 5.6):

- **`kiko-demo-uk.kiko`** — the user's own manual marketing screenshots
  (matches the shipped `screenshots/appstore/**/uk/` deliverables). Ukrainian
  names (Монобанк, Сільпо, Брокер, ...) and `language: 'uk'`, so it imports
  with the UI in Ukrainian.
- **`kiko-demo-en.kiko`** — handed to the **App Store reviewer**. English
  names for every user-visible text the file carries (Broker, US dollars,
  Government bonds (OVDP), Real estate, Owed to Andrii, ...) and
  `language: 'en'`, so an English-reading reviewer is not dropped into a
  Ukrainian app (`restoreDataSnapshot` takes the `settings` row from the file
  except the columns in `KEPT_FROM_LIVE_ON_RESTORE`, see
  `src/db/kept-from-live-on-restore.ts`; `language` comes from the file). Real
  merchant and brand names stay (Uklon, Rozetka, Amazon, Booking.com, Wise, Binance). The names
  live in `../seed/demo-text.ts`; numbers, dates, and structure are identical
  in both files, and a test pins that the English file holds no Cyrillic letter.

## Files

| File | What it is |
|---|---|
| `kiko-demo-uk.kiko` | AES-256-GCM `ExportEnvelope` JSON (`src/data-transfer/crypto/envelope.ts`), Ukrainian dataset |
| `kiko-demo-en.kiko` | Same, English dataset |
| `kiko-demo-en-1.1.kiko` | A frozen copy of the English file as release 1.1 wrote it (export version 1, none of 1.2's settings columns); never regenerated or edited, read only by `src/data-transfer/import-data.back-compat.test.ts` |
| `kiko-demo.key` | The base64 AES-256 key, **shared by all the files** |
| `build-demo-snapshot.ts` | Pure mapper: `ScreenshotDataset` -> `DataSnapshot` (every logical table, the transaction templates included) |
| `generate-demo-kiko.ts` | Pure encoder: `DataSnapshot` + key + anchor -> the `.kiko` file's JSON, via the app's real `encryptEnvelope` |
| `demo-anchor.ts` | Picks the regen anchor: `KIKO_DEMO_ANCHOR` or the local day |
| `generate-demo-kiko.test.ts` | REGEN (writes the fixtures) + GUARD (decrypts and diffs them against the current builder — this is what `make gate` runs on every future commit) |

## The anchor: a file thins out within weeks of being regenerated

Every date in the dataset (transactions, loan schedules, bond coupons, price
points, rate history, reminders, `createdAt`, `exportedAt`) is measured from one
**anchor**: 09:00 UTC on the day the files were regenerated. The app opens its
Home list and charts on the last 30 days before the **device date**
(`src/dates/default-range.ts`), and the newest demo row sits two days before the
anchor. So the files fill Home and the charts from the anchor day onward, but
they thin out as the device date moves past it: the default 30-day window
holds about a dozen rows on the anchor day, fewer each week, and none after
about four weeks (see `seed/screenshot-seed.ts`). The data thins from about
the second week, so about four weeks is an upper bound, not a safe age: a file anchored on a past day imports fine but shows a sparse,
then empty, Home list and spending charts.

There is no date shifting at import time (Guideline 5.6): the app imports the
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

## Importing on a device

Settings → Import Data → pick the `.kiko` file → paste the key from
`kiko-demo.key` → Import → confirm the replace-everything warning → **cold
relaunch the app** (kill it fully, then reopen) so `applyPersistedLanguage`
(`src/migration/migrations-gate/migrations.gate.tsx`) picks up the imported
language on the next launch. Leave the device clock on the real date; if the
files are more than a week or two old, regenerate them first.
