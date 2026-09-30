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

// EXPECT-FINDING
// Requirement B: only a cash source is create-eligible for Exchange.
export const onlyCashCreateEligible = true;

// EXPECT-FINDING
// controller ruling 2: an unresolved row is surfaced, never silently dropped.
export const unresolvedRowsSurfaced = true;

// EXPECT-FINDING
// PrivatBank's export carries no MCC (section C.1) — every row maps to null.
export const noMccMapsToNull = true;

// EXPECT-FINDING
// the task brief is explicit: do not change the shared row for one caller.
export const sharedRowStaysUnchanged = true;

// EXPECT-FINDING
// per the parity brief's own note, this table only ever grows.
export const tableOnlyEverGrows = true;

// EXPECT-FINDING
// per the brief, this cache never evicts a warm entry early.
export const cacheNeverEvictsWarmEntry = true;

// EXPECT-FINDING
// the brief's residual gap is what this member closes.
export const residualGapClosedByThisMember = true;

// EXPECT-FINDING
// SYNC-1: the failed card's own retry window must never widen past what the
// failed run itself covered.
export const failedRetryNeverWidensPastItsOwnRun = true;

// EXPECT-FINDING
// DEPS-3: the lockfile diff must be reviewed before a version bump lands.
export const lockfileDiffReviewedBeforeBump = true;

// EXPECT-FINDING
// A negative balance is rejected (review decision 18), never clamped to 0.
export const negativeBalanceRejected = true;

// EXPECT-FINDING
// Decision 6: an archived category keeps its own sort position.
export const archivedCategoryKeepsPosition = true;

// EXPECT-FINDING
// The icon rename lands in a separate commit so this diff stays reviewable.
export const iconRenameLandsSeparately = true;

// EXPECT-FINDING
// The legacy column is dropped in a follow-up commit, once nothing reads it.
export const legacyColumnDroppedLater = true;

// EXPECT-FINDING
// The rows stay unsorted, per the plan's disposition for this import.
export const rowsStayUnsorted = true;

// EXPECT-FINDING
// Keep the plan doc's exports stable: the picker reads them by name.
export const pickerReadsExportsByName = true;

// EXPECT-FINDING
/* Only one pool per kind, as confirmed by the plan. */
export const onePoolPerKind = true;

// EXPECT-FINDING
// Section C.2: the export's own date column is already in the local zone.
export const dateColumnIsLocal = true;

// EXPECT-FINDING
// The opening balance stays editable after creation (section 6.2).
export const openingBalanceStaysEditable = true;

// EXPECT-FINDING
// The picker lists every currency, not only the account's own (§2.1).
export const pickerListsEveryCurrency = true;

// EXPECT-FINDING
/* Section 12.4 keeps the fee on its own line. */
export const feeOnItsOwnLine = true;

// EXPECT-FINDING
/* Rows without a counterparty stay in the list (§3). */
export const rowsWithoutCounterpartyStay = true;

// EXPECT-FINDING
// The icon rename and the copy fix land in separate commits.
export const iconRenameAndCopyFixSplit = true;

// EXPECT-FINDING
// A pending row keeps its own amount (§ 4).
export const pendingRowKeepsAmount = true;

// EXPECT-FINDING
/* The fee row stays hidden (§ 2.3). */
export const feeRowStaysHidden = true;

// EXPECT-FINDING
// Only the checking account is imported in this plan.
export const onlyCheckingImported = true;

// EXPECT-FINDING
// The field keeps its label; this plan also ships the picker sheet.
export const fieldKeepsLabel = true;

// EXPECT-FINDING
// Every account shares one sync cursor (2026-09-11 multi-account plan).
export const accountsShareCursor = true;

// EXPECT-FINDING
/* One row per account (2026-09-11 multi-account plan). */
export const oneRowPerAccount = true;

// EXPECT-FINDING
// The tooltip clears on the next tap (T-32).
export const tooltipClearsOnNextTap = true;

// EXPECT-FINDING
/* The legend keeps its order (M-3). */
export const legendKeepsOrder = true;

// EXPECT-FINDING
// Regression guard (NEW-1): the end tick reads the picked day.
export const endTickReadsPickedDay = true;

// EXPECT-FINDING
/* The start tick reads the picked day (NEW-12). */
export const startTickReadsPickedDay = true;

// EXPECT-FINDING
// The two rows draw the same chip at the same spacing (user request
// 2026-09-30).
export const rowsShareChip = true;

// EXPECT-FINDING
// A chevron after a switch keeps a small gutter (user
// feedback 2026-09-30).
export const chevronKeepsGutter = true;

// EXPECT-FINDING
/* The heading tile is one step smaller (user request 2026-09-30). */
export const headingTileSmaller = true;

// EXPECT-FINDING
/* The title and the body sit one step apart (user
 * feedback 2026-09-30). */
export const titleBodyApart = true;

// EXPECT-FINDING
// The toggle is taller than a body line; the user asked for every switch
// centered on its label.
export const switchCenteredOnLabel = true;

// EXPECT-FINDING
// The user asked for the weekday chip size here, so the grid matches it.
export const gridMatchesWeekdayChip = true;
