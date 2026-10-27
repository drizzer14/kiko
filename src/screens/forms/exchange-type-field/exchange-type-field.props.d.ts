import type { ExchangeCatalogId } from '@kiko/crypto-sync/exchange-catalog';

export type ExchangeTypeFieldProps = {
  label: string;
  // The picker sheet's header: a Title Case sheet title, a separate key from
  // the sentence-case `label` (kiko-translator: one key per UI role).
  sheetTitle: string;
  // null = nothing picked yet, shown as the placeholder: an account may be saved with no pick.
  selected: ExchangeCatalogId | null;
  onSelect: (exchangeId: ExchangeCatalogId) => void;
  // Read-only: shows the pick and opens no sheet. The create form sets it once a Connect started
  // the account row, because a pick made after that would name a different provider than the one
  // the row was connected to.
  disabled?: boolean;
  testID?: string;
};
