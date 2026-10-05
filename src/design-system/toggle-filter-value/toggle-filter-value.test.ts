import '@kiko/design-system/unistyles';
import { FILTER_ALL } from '@kiko/design-system/components/filter-menu';

import { toggleFilterValue } from './toggle-filter-value';

describe('toggleFilterValue', () => {
  it('adds a value that is not selected yet', () => {
    expect(toggleFilterValue('a')(new Set(['b']))).toEqual(new Set(['b', 'a']));
  });

  it('removes a value that is already selected', () => {
    expect(toggleFilterValue('a')(new Set(['a', 'b']))).toEqual(new Set(['b']));
  });

  it('empties the set when the last selected value is toggled off', () => {
    expect(toggleFilterValue('a')(new Set(['a']))).toEqual(new Set());
  });

  it('clears the whole dimension for the FILTER_ALL value', () => {
    expect(toggleFilterValue(FILTER_ALL)(new Set(['a', 'b']))).toEqual(new Set());
  });

  it('keeps FILTER_ALL out of the set when the set is already empty', () => {
    expect(toggleFilterValue(FILTER_ALL)(new Set())).toEqual(new Set());
  });

  it('returns a fresh set and leaves the previous one untouched', () => {
    const previous = new Set(['a']);

    const next = toggleFilterValue('b')(previous);

    expect(next).not.toBe(previous);
    expect(previous).toEqual(new Set(['a']));
  });

  it('returns a fresh set even when clearing', () => {
    const previous = new Set<string>();

    expect(toggleFilterValue(FILTER_ALL)(previous)).not.toBe(previous);
  });
});
