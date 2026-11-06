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

describe('indexed evaluation with the new kinds', () => {
  const NEW_RULES_PER_KIND = 20;
  const MERCHANT_CODES = [5411, 5812, 5541, 4121, 5912];
  const CONTAINED_TEXTS = ['silpo 17', 'atb 9', 'uber 4', 'bolt', 'нова', 'spotify 3', 'fora 1'];

  // Single-matcher rules updated after every fixture rule, so they win the rows nothing stronger
  // claims; the texts and codes derive from the index, with no draw from the fixture's generator.
  const containsRules = Array.from({ length: NEW_RULES_PER_KIND }, (_unused, index) => ({
    id: `contains-${index}`,
    category: `contains-category-${index % 4}`,
    matchers: JSON.stringify([
      { type: 'nameContains', text: CONTAINED_TEXTS[index % CONTAINED_TEXTS.length] },
    ]),
    createdAt: 10_000 + index,
    updatedAt: 10_000 + index,
  }));
  const codeRules = Array.from({ length: NEW_RULES_PER_KIND }, (_unused, index) => ({
    id: `code-${index}`,
    category: `code-category-${index % 4}`,
    matchers: JSON.stringify([
      { type: 'mcc', code: MERCHANT_CODES[index % MERCHANT_CODES.length] },
    ]),
    createdAt: 20_000 + index,
    updatedAt: 20_000 + index,
  }));
  const ownRules = [...containsRules, ...codeRules];
  const withNewKinds = prepareRules([...rules, ...ownRules]);

  it('picks the same winner as a scan of every rule, for every row of the batch, with the new kinds', () => {
    const winners = batchSubjects.map((subject) => winningRule(withNewKinds, subject));
    const disagreements = batchSubjects.filter(
      (subject, position) =>
        winners[position] !== withNewKinds.ordered.find((rule) => matchesRule(rule, subject)),
    );
    const winnerIds = new Set(winners.map((rule) => rule?.id));

    expect(withNewKinds.unreadable).toEqual([]);
    expect(withNewKinds.ordered).toHaveLength(rules.length + ownRules.length);
    expect(disagreements).toEqual([]);
    expect(containsRules.some((rule) => winnerIds.has(rule.id))).toBe(true);
    expect(codeRules.some((rule) => winnerIds.has(rule.id))).toBe(true);
  });

  it('never evaluates more than the rules without a name plus the one named bucket, with the new kinds', () => {
    const largest = Math.max(
      ...batchSubjects.map((subject) => candidateRules(withNewKinds, subject).length),
    );

    expect(withNewKinds.byName.size).toBe(prepared.byName.size);
    expect(withNewKinds.withoutName).toHaveLength(prepared.withoutName.length + ownRules.length);
    expect(largest).toBeLessThanOrEqual(withNewKinds.withoutName.length + 1);
  });
});
