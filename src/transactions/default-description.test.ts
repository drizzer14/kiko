import { defaultTransactionDescription } from './default-description';

describe('defaultTransactionDescription', () => {
  it('labels a positive amount as income for the holding', () => {
    expect(defaultTransactionDescription('Salary card', 5000)).toBe('Salary card income');
  });

  it('labels a zero amount as income (a non-negative movement is income)', () => {
    expect(defaultTransactionDescription('Jar', 0)).toBe('Jar income');
  });

  it('labels a negative amount as expense for the holding', () => {
    expect(defaultTransactionDescription('Everyday card', -5000)).toBe('Everyday card expense');
  });
});
