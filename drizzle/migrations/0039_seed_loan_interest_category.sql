/*
 Loan interest category (T30, spec 5 / D14 — "interest-only spending").

 A payment linked to a loan holding (`transactions.loan_holding_id`, T29)
 never counts its principal as spending — only its INTEREST portion does
 (`loanInterestForPaymentMinor`, src/holdings/loan-schedule/). The derived
 interest entry needs a category to show up under, so this migration seeds
 an ELEVENTH default category, in its OWN later migration than 0002's
 original ten — the same "seed lives in a distinct, later journal entry"
 shape 0002 itself relies on (categories.repo.test.ts).

 Guarded with `INSERT OR IGNORE` so it is idempotent (a re-applied or
 already-migrated database is unaffected) and never overwrites a user's own
 `loan_interest`-keyed category, however unlikely that collision is.
 `sort_order` is computed as one past the CURRENT max at migration time
 (mirrors `accountsRepo`'s own "append at max + 1" convention), so it lands
 after every existing category — including a user's own reordering —
 instead of tying with `groceries` at the schema's default 0. `color` is
 `entityColors.indigo` (src/design-system/palette.ts), the next unused token
 0017_default_category_colors left unpainted. Data-only migration (no schema
 change), so it is hand-authored and carries no meta snapshot — same shape
 as 0017/0031's category refinements.
*/
INSERT OR IGNORE INTO `categories` (`key`, `title`, `icon`, `color`, `sort_order`) VALUES ('loan_interest', 'Loan interest', 'percent', '#5E5CE6', (SELECT COALESCE(MAX(`sort_order`), -1) + 1 FROM `categories`));
