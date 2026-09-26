import '@kiko/i18n/init';
import { i18n } from '@kiko/i18n/init';

import { defaultTransactionDescription } from './default-description';

describe('defaultTransactionDescription', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('labels a positive amount as income for the holding', () => {
    expect(defaultTransactionDescription('Salary card', 5000, i18n.t)).toBe('Salary card income');
  });

  it('labels a zero amount as income (a non-negative movement is income)', () => {
    expect(defaultTransactionDescription('Jar', 0, i18n.t)).toBe('Jar income');
  });

  it('labels a negative amount as expense for the holding', () => {
    expect(defaultTransactionDescription('Everyday card', -5000, i18n.t)).toBe(
      'Everyday card expense',
    );
  });

  it('resolves in Ukrainian once the active language switches', async () => {
    await i18n.changeLanguage('uk');

    expect(defaultTransactionDescription('Готівка', 5000, i18n.t)).toBe('Надходження: Готівка');
    expect(defaultTransactionDescription('Готівка', -5000, i18n.t)).toBe('Витрата: Готівка');
  });

  // An empty holding name (the statement-import preview before a target
  // holding is chosen) falls back to the PLAIN label — no
  // dangling leading space ("{{name}} expense" with an empty name) or
  // dangling colon ("Витрата: {{name}}" with an empty name).
  it('falls back to the plain label with no dangling space when the holding name is empty (en)', () => {
    expect(defaultTransactionDescription('', 5000, i18n.t)).toBe('Income');
    expect(defaultTransactionDescription('', -5000, i18n.t)).toBe('Expense');
  });

  it('falls back to the plain label with no dangling colon when the holding name is empty (uk)', async () => {
    await i18n.changeLanguage('uk');

    expect(defaultTransactionDescription('', 5000, i18n.t)).toBe('Надходження');
    expect(defaultTransactionDescription('', -5000, i18n.t)).toBe('Витрата');
  });
});
