/*
 Adds the one-shot flag the app-open lot recost runs under
 (`holdings/lot-recost/`'s `recostStoredLots`). The recost itself is NOT
 SQL: a sale's cost is the average cost held before it, worked out with the
 BigInt decimal helpers in JS (`recostLots`, `holdings/lots/lot-change.ts`),
 so it runs as a JS pass over every stored lot list, once, after this column
 exists. Defaults to `false` (unrun); that step sets it to `true` in the same
 transaction that writes the recosted lots, mirroring the `false`-until-run
 shape of `import_times_rezoned` (migration 0043).
*/
ALTER TABLE `settings` ADD `lots_recosted` integer DEFAULT false NOT NULL;
