import type { HoldingType } from '../../../holdings/holding-type/holding-type';

export type HoldingTypeFieldProps = {
  // Every type offered in the sheet, in display order — the holding form
  // passes the account-kind-constrained subset (create) or the full
  // allowed set (edit, so a synced card/jar row still displays).
  options: readonly HoldingType[];
  selected: HoldingType;
  onSelect: (type: HoldingType) => void;
  // The catalog-resolved display label for each type, resolved by the
  // screen (this field calls `t()` only for its own label/sheetTitle/
  // placeholder) — mirrors AccountKindField's own `labels` prop.
  labels: Record<HoldingType, string>;
  // The SF Symbol glyph shown for each type (the trigger's leading icon and
  // each sheet row's leading icon) — the screen passes `holdingTypeSymbol`
  // straight through.
  icons: Record<HoldingType, string>;
  // Read-only once a holding's type can no longer change (edit mode — the
  // domain forbids re-shaping an existing holding) — mirrors
  // AccountKindField's own `disabled` contract.
  disabled: boolean;
  testID?: string;
};
