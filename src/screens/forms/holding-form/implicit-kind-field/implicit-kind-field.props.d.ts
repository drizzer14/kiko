import type { AccountRow } from '@kiko/db';
import type { ImplicitAccountKind } from '@kiko/holdings/implicit-account';

export type ImplicitKindFieldProps = {
  selected: ImplicitAccountKind;
  // Property or Loan was picked: the form stays and re-targets its fields.
  onSelectImplicit: (kind: ImplicitAccountKind) => void;
  // Any other kind was picked: it creates an account, so the account form
  // takes over.
  onSelectAccountKind: (kind: AccountRow['kind']) => void;
};
