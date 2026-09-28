/*
 Release 1.0 let a cash account hold a BTC/ETH/USDT `cash` holding — a
 combination no create path allows any more (`isCurrencyAllowedForHoldingType`
 restricts a `cash` holding to fiat). This migration moves every such
 holding onto a `crypto_asset` holding under a crypto account, keeping its
 `id` — so every transaction, exchange counterpart, loan link, `price_points`
 row (`holding:<id>`), and category override attached to it stays attached
 without being touched.

 WHICH HOLDINGS: `holdings.type = 'cash' AND currency IN ('BTC', 'ETH',
 'USDT')` — the frozen crypto set a 1.0 build could ever have created
 (`currency.ts`'s `cryptoCurrencyOptions`; pinned by a test that fails the
 day a crypto currency is added, forcing a deliberate decision then).
 Selection is BY HOLDING, whatever account it sits under, so a stray
 non-cash account can never leave a holding with no target — which would
 fail the `NOT NULL account_id` constraint and strand `MigrationsGate`.

 TARGET ACCOUNT (the matching rule): reuse the FIRST eligible crypto
 account — `kind = 'crypto' AND institution IS NULL AND archived_at IS
 NULL`, ordered `(sort_order, created_at, id)` — captured into a TEMP table
 BEFORE any account is created, so a just-created account is never mistaken
 for a pre-existing one. `institution IS NULL` excludes a synced account
 (Binance, btc_wallet): the balance sync owns its holdings, and an archived
 account is excluded because the holding would vanish from view. Otherwise,
 ONE new account per affected source account: `id = 'crypto-from-' ||
 <source account id>` — deterministic, so this SQL and the restore mirror
 (`restore-snapshot.ts`'s `withCryptoCashHoldingsMoved`) produce the SAME
 id — named, sorted, and dated after the source. `INSERT OR IGNORE` on that
 id makes a second run of this file a no-op for the insert step, and the
 id's own format (see that mirror's own doc comment) can never collide with
 a real UUID account id.

 WHAT CHANGES ON THE HOLDING: only `account_id` and `type` (`crypto_asset`).
 Every other column — id, name, currency, balance, `balance_set_at`,
 metadata, icon/color, sort_order, closed_at, created_at — rides along
 unchanged, so nothing that references the holding by id ever needs to move.

 CRASH-SAFE, IDEMPOTENT ORDER (matches `0042`'s derive-then-mutate shape):
 the TEMP snapshot of the affected set is taken first, then the additive
 `INSERT OR IGNORE` of accounts, then the `UPDATE` of the holdings — no
 DELETE anywhere. `run-migrations.ts` wraps this whole file in one
 transaction, so a crash mid-run rolls back cleanly; re-running the file
 finds no `cash` + crypto rows left and inserts/updates nothing.

 The emptied cash account is left in place (non-destructive; the user can
 delete it).

 RESTORE MIRROR: `restore-snapshot.ts`'s `withCryptoCashHoldingsMoved`
 applies the IDENTICAL rule to a `.kiko` restore, replacing the outright
 refusal (`rejectCryptoCashHolding`) that path used to throw. Next free
 migration index: 0045.
*/
CREATE TEMP TABLE crypto_cash_move AS
  SELECT h.id AS holding_id, h.account_id AS source_account_id
  FROM holdings h
  WHERE h.type = 'cash' AND h.currency IN ('BTC', 'ETH', 'USDT');
--> statement-breakpoint
CREATE TEMP TABLE crypto_cash_reuse AS
  SELECT id FROM accounts
  WHERE kind = 'crypto' AND institution IS NULL AND archived_at IS NULL
  ORDER BY sort_order, created_at, id LIMIT 1;
--> statement-breakpoint
INSERT OR IGNORE INTO accounts (id, name, kind, institution, bank_id, icon, color, sort_order, archived_at, created_at)
  SELECT 'crypto-from-' || a.id, a.name, 'crypto', NULL, NULL, NULL, NULL, a.sort_order, a.archived_at, a.created_at
  FROM accounts a
  WHERE a.id IN (SELECT source_account_id FROM crypto_cash_move)
    AND NOT EXISTS (SELECT 1 FROM crypto_cash_reuse);
--> statement-breakpoint
UPDATE holdings
  SET account_id = COALESCE((SELECT id FROM crypto_cash_reuse), 'crypto-from-' || account_id),
      type = 'crypto_asset'
  WHERE id IN (SELECT holding_id FROM crypto_cash_move);
--> statement-breakpoint
DROP TABLE crypto_cash_move;
--> statement-breakpoint
DROP TABLE crypto_cash_reuse;
