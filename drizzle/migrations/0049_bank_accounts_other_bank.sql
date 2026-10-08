/*
 Gives every bank account that names no bank the bank id `other`.

 The account form's "Free" choice (no bank, stored as NULL `bank_id`) became
 "Other bank", a real catalog entry listed last like the broker catalog's own
 `other`, and a new bank or broker account can no longer be saved without a
 pick (`src/bank-sync/bank-catalog/`). A stored `other` reads exactly as the
 NULL it replaces in every reader (statement format, live connection, metals,
 saved column mapping), so this only moves the account onto the choice the
 picker now shows.

 Data only, no schema change, so no snapshot JSON (same as 0039/0040/0042).
 Only a `bank` account is touched: a broker with no pick, and every other
 kind, keep their NULL, because a broker pick is required on create only and
 no other kind has a picker. A bank account that names a bank (listed or since
 removed) is never touched. Idempotent: a second run finds no NULL bank
 account. The restore path (`src/data-transfer/snapshot/restore-snapshot.ts`,
 `withBankAccountsOtherBank`) applies the identical rule to a `.kiko` import.
*/
UPDATE `accounts` SET `bank_id` = 'other' WHERE `kind` = 'bank' AND `bank_id` IS NULL;
