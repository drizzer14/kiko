import type { UsePropertyFieldsResult } from '../use-property-fields/use-property-fields';

export type PropertyFormBlockProps = {
  fields: UsePropertyFieldsResult;
  attemptedSave: boolean;
  isEdit: boolean;
};
