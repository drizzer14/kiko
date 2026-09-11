import '../../i18n';
import { i18n } from '../../i18n';

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
});
