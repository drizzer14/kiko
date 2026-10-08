// Semgrep fixture (NEGATIVE): a comment or a string merely naming
// Intl.PluralRules (like this one), another `Intl` member, and the plural
// rules module's own name must not match `kiko-no-direct-intl-plural-rules`.

export const note = 'Hermes has no Intl.PluralRules';

export const money = new Intl.NumberFormat('uk', { style: 'currency', currency: 'UAH' });

export const days = (t: (key: string, options: { count: number }) => string, count: number) =>
  t('forms.units.days', { count });
