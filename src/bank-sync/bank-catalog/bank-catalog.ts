import type { StatementFormatId } from '../../statement-import/parser';

/**
 * The Option A "which bank is this account" catalog (device-feedback-round-1
 * item 3): all 6 banks Kiko can represent an account under, independent of
 * whether that bank has a LIVE sync connection. Sibling of, and deliberately
 * narrower-scoped than, `BankProviderId` (`../provider`) — that tuple stays
 * exactly `['monobank']` (the only bank with a real API connect, per the
 * Guideline 5.6 remediation); THIS tuple additionally covers the 5
 * statement-import-only banks the `statement-import` track already ships
 * parsers for. `connectable` is a plain, always-visible data field on a
 * fully-rendered static array — never a build/runtime visibility gate — so
 * every row always renders; only the AFFORDANCE differs (a real Connect
 * field for Monobank, an "import only" caption for the rest). Never wire a
 * `SHOW_*`/`HIDE_*`/`ENABLE_*` flag around any entry here (Guideline 5.6).
 */
export const bankIds = [
  'monobank',
  'privatbank',
  'sensebank',
  'procredit',
  'ukrsib',
  'alfa',
] as const;

export type BankId = (typeof bankIds)[number];

export type BankCatalogEntry = {
  id: BankId;
  /** The plain bank name shown in the account-form picker — distinct from
   * the matching `StatementFormat.displayName` (`../../statement-import/parser`),
   * which additionally names the file format (e.g. "PrivatBank (XLSX)"). */
  displayName: string;
  /** Whether this bank offers a LIVE API Connect (Monobank only, per the
   * `bankProviderIds` registry). An import-only bank (`false`) must never
   * render a Connect field — only its statement-import affordance. */
  connectable: boolean;
  /** The `statement-import` format this bank's account scopes import
   * recognition to (see `statementFormatIdForBank` below). */
  statementFormatId: StatementFormatId;
};

export const bankCatalog: readonly BankCatalogEntry[] = [
  { id: 'monobank', displayName: 'Monobank', connectable: true, statementFormatId: 'monobank-csv' },
  {
    id: 'privatbank',
    displayName: 'PrivatBank',
    connectable: false,
    statementFormatId: 'privatbank-xlsx',
  },
  {
    id: 'sensebank',
    displayName: 'Sensebank',
    connectable: false,
    statementFormatId: 'sensebank-csv',
  },
  {
    id: 'procredit',
    displayName: 'ProCredit Bank',
    connectable: false,
    statementFormatId: 'procredit-business-csv',
  },
  {
    id: 'ukrsib',
    displayName: 'UKRSIBBANK',
    connectable: false,
    statementFormatId: 'ukrsib-business-csv',
  },
  {
    id: 'alfa',
    displayName: 'Alfa-Bank',
    connectable: false,
    statementFormatId: 'alfa-business-csv',
  },
];

export const isBankId = (value: string | null | undefined): value is BankId =>
  value !== null && value !== undefined && (bankIds as readonly string[]).includes(value);

/** Resolves a stored `accounts.bankId` (or any other free-text candidate) to
 * the `StatementFormatId` its statement import should scope to — `undefined`
 * for an unset or unrecognized value (an older account created before this
 * feature, or a value from a since-removed bank), so the caller falls back
 * to the existing multi-format auto-detect rather than throwing. */
export const statementFormatIdForBank = (
  bankId: string | null | undefined,
): StatementFormatId | undefined =>
  isBankId(bankId)
    ? bankCatalog.find((entry) => entry.id === bankId)?.statementFormatId
    : undefined;
