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

// A `// EXPECT-FINDING` pin only recognizes a `//`/`#` line directly above
// it — a `* EXPECT-FINDING` line INSIDE a block comment (as above) is never
// recognized, so it never actually proves the block-comment arm still
// fires. This single-line block comment gives that arm a working pin.
// EXPECT-FINDING
/* T12: superseded by the shared retry helper. */
export const blockCommentPinnedFinding = 1;

// EXPECT-FINDING
// R2-1: the retry budget is per-connection, not global.
export const retryBudgetPerConnection = 3;

// EXPECT-FINDING
// F3 device feedback: the label wraps onto two lines on a narrow device.
export const wrapsOnNarrowDevice = true;

// EXPECT-FINDING
// G2: the border now paints on the first frame, not only after a re-render.
export const bordersOnFirstFrame = true;

// EXPECT-FINDING
// C1: the unique index must exclude a soft-deleted row.
export const indexExcludesSoftDeleted = true;

// EXPECT-FINDING
// Task 5: the picker defaults to the account's own currency.
export const pickerDefaultsToAccountCurrency = true;

// EXPECT-FINDING
// Phase 2 (Task 3): the three FOP CSV formats share one column base.
export const fopFormatsShareColumnBase = true;

// EXPECT-FINDING
// Review Focus 4: a sell delta larger than the held quantity is rejected.
export const rejectsOversizedSellDelta = true;

// EXPECT-FINDING
// Minor 6: a loan's field label reads correctly for a debt too.
export const loanLabelReadsForDebt = true;

// EXPECT-FINDING
// audit 12: the divergent copy of this helper lacked the metal branch.
export const includesMetalBranch = true;

// EXPECT-FINDING
// RULING R2: a rate table lookup throws on a missing pair instead of
// defaulting to zero.
export const throwsOnMissingRatePair = true;

// EXPECT-FINDING
// fix round 1: the sheet reuses the existing instance instead of pushing a
// duplicate.
export const reusesExistingInstance = true;

// EXPECT-FINDING
// round-3 item 2: the capability icons sit at the far right of the option.
export const capabilityIconsAlignRight = true;

// EXPECT-FINDING
// device-feedback-round-4 item 9: the group moves to sit directly below
// System.
export const groupSitsBelowSystem = true;

// EXPECT-FINDING
// on-device review: the flat, all-scrolling sheet read as unreadable.
export const sheetKeepsFixedHeader = true;
