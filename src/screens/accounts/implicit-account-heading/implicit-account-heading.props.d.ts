import type { AccountRow } from '@kiko/db';

export type ImplicitAccountHeadingProps = {
  // The live implicit (property or debt) account whose name and squircle icon
  // the heading shows, straight from the screen's live account rows.
  account: Pick<AccountRow, 'kind' | 'name' | 'archivedAt' | 'icon' | 'color'>;
  testID: string;
};
