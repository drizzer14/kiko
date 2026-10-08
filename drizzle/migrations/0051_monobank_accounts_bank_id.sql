/*
 Gives a bank account that is connected to Monobank the bank id `monobank`.

 Migration 0033 added a nullable `bank_id` with no backfill, so an account
 created before it names no bank, whatever its connection. 0049 then gave every
 bank account with no bank the id `other`, ignoring `institution`, so a
 Monobank account connected before the account form had a bank pick was stored
 as "Other bank": its statement import did not pre-select the Monobank parser,
 its saved column mapping was keyed on the file header rather than the bank,
 its form showed "Other bank", and after Disconnect it offered no Connect.
 `institution` is `monobank` while the account is connected (the provider id
 the sync writes), and Disconnect clears it, so it is the one record that the
 account is Monobank's.

 Data only, no schema change, so no snapshot JSON (same as 0039/0040/0042/0049).
 Only a `bank` account that is connected and still stored as `other` is
 touched: an account that names any other bank, one already stored as
 `monobank`, a bank account with no connection, and every other kind keep
 their value. One atomic UPDATE, so a crash leaves it either applied or not and
 there is no step order to protect. Idempotent: a second run finds no `other`
 account connected to Monobank. The restore path
 (`src/data-transfer/snapshot/restore-snapshot.ts`,
 `withBankAccountsBankIdBackfilled`) applies the identical rule to a `.kiko`
 import.
*/
UPDATE `accounts` SET `bank_id` = 'monobank' WHERE `kind` = 'bank' AND `institution` = 'monobank' AND `bank_id` = 'other';
