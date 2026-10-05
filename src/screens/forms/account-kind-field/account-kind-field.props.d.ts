import type { AccountRow } from '@kiko/db';

export type AccountKind = AccountRow['kind'];

// Everything else the field shows (its label and sheet title, every kind with
// its text, subtitle and glyph) is the same wherever it is used, so the field
// resolves it itself.
export type AccountKindFieldProps = {
  selected: AccountKind;
  onSelect: (kind: AccountKind) => void;
  // Runs with the pick once the sheet has finished closing; what must not
  // happen while it is still closing (navigating the screen away) goes here.
  onSelectClosed?: (kind: AccountKind) => void;
  // The kinds whose pick leaves the screen, so their sheet closes with no
  // fade and `onSelectClosed` follows at once (`SelectField`'s contract). The
  // screen that owns the swap decides which; omitted = the fade for all.
  closesWithoutAnimation?: (kind: AccountKind) => boolean;
  // Read-only once an account's kind is fixed: in edit mode (the
  // domain forbids re-shaping an existing account) and once a bank/crypto
  // source has already inserted the row (switching kind afterwards would
  // orphan it).
  disabled: boolean;
};
