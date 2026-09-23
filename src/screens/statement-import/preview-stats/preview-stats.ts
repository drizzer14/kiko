import { formatDate } from '../../../dates/format';
import type { ParsedStatement, ParsedTransaction } from '../../../statement-import/parser';

export type PreviewStats = {
  displayName: string;
  transactionCount: number;
  currency: string;
  dateSpan: string;
  // Distinct masked-card hints across every parsed row, in first-seen order.
  // PrivatBank XLSX is the only format that ever produces one (section C.1,
  // a multi-card export) — every other shipped format's rows carry none, so
  // this is always `[]` for them.
  maskedCardHints: string[];
  // Rows this format's parse could not resolve (e.g. an unmapped PrivatBank
  // currency word) — excluded from `transactionCount` above, but surfaced
  // here rather than silently dropped (controller ruling 2).
  unresolvedRowCount: number;
  // Distinct currencies across every parsed row, in first-seen order (Task 3
  // review, CRITICAL fix) — a multi-card PrivatBank export can mix
  // currencies per row, and `importStatement` excludes any row whose
  // currency doesn't match the target holding's, so the user needs this
  // BEFORE picking a holding to pick one that actually matches.
  detectedCurrencies: string[];
  // The FIRST parsed row (on-file order, not chronological) — powers the
  // shared `ExampleTransaction` component (device-feedback-round-F1, items
  // 9/14), so the user sees a real example of what this statement/mapping
  // will actually write BEFORE tapping Import. Optional (rather than a
  // required `| undefined` field) so an existing test object literal built
  // before this field existed still type-checks; absent for an empty parse
  // (0 transactions), which renders nothing.
  firstTransaction?: ParsedTransaction;
};

/**
 * The preview's transaction-count/date-span/currency block, derived from an
 * ALREADY-PARSED `ParsedStatement` — `timeSeconds` reduces to the min/max
 * across every row, not just the first/last row's on-file order, so an
 * out-of-order export still reports its true span. `displayName` is the
 * caller's own label for the statement (a bank format's `displayName` for
 * `statement-import.screen.tsx`; the column-mapping screen has no dedicated
 * `StatementFormat` to read one from, so it passes its own label instead).
 *
 * A pure transform over data the caller has already resolved — unlike the
 * former `previewStats(format, input)` this replaced, it never parses (and
 * so never needs to catch a parse failure) itself; each caller owns running
 * `format.parse`/`applyColumnMapping` and handling ITS OWN failure mode.
 * Extracted out of `statement-import.screen.tsx` so `column-mapping.screen.tsx`
 * can share it rather than reimplementing the same reduction.
 */
export const previewStats = (parsed: ParsedStatement, displayName: string): PreviewStats => {
  const times = parsed.transactions.map((transaction) => transaction.timeSeconds);
  const minSeconds = Math.min(...times);
  const maxSeconds = Math.max(...times);
  const maskedCardHints = Array.from(
    new Set(
      parsed.transactions
        .map((transaction) => transaction.maskedCardHint)
        .filter((hint): hint is string => hint !== undefined),
    ),
  );
  const detectedCurrencies = Array.from(
    new Set(parsed.transactions.map((transaction) => transaction.currency)),
  );

  return {
    displayName,
    transactionCount: parsed.transactions.length,
    currency: parsed.account.currency,
    dateSpan: `${formatDate(minSeconds * 1000)} – ${formatDate(maxSeconds * 1000)}`,
    maskedCardHints,
    unresolvedRowCount: parsed.unresolvedRows?.length ?? 0,
    detectedCurrencies,
    firstTransaction: parsed.transactions.at(0),
  };
};
