/*
 Health category icon refinement.

 0002 seeds the ten categories, seeding `health` with the `cross.case`
 icon. The app-wide icon rework changes the Health default to `cross`,
 so this data-only migration refines already-seeded rows to match.

 Guarded on the seeded value (`icon = 'cross.case'`) so it only touches a
 row that still holds the seeded default: this converges both a fresh
 install (seeded by 0002 with `cross.case`) and a database upgraded from
 the old app, while preserving any icon a user picked themselves. Same
 shape as 0017's `transport` `car`->`bus` refinement. Data-only migration
 (no schema change), so it is hand-authored and carries no meta snapshot.
*/
UPDATE `categories` SET `icon` = 'cross' WHERE `key` = 'health' AND `icon` = 'cross.case';
