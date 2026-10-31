import { isOneWordTitle } from '.';

describe('isOneWordTitle', () => {
  it.each(['Settings', 'Налаштування', '  Settings  '])('is true for %j', (title) => {
    expect(isOneWordTitle(title)).toBe(true);
  });

  it.each(['Transaction templates', 'Import\tdata', 'A B'])('is false for %j', (title) => {
    expect(isOneWordTitle(title)).toBe(false);
  });
});
