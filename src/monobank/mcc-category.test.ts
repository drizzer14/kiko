import { categoryForMcc } from './mcc-category';

describe('categoryForMcc', () => {
  it('maps a grocery MCC to Groceries', () => {
    expect(categoryForMcc(5411)).toBe('Groceries');
  });

  it('maps a dining MCC to Dining', () => {
    expect(categoryForMcc(5812)).toBe('Dining');
  });

  it('maps a transport MCC to Transport', () => {
    expect(categoryForMcc(4111)).toBe('Transport');
  });

  it('maps an ATM MCC to Cash', () => {
    expect(categoryForMcc(6011)).toBe('Cash');
  });

  it('falls back to Other for an unknown MCC', () => {
    expect(categoryForMcc(9999)).toBe('Other');
  });
});
