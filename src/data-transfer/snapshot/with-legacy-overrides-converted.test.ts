// The pure mirror of migration 0056's copy of every override into a rule. The migration's own
// test (`drizzle/migrations/0056-add-category-rules.test.ts`) holds the same cases against the
// real SQL, and `restore-category-rules.two-path.test.ts` proves both agree on one database.
import { parseRuleMatchers } from '@kiko/categories/category-rules';

import { withLegacyOverridesConverted } from './with-legacy-overrides-converted';

const NOW = 9_000;

const override = (displayName: string, extra: { createdAt?: number; updatedAt?: number } = {}) => ({
  normalizedName: displayName.trim().toLowerCase(),
  category: 'food',
  displayName,
  ...extra,
});

describe('withLegacyOverridesConverted', () => {
  it('makes one rule per override with its category and timestamps', () => {
    const rules = withLegacyOverridesConverted(
      [
        { ...override('Silpo', { createdAt: 1_000, updatedAt: 2_000 }), category: 'groceries' },
        override('Atb', { createdAt: 1_100, updatedAt: 2_100 }),
      ],
      NOW,
    );

    expect(
      rules.map(({ category, createdAt, updatedAt }) => ({ category, createdAt, updatedAt })),
    ).toEqual([
      { category: 'groceries', createdAt: 1_000, updatedAt: 2_000 },
      { category: 'food', createdAt: 1_100, updatedAt: 2_100 },
    ]);
  });

  it('stores one nameIs matcher whose text is the display name', () => {
    const rules = withLegacyOverridesConverted([override('ATB  MaRKet'), override('Сільпо')], NOW);

    expect(rules.map((rule) => parseRuleMatchers(rule.matchers))).toEqual([
      [{ type: 'nameIs', text: 'ATB  MaRKet' }],
      [{ type: 'nameIs', text: 'Сільпо' }],
    ]);
  });

  it('reads a missing timestamp as the time given', () => {
    const [rule] = withLegacyOverridesConverted([override('Silpo')], NOW);

    expect(rule).toMatchObject({ createdAt: NOW, updatedAt: NOW });
  });

  it('gives every rule a fresh id of its own', () => {
    const rules = withLegacyOverridesConverted(
      [override('Silpo'), override('Atb'), override('Rozetka')],
      NOW,
    );

    expect(new Set(rules.map((rule) => rule.id)).size).toBe(3);
    expect(rules.every((rule) => rule.id !== '')).toBe(true);
  });

  it('still converts an override with a blank display name, into a rule that fails the guard', () => {
    const [rule] = withLegacyOverridesConverted([override('   ')], NOW);

    expect(rule).toMatchObject({ category: 'food' });
    expect(parseRuleMatchers(rule.matchers)).toBeNull();
  });

  it('converts no overrides into no rules', () => {
    expect(withLegacyOverridesConverted([], NOW)).toEqual([]);
  });
});
