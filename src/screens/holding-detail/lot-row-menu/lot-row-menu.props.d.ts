import type { ReactNode } from 'react';
import type { DerivedEntry } from '@kiko/holdings/derived-entries';

// Each receives the lot's position in `metadata.lots`, never the lot itself:
// the repo re-reads the lots inside its write.
export type LotActions = {
  edit: (lotIndex: number) => void;
  remove: (lotIndex: number) => void;
  isRemovable: (lotIndex: number) => boolean;
};

export type LotRowMenuProps = {
  entry: DerivedEntry;
  // Undefined until the holding loads.
  actions: LotActions | undefined;
  children: ReactNode;
};
