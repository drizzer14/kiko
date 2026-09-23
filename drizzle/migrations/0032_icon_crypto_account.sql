/*
 Crypto account icon refinement.

 The account form persists the kind-default icon at create time (never
 null on create), so existing un-customized crypto accounts store
 `bitcoinsign`. The app-wide icon rework changes the crypto account
 default to `bitcoinsign.circle`, so this data-only migration refines
 already-created rows to match.

 Guarded on the created default (`kind = 'crypto' AND icon =
 'bitcoinsign'`) so it only touches a row that still holds the created
 default, preserving any icon a user picked themselves and never touching
 a non-crypto account that happens to hold the same glyph. Idempotent: a
 re-run matches nothing once the row already reads `bitcoinsign.circle`.
 Data-only migration (no schema change), so it is hand-authored and
 carries no meta snapshot — same shape as 0031.
*/
UPDATE `accounts` SET `icon` = 'bitcoinsign.circle' WHERE `kind` = 'crypto' AND `icon` = 'bitcoinsign';
