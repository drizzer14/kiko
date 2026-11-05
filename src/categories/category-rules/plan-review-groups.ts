import maybe, { foldMap } from 'fnts/maybe';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';
import { merchantNameOf, smallestSpelling, tidiedNameOf } from '@kiko/transactions/merchant-name';

import type {
  PreparedRules,
  ReviewCandidate,
  ReviewEvidence,
  ReviewGroup,
  ReviewSuggestion,
} from './category-rules.d';
import { winningRule } from './prepare-rules';
import { categoryKeyOf } from './same-category';
import { subjectOfStoredRow } from './rule-subject';
import { hasNoRealCategory, isRewriteEligible } from './plan-rule-rewrite';
import { addToNameTally, compareByCodeUnit, rankedNames, type NameTally } from './name-tally';

// One row is a lone pick, not a pattern; from four rows one stray row passes, from two or three
// any dissent stops the suggestion.
export const SUGGESTION_MIN_AGREEING_ROWS = 2;
export const SUGGESTION_MIN_SHARE = 0.75;

type DescribedName = {
  key: string;
  normalizedName: string;
  tidiedName: string;
  spelling: string;
};

type GroupTally = {
  rowCount: number;
  newestTime: number;
  prefixSpelling: string;
  names: Map<string, NameTally>;
};

const isFileable = (row: ReviewCandidate, knownCategoryKeys: ReadonlySet<string>): boolean =>
  row.exchangeCounterpartHoldingId === null &&
  row.untrackedCounterpart === null &&
  hasNoRealCategory(row, knownCategoryKeys) &&
  isRewriteEligible(row);

const addToGroup = (
  groups: Map<string, GroupTally>,
  row: ReviewCandidate,
  name: DescribedName,
): void => {
  const group = groups.get(name.key);

  if (group === undefined) {
    const created: GroupTally = {
      rowCount: 1,
      newestTime: row.time,
      prefixSpelling: name.spelling,
      names: new Map(),
    };

    addToNameTally(created.names, name.normalizedName, name.tidiedName);
    groups.set(name.key, created);

    return;
  }

  group.rowCount += 1;
  group.newestTime = Math.max(group.newestTime, row.time);
  group.prefixSpelling = smallestSpelling([group.prefixSpelling, name.spelling]);
  addToNameTally(group.names, name.normalizedName, name.tidiedName);
};

const reviewGroupOf = (
  key: string,
  group: GroupTally,
  suggestion: ReviewSuggestion | null,
): ReviewGroup => {
  const names = rankedNames(group.names);
  const [onlyName] = names;

  return {
    key,
    names,
    rowCount: group.rowCount,
    newestTime: group.newestTime,
    rule:
      names.length === 1 && onlyName !== undefined
        ? { kind: 'nameIs', text: onlyName }
        : { kind: 'nameStartsWith', text: group.prefixSpelling },
    suggestion,
  };
};

// Category key -> rows, for the real-category rows of one merchant.
type Votes = Map<string, number>;

const addVotes = (
  votesByMerchant: Map<string, Votes>,
  merchantKey: string,
  row: ReviewEvidence,
): void => {
  const votes = votesByMerchant.get(merchantKey) ?? new Map<string, number>();
  const categoryKey = categoryKeyOf(row.categoryKey);

  votes.set(categoryKey, (votes.get(categoryKey) ?? 0) + row.rowCount);
  votesByMerchant.set(merchantKey, votes);
};

// The most rows win; a tie goes to the smaller key by code unit, so the pick never depends on
// the order the evidence arrived in.
const topVoteOf = (
  top: readonly [string, number],
  vote: readonly [string, number],
): readonly [string, number] =>
  vote[1] > top[1] || (vote[1] === top[1] && compareByCodeUnit(vote[0], top[0]) < 0) ? vote : top;

const suggestionOf = (votes: Votes): ReviewSuggestion | null => {
  const total = [...votes.values()].reduce((sum, count) => sum + count, 0);
  const [category, agreeing] = [...votes.entries()].reduce(topVoteOf, ['', 0]);

  return agreeing >= SUGGESTION_MIN_AGREEING_ROWS && agreeing / total >= SUGGESTION_MIN_SHARE
    ? { category, agreeing, total }
    : null;
};

// The rows the app can still file on its own, grouped by merchant. The cheap field checks run
// before the rule match, and each distinct description is read once: a ledger repeats a few
// thousand descriptions over every row it holds. A group also carries the category most of its
// merchant's filed rows hold, when enough of them agree: only a suggestion, never a write.
export const planReviewGroups = (
  prepared: PreparedRules,
  rows: readonly ReviewCandidate[],
  knownCategoryKeys: ReadonlySet<string>,
  evidence: readonly ReviewEvidence[],
): ReviewGroup[] => {
  const merchants = new Map<string, ReturnType<typeof merchantNameOf>>();
  const describedNames = new Map<string, DescribedName>();
  const groups = new Map<string, GroupTally>();
  const votesByMerchant = new Map<string, Votes>();

  const merchantOf = (description: string): ReturnType<typeof merchantNameOf> => {
    const known = merchants.get(description) ?? merchantNameOf(description);

    merchants.set(description, known);

    return known;
  };

  const describe = (description: string): DescribedName => {
    const known = describedNames.get(description);

    if (known !== undefined) {
      return known;
    }

    const merchant = merchantOf(description);
    const tidiedName = tidiedNameOf(description);
    const described = {
      key: merchant.key,
      normalizedName: normalizeTransactionName(description),
      tidiedName,
      spelling: merchant.prefix ?? tidiedName,
    };

    describedNames.set(description, described);

    return described;
  };

  for (const row of rows.filter((candidate) => isFileable(candidate, knownCategoryKeys))) {
    const name = describe(row.description);

    if (name.key !== '' && winningRule(prepared, subjectOfStoredRow(row)) === undefined) {
      addToGroup(groups, row, name);
    }
  }

  for (const row of evidence) {
    const merchantKey = merchantOf(row.description).key;

    if (
      groups.has(merchantKey) &&
      !hasNoRealCategory({ category: row.categoryKey }, knownCategoryKeys)
    ) {
      addVotes(votesByMerchant, merchantKey, row);
    }
  }

  return [...groups.entries()]
    .map(([key, group]) =>
      reviewGroupOf(key, group, foldMap(maybe(votesByMerchant.get(key)), suggestionOf) ?? null),
    )
    .sort(
      (first, second) =>
        second.rowCount - first.rowCount ||
        second.newestTime - first.newestTime ||
        compareByCodeUnit(first.key, second.key),
    );
};
