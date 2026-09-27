/*
 Seeds the eleventh default category, `loan_interest` — a linked loan
 payment's derived interest entry needs somewhere to file under.
 `INSERT OR IGNORE` keeps it idempotent and never overwrites a user's own
 same-keyed category; `sort_order` appends after every existing one
 (mirrors `accountsRepo`'s "max + 1" convention), even a reordered list.
*/
INSERT OR IGNORE INTO `categories` (`key`, `title`, `icon`, `color`, `sort_order`) VALUES ('loan_interest', 'Loan interest', 'percent', '#5E5CE6', (SELECT COALESCE(MAX(`sort_order`), -1) + 1 FROM `categories`));
