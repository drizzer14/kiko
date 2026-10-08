import { visibleSelection } from './visible-selection';

describe('visibleSelection', () => {
  it('keeps the selected values that are among the visible ones', () => {
    expect(visibleSelection(new Set(['a', 'b']), ['a', 'b', 'c'])).toEqual(new Set(['a', 'b']));
  });

  it('drops a selected value that is no longer visible', () => {
    expect(visibleSelection(new Set(['a', 'b']), ['b', 'c'])).toEqual(new Set(['b']));
  });

  it('is empty, meaning all, when no selected value is visible', () => {
    expect(visibleSelection(new Set(['a']), ['b']).size).toBe(0);
  });

  it('is empty for an empty selection', () => {
    expect(visibleSelection(new Set(), ['a']).size).toBe(0);
  });
});
