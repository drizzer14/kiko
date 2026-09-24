import type { AccountRow } from '../../../db/schema';

// The account-form's own `Kind` re-exports this — the SAME `accounts.kind`
// union the schema owns (`db/schema.ts`), so a later widening (metals, debt,
// broker) only needs a new entry in the schema enum plus the symbol/color/
// label/subtitle maps it already forces via their own exhaustive `Record`
// types; this field's own option list is driven entirely by the caller's
// `options`, never a second hand-copied array here.
export type AccountKind = AccountRow['kind'];

export type AccountKindFieldProps = {
  label: string;
  // The sheet's own header — a distinct, Title Case string from `label`,
  // the sheet-title UI role (this field is routed through the shared
  // `SelectField`, whose `sheetTitle` prop is required).
  sheetTitle: string;
  // Every kind offered in the sheet, in display order — the account-form
  // passes `Object.keys(accountKindSymbol)` (see that map's own doc comment
  // for why it is exhaustive over the schema's `kind` enum), so the option
  // list can never drift from the schema without a compile error there.
  options: readonly AccountKind[];
  selected: AccountKind;
  onSelect: (kind: AccountKind) => void;
  // The catalog-resolved display label for each kind, resolved by the screen
  // so the field stays translation-agnostic — mirrors ModeSelectField's own
  // `labels` prop.
  labels: Record<AccountKind, string>;
  // A short second line rendered under each row's label (device-feedback:
  // "which kind is this?" — a plain one-line hint, e.g. "For real estate,
  // vehicles, or anything else you own or lent"), resolved by the screen the
  // same way `labels` is.
  subtitles: Record<AccountKind, string>;
  // The SF Symbol glyph shown for each kind (the trigger's leading icon and
  // each sheet row's leading icon) — the account-form passes
  // `accountKindSymbol` straight through.
  icons: Record<AccountKind, string>;
  // Read-only once an account's kind can no longer change: in edit mode (the
  // domain forbids re-shaping an existing account) and once a bank/crypto
  // source has already inserted the row (switching kind afterwards would
  // orphan it) — mirrors the disable conditions the former ChipRow read from
  // the account-form screen.
  disabled: boolean;
  testID?: string;
};
