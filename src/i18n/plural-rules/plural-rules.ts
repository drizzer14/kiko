type PluralCategory = Intl.LDMLPluralRule;

const UKRAINIAN_CATEGORIES: PluralCategory[] = ['one', 'few', 'many', 'other'];
const DEFAULT_CATEGORIES: PluralCategory[] = ['one', 'other'];

/** The CLDR cardinal plural category of `count` in Ukrainian. */
export const ukrainianCardinalCategory = (count: number): PluralCategory => {
  const whole = Math.abs(count);

  if (!Number.isInteger(whole)) {
    return 'other';
  }

  const lastDigit = whole % 10;
  const lastTwoDigits = whole % 100;

  if (lastDigit === 1 && lastTwoDigits !== 11) {
    return 'one';
  }

  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return 'few';
  }

  return 'many';
};

const defaultCategory = (count: number): PluralCategory => (count === 1 ? 'one' : 'other');

/** The part of `Intl.PluralRules` that i18next calls. */
class FallbackPluralRules {
  private readonly isUkrainianCardinal: boolean;

  constructor(locale?: string, options?: Intl.PluralRulesOptions) {
    this.isUkrainianCardinal = locale?.split('-')[0] === 'uk' && options?.type !== 'ordinal';
  }

  select(count: number): PluralCategory {
    return this.isUkrainianCardinal ? ukrainianCardinalCategory(count) : defaultCategory(count);
  }

  // A fresh array per call: i18next sorts it in place.
  resolvedOptions(): { pluralCategories: PluralCategory[] } {
    return {
      pluralCategories: [...(this.isUkrainianCardinal ? UKRAINIAN_CATEGORIES : DEFAULT_CATEGORIES)],
    };
  }
}

/**
 * Hermes on iOS has no `Intl.PluralRules`, and i18next then falls back to a
 * one-or-other rule that declines every Ukrainian plural but 1 wrong. i18next
 * builds its plural resolver internally, so the global is the only hook. Call
 * this before `i18next.init`; it does nothing where `Intl.PluralRules` exists.
 */
export const installPluralRulesFallback = (): void => {
  if (typeof Intl.PluralRules === 'function') {
    return;
  }

  Object.defineProperty(Intl, 'PluralRules', {
    value: FallbackPluralRules,
    writable: true,
    configurable: true,
  });
};
