import type { Metal } from '@kiko/holdings/holding-metadata';
import type { HoldingType } from '@kiko/holdings/holding-type';

export type MetalTypeFieldProps = {
  // The non-metal types listed ahead of the metals — a bank that sells metals
  // passes its other creatable types; a metals account, and any edit (where
  // the type itself is locked), passes none.
  otherTypes: readonly HoldingType[];
  typeLabels: Record<HoldingType, string>;
  type: HoldingType;
  metal: Metal;
  onSelectType: (type: HoldingType) => void;
  onSelectMetal: (metal: Metal) => void;
  testID?: string;
};
