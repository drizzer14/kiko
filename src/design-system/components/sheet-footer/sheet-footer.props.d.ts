import type { ReactNode } from 'react';

export type SheetFooterProps = {
  // The action Buttons this footer lays out — a caller picks the exact
  // variants/labels (e.g. a `secondary` Clear beside a primary Save); the
  // footer itself only owns the shared row layout, never a specific button
  // set.
  children: ReactNode;
  testID?: string;
};
