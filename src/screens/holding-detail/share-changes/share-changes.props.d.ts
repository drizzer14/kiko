import type { HoldingRow } from '@kiko/db/schema';

export type ShareChangesProps = {
  // Undefined until the holding loads.
  holding: Pick<HoldingRow, 'type' | 'metadata'> | undefined;
  // Both receive the change's `dayKeyOf` key, never the cached change.
  onEdit: (day: number) => void;
  onDelete: (day: number) => void;
};
