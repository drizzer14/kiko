import {
  merchantNameOf,
  merchantSpellingOf,
  smallestSpelling,
  tidiedNameOf,
} from '@kiko/transactions/merchant-name';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

import { winningRule } from './prepare-rules';
import { subjectOfStoredRow } from './rule-subject';
import { hasNoRealCategory, isRewriteEligible } from './plan-rule-rewrite';
import type { PreparedRules, ReviewCandidate, ReviewGroup } from './category-rules.d';

type DescribedName = {
  key: string;
  normalizedName: string;
  tidiedName: string;
  spelling: string;
};

type NameTally = { rowCount: number; tidiedName: string };

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
    groups.set(name.key, {
      rowCount: 1,
      newestTime: row.time,
      prefixSpelling: name.spelling,
      names: new Map([[name.normalizedName, { rowCount: 1, tidiedName: name.tidiedName }]]),
    });

    return;
  }

  group.rowCount += 1;
  group.newestTime = Math.max(group.newestTime, row.time);
  group.prefixSpelling = smallestSpelling([group.prefixSpelling, name.spelling]);

  const tally = group.names.get(name.normalizedName);

  if (tally === undefined) {
    group.names.set(name.normalizedName, { rowCount: 1, tidiedName: name.tidiedName });

    return;
  }

  tally.rowCount += 1;
  tally.tidiedName = smallestSpelling([tally.tidiedName, name.tidiedName]);
};

// Compared by code unit, never by locale, so the order cannot depend on the device.
const byCodeUnit = (first: string, second: string): number => {
  if (first === second) {
    return 0;
  }

  return first < second ? -1 : 1;
};

const reviewGroupOf = (key: string, group: GroupTally): ReviewGroup => {
  const names = [...group.names.entries()]
    .sort(
      ([firstName, first], [secondName, second]) =>
        second.rowCount - first.rowCount || byCodeUnit(firstName, secondName),
    )
    .map(([, tally]) => tally.tidiedName);
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
  };
};

// The rows the app can still file on its own, grouped by merchant. The cheap field checks run
// before the rule match, and each distinct description is read once: a ledger repeats a few
// thousand descriptions over every row it holds.
export const planReviewGroups = (
  prepared: PreparedRules,
  rows: readonly ReviewCandidate[],
  knownCategoryKeys: ReadonlySet<string>,
): ReviewGroup[] => {
  const describedNames = new Map<string, DescribedName>();
  const groups = new Map<string, GroupTally>();

  const describe = (description: string): DescribedName => {
    const known = describedNames.get(description);

    if (known !== undefined) {
      return known;
    }

    const described = {
      key: merchantNameOf(description).key,
      normalizedName: normalizeTransactionName(description),
      tidiedName: tidiedNameOf(description),
      spelling: merchantSpellingOf(description),
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

  return [...groups.entries()]
    .map(([key, group]) => reviewGroupOf(key, group))
    .sort(
      (first, second) =>
        second.rowCount - first.rowCount ||
        second.newestTime - first.newestTime ||
        byCodeUnit(first.key, second.key),
    );
};
