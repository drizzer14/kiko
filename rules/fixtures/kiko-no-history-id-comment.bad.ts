// Semgrep fixture (POSITIVE): kiko-code-style's "Comments: WHY only, never
// history" bans a task id, review-round id, spec/decision id, or bug number
// left behind in a comment. `kiko-no-history-id-comment` MUST report a
// finding on each pinned line below, in both a `//` line comment and a
// `/* */` block comment.

// EXPECT-FINDING
// T25 review round 1, I1/I3: splitting this into three effects fixed the
// cross-talk between the ISIN lookup and the purchase-date default.
export const splitEffectReasons = (): string[] => ['isin', 'purchaseDate', 'register'];

/**
 * EXPECT-FINDING
 * The eleventh default category (T30, spec 5/D14) was seeded by its own
 * later migration, not the original ten.
 */
export const defaultCategoryCount = 11;

// EXPECT-FINDING
// USER-DECISION: keep the manual override once a synced value disagrees.
export const keepManualOverride = true;

// EXPECT-FINDING
// Filed as bug 42 — the chunk size must derive from the table's own column
// count, not a fixed row constant.
export const chunkSafetyMargin = 4;
