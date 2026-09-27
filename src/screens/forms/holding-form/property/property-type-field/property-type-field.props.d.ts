import type { PropertyCategory } from '@kiko/holdings/holding-metadata';

export type PropertyTypeFieldProps = {
  selected: PropertyCategory;
  onSelect: (category: PropertyCategory) => void;
  testID?: string;
};
