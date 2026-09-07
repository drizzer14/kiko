// src/i18n/locales/en.button-casing.test.ts
import { en } from './en';

describe('en catalog Button label casing', () => {
  it('renders every button label in sentence case', () => {
    // The Button no longer force-capitalizes, so each catalogue supplies its own
    // casing. English button copy is sentence case: first word capitalized,
    // later words lowercase unless they are proper nouns.
    expect(en.accounts.addAccount).toBe('Add account');
    expect(en.forms.contribution.save).toBe('Save contribution');
    expect(en.common.save).toBe('Save');
    expect(en.common.cancel).toBe('Cancel');
    expect(en.common.delete).toBe('Delete');
  });
});
