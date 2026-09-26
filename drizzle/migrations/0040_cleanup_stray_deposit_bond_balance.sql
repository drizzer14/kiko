/*
 One-time cleanup for a stray deposit/bond opening-balance write left by a
 create-time bug fixed in 63f9073 (`fix(forms): deposit/bond create writes no
 hidden opening balance`): the pre-fix create path read the Card balance
 field's live value even for a term_deposit/bond holding — both LEDGERLESS
 types whose value derives entirely from their own metadata (contributions/
 lots), never a ledger — so switching from Card to Deposit/Bond after typing a
 balance carried that value into the new holding's `balance_minor_units`,
 plus a stray `source = 'manual'` opening transaction and a `balance_set_at`
 stamp (`holdingsRepo.create`, unchanged by the fix — only its CALLERS
 changed).

 Post-fix, `use-term-deposit-fields.ts`/`use-bond-fields.ts`'s `createPayload`
 always writes `balanceMinorUnits: 0`, and every EDIT of a ledgerless holding
 (`saveMetadataEdit`) never touches `balance_minor_units` at all — so a
 term_deposit/bond row with a non-zero `balance_minor_units` AND a set
 `balance_set_at` cannot be produced by any current code path. This
 migration stays conservative anyway: it only touches a holding whose SOLE
 transaction row matches the EXACT shape the buggy create wrote (a 'manual'
 row with an empty description, no category, no exchange/change-group
 marker, its amount equal to the holding's own balance, its time equal to
 `balance_set_at`) — a holding with zero, two, or a differently-shaped
 transaction stays byte-identical, since none of those can be this
 create-time artifact. The restore path
 (`src/data-transfer/snapshot/restore-snapshot.ts`,
 `withStrayDepositBondBalanceCleaned`) applies the identical predicate to a
 `.kiko` import, mirroring the balanceSetAt/loan_interest precedent
 (migrations 0036/0039) for a data-only fix that must also cover restore.

 The snapshot into a TEMP table runs first so neither mutating statement
 below needs the ORIGINAL `balance_minor_units`/`balance_set_at` to still be
 in place — the holding reset and the transaction delete would otherwise
 race each other's own match condition (zeroing the holding first would
 break the delete's join; deleting the transaction first would break
 nothing, but the snapshot keeps both statements independent of order or a
 crash between them). Idempotent: a second run's snapshot is empty (a
 cleaned holding no longer matches `balance_minor_units != 0`), so both
 statements affect zero rows. The reset (denormalized display fields) runs
 before the delete (the actual ledger row, irreversible) — both inside the
 one transaction `run-migrations.ts` wraps this whole file in.
*/
CREATE TEMP TABLE IF NOT EXISTS `_stray_deposit_bond_0040` AS
SELECT `holdings`.`id` AS `holding_id`, `transactions`.`id` AS `transaction_id`
FROM `holdings`
JOIN `transactions` ON `transactions`.`holding_id` = `holdings`.`id`
WHERE `holdings`.`type` IN ('term_deposit', 'bond')
  AND `holdings`.`balance_minor_units` != 0
  AND `holdings`.`balance_set_at` IS NOT NULL
  AND `transactions`.`source` = 'manual'
  AND `transactions`.`description` = ''
  AND `transactions`.`category` IS NULL
  AND `transactions`.`exchange_counterpart_holding_id` IS NULL
  AND `transactions`.`change_group_id` IS NULL
  AND `transactions`.`amount_minor_units` = `holdings`.`balance_minor_units`
  AND `transactions`.`time` = `holdings`.`balance_set_at`
  AND (
    SELECT COUNT(*) FROM `transactions` AS `other`
    WHERE `other`.`holding_id` = `holdings`.`id`
  ) = 1;--> statement-breakpoint
UPDATE `holdings` SET `balance_minor_units` = 0, `balance_set_at` = NULL
WHERE `id` IN (SELECT `holding_id` FROM `_stray_deposit_bond_0040`);--> statement-breakpoint
DELETE FROM `transactions`
WHERE `id` IN (SELECT `transaction_id` FROM `_stray_deposit_bond_0040`);--> statement-breakpoint
DROP TABLE `_stray_deposit_bond_0040`;
