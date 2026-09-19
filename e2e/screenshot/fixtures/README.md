# Demo `.kiko` fixtures

Two committed, encrypted export files, generated from the pure demo dataset
in `../seed/screenshot-seed.ts` and used by two consumers, through the app's
**real Import UI** — there is no boot-time seed, no build flag, no launch
argument (Guideline 5.6):

- **`kiko-demo-uk.kiko`** — the user's own manual marketing screenshots
  (matches the shipped `screenshots/appstore/**/uk/` deliverables). Imports
  with the UI in Ukrainian.
- **`kiko-demo-en.kiko`** — handed to the **App Store reviewer**. Imports
  with the UI in English, so an English-reading reviewer is not dropped into
  a Ukrainian app (`restoreDataSnapshot` replaces the whole `settings` row,
  including `language`).

## Files

| File | What it is |
|---|---|
| `kiko-demo-uk.kiko` | AES-256-GCM `ExportEnvelope` JSON (`src/data-transfer/crypto/envelope.ts`), Ukrainian dataset |
| `kiko-demo-en.kiko` | Same, English dataset |
| `kiko-demo.key` | The base64 AES-256 key, **shared by both files** |
| `build-demo-snapshot.ts` | Pure mapper: `ScreenshotDataset` -> `DataSnapshot` (all 9 logical tables) |
| `generate-demo-kiko.ts` | Pure encoder: `DataSnapshot` + key -> the `.kiko` file's JSON, via the app's real `encryptEnvelope` |
| `generate-demo-kiko.test.ts` | REGEN (writes the fixtures) + GUARD (decrypts and diffs them against the current builder — this is what `make gate` runs on every future commit) |

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

Run this after any change to `screenshot-seed.ts` or `build-demo-snapshot.ts`:

```bash
KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts
```

`kiko-demo.key` is reused if already committed (a fresh key would make every
old fixture unreadable); a first-time run generates one and writes it. Both
`.kiko` files are always rewritten from the current dataset. The GUARD test
then re-runs automatically inside the same file and confirms both files
decrypt back to what the current builder produces — verify it passed before
committing.

Note: `encryptEnvelope` uses a fresh random nonce every call, so the
ciphertext bytes differ on every regen even when the underlying data is
unchanged — that is expected, not a bug.

## Importing on a device

Settings → Import data → pick the `.kiko` file → paste the key from
`kiko-demo.key` → Import → confirm the replace-everything warning → **cold
relaunch the app** (kill it fully, then reopen) so `applyPersistedLanguage`
(`src/migration/migrations-gate/migrations.gate.tsx`) picks up the imported
language on the next launch.
