import type { UseMetalFieldsResult } from '../use-metal-fields/use-metal-fields';

export type MetalFormBlockProps = {
  fields: UseMetalFieldsResult;
  attemptedSave: boolean;
  isEdit: boolean;
};
