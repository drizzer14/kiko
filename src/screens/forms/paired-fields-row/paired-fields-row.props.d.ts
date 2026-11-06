import type { ReactElement } from 'react';

export type PairedFieldsRowProps = {
  // Takes the row's first place, and the stack's first place at an accessibility text size.
  first: ReactElement;
  second: ReactElement;
};
