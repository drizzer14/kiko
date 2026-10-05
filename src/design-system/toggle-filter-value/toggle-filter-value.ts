import { FILTER_ALL } from '@kiko/design-system/components/filter-menu';

// A FilterMenu toggle for either dimension (accounts, categories) as a state
// updater: the `FILTER_ALL` row clears the dimension; any other value toggles
// in/out. A fresh Set keeps the state update immutable.
export const toggleFilterValue =
  (value: string) =>
  (previous: Set<string>): Set<string> => {
    if (value === FILTER_ALL) {
      return new Set();
    }

    const next = new Set(previous);

    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }

    return next;
  };
