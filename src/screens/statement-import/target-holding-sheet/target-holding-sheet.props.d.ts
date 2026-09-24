/**
 * One selectable row's data — a holding plus the display fields the sheet
 * needs to filter/group it, WITHOUT reaching back into the holdings/accounts
 * repos itself. The caller (`statement-import.screen.tsx`) resolves this list
 * from its own `useLiveQuery` reads (holdings scoped or unscoped per the
 * screen's own `accountId`) and hands it down fully formed — this component
 * stays a pure list/filter/group renderer, mirroring `AddBankProviderSheet`'s
 * split (that sheet also takes no repo dependency of its own).
 */
export type TargetHoldingOption = {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  // The holding's own SF Symbol + already-RESOLVED entity color (F3 item 3) —
  // the same `icon ?? holdingTypeSymbol[type]` / `resolveEntityColor` pair
  // `transaction-form.screen.tsx`'s exchange picker resolves, so this picker
  // shows the holding's icon exactly as every other holding picker does.
  icon: string;
  color: string;
};

export type TargetHoldingSheetProps = {
  /** Whether the sheet and its dismiss scrim are mounted and shown. */
  visible: boolean;
  /** Called on a tap on the scrim behind the sheet, or a hardware/gesture back. */
  onDismiss: () => void;
  /** The full holding candidate set; the sheet itself applies the `accountId`
   * scope filter below — the caller does not pre-filter. */
  holdings: TargetHoldingOption[];
  /**
   * Scopes the listed rows to one account (entry point 1: the document picker
   * on `AccountDetailScreen`, which always knows its own account). Left
   * `undefined` for the cross-account picker (entry point 2, the Share
   * Extension has no known target) — every holding then renders, grouped by
   * `accountName`.
   */
  accountId?: string;
  /** Called with the chosen holding's id; the caller closes the sheet. */
  onSelect: (holdingId: string) => void;
  /**
   * Called when the "Create new holding" row is pressed. The sheet itself
   * does not navigate — the caller (which owns the screen's `navigation`
   * prop) is responsible for pushing `HoldingForm` and for closing this sheet.
   */
  onCreateNew: () => void;
};
