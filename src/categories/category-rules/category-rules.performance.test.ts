import { subjectOfStoredRow } from './rule-subject';
import { buildRulesPerformanceFixture } from './__fixtures__/rules-performance-fixture';
import { candidateRules, matchesRule, prepareRules, winningRule } from './prepare-rules';

const BATCH_SIZE = 10_000;

const { rules, rows } = buildRulesPerformanceFixture();
const prepared = prepareRules(rules);
const batchSubjects = rows.slice(0, BATCH_SIZE).map(subjectOfStoredRow);

describe('rules performance fixture', () => {
  it('has the documented shape', () => {
    const flaggedCount = rows.filter((row) => row.categorySetByHand).length;

    expect(rows).toHaveLength(50_000);
    expect(new Set(rows.map((row) => row.description)).size).toBeGreaterThan(1_900);
    expect(new Set(rows.map((row) => row.currency))).toEqual(
      new Set(['UAH', 'USD', 'EUR', 'GBP', 'BTC']),
    );
    expect(flaggedCount).toBeGreaterThan(4_500);
    expect(flaggedCount).toBeLessThan(5_500);
    expect(rules).toHaveLength(200);
    expect(prepared.unreadable).toEqual([]);
    expect(prepared.ordered).toHaveLength(200);
    expect(prepared.byName.size).toBe(120);
    expect(prepared.withoutName).toHaveLength(80);
  });

  it('is the same on every build', () => {
    expect(buildRulesPerformanceFixture()).toEqual({ rules, rows });
  });
});

describe('indexed evaluation', () => {
  it('picks the same winner as a scan of every rule, for every row of the batch', () => {
    const disagreements = batchSubjects.filter(
      (subject) =>
        winningRule(prepared, subject) !==
        prepared.ordered.find((rule) => matchesRule(rule, subject)),
    );

    expect(disagreements).toEqual([]);
  });

  it('exercises rows no rule wins, name-indexed winners and unindexed winners', () => {
    const winners = batchSubjects.map((subject) => winningRule(prepared, subject));
    const indexedWinners = winners.filter(
      (rule) => rule !== undefined && !prepared.withoutName.includes(rule),
    );
    const unindexedWinners = winners.filter(
      (rule) => rule !== undefined && prepared.withoutName.includes(rule),
    );

    expect(winners.some((rule) => rule === undefined)).toBe(true);
    expect(indexedWinners.length).toBeGreaterThan(100);
    expect(unindexedWinners.length).toBeGreaterThan(100);
  });

  it('hands a row whose name no nameIs rule has exactly the rules without a name', () => {
    const unnamed = batchSubjects.filter((subject) => !prepared.byName.has(subject.normalizedName));
    const wrongCount = unnamed.filter(
      (subject) => candidateRules(prepared, subject).length !== prepared.withoutName.length,
    );

    expect(unnamed.length).toBeGreaterThan(8_000);
    expect(wrongCount).toEqual([]);
  });

  it('never evaluates more than the rules without a name plus the one named bucket', () => {
    const largest = Math.max(
      ...batchSubjects.map((subject) => candidateRules(prepared, subject).length),
    );

    expect(largest).toBeLessThanOrEqual(prepared.withoutName.length + 1);
  });
});
