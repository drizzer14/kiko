import type { StatementFormatId } from '@kiko/statement-import/parser';

/**
 * The "which bank is this account" catalog: every bank Kiko can
 * represent an account under, independent of
 * whether that bank has a LIVE sync connection. Sibling of, and deliberately
 * narrower-scoped than, `BankProviderId` (`../provider`) — that tuple stays
 * exactly `['monobank']` (the only bank with a real API connect, per the
 * Guideline 5.6 remediation); THIS tuple additionally covers every
 * statement-import-only bank, whether or not `statement-import` ships a
 * dedicated parser for it (see `BankCatalogEntry.statementFormatId` below —
 * P3's PUMB/Oschadbank/Raiffeisen/Ukrgasbank have none, and import through
 * the generic column-mapping screen instead). `connectable` is a plain,
 * always-visible data field on a fully-rendered static array — never a
 * build/runtime visibility gate — so every row always renders; only the
 * AFFORDANCE differs (a real Connect field for Monobank, an "import only" or
 * "column mapping only" caption for the rest). Never wire a
 * `SHOW_*`/`HIDE_*`/`ENABLE_*` flag around any entry here (Guideline 5.6).
 */
export const bankIds = [
  'monobank',
  'privatbank',
  'sensebank',
  'procredit',
  'ukrsib',
  'alfa',
  'pumb',
  'oschadbank',
  'raiffeisen',
  'ukrgasbank',
  'other',
] as const;

export type BankId = (typeof bankIds)[number];

/** `other` covers any bank not listed, the same as the broker catalog's own
 * `other`, and is the LAST entry. It is a STORED id (migration 0049 gave
 * every bank account that had none this one), so every reader treats it
 * exactly as the NULL it replaced: no bank format, no live connection, no
 * metals, and no saved column mapping keyed on it. */
export const OTHER_BANK_ID = 'other' satisfies BankId;

type BankCatalogEntry = {
  id: BankId;
  /** The plain bank name shown in the account-form picker — distinct from
   * the matching `StatementFormat.displayName` (`../../statement-import/parser`),
   * which additionally names the file format (e.g. "PrivatBank (XLSX)").
   * Absent for `other`, which renders its translated label instead. */
  displayName?: string;
  /** Whether this bank offers a LIVE API Connect (Monobank only, per the
   * `bankProviderIds` registry). An import-only bank (`false`) must never
   * render a Connect field — only its statement-import affordance. */
  connectable: boolean;
  /** The `statement-import` format this bank's account scopes import
   * recognition to (see `statementFormatIdForBank` below) — `undefined` for
   * a bank with no dedicated parser (P3's PUMB/Oschadbank/Raiffeisen/
   * Ukrgasbank), which falls through to the generic column-mapping import
   * (`BankTypeField`'s `bankColumnMappingOnly` caption names this honestly). */
  statementFormatId?: StatementFormatId;
  /** Whether a `bank`-kind account at this bank may hold a `metal` holding
   * (a bank-held precious-metal account, distinct from the standalone
   * `metals` account kind, which never gates on this field). Always-rendered
   * DATA on this fully-rendered static array — never a build/runtime
   * visibility gate (Guideline 5.6): every row always renders regardless of
   * this value, and only the CREATABLE holding-type set differs
   * (`creatableHoldingTypesForAccount`, `src/holdings/holding-type/`).
   * PrivatBank, PUMB, Oschadbank, and Ukrgasbank (P3); Monobank and
   * Raiffeisen stay `false` (no such product). */
  sellsMetals: boolean;
};

export const bankCatalog: readonly BankCatalogEntry[] = [
  {
    id: 'monobank',
    displayName: 'Monobank',
    connectable: true,
    statementFormatId: 'monobank-csv',
    sellsMetals: false,
  },
  {
    id: 'privatbank',
    displayName: 'PrivatBank',
    connectable: false,
    statementFormatId: 'privatbank-xlsx',
    sellsMetals: true,
  },
  {
    id: 'sensebank',
    displayName: 'Sensebank',
    connectable: false,
    statementFormatId: 'sensebank-csv',
    sellsMetals: false,
  },
  {
    id: 'procredit',
    displayName: 'ProCredit Bank',
    connectable: false,
    statementFormatId: 'procredit-business-csv',
    sellsMetals: false,
  },
  {
    id: 'ukrsib',
    displayName: 'UKRSIBBANK',
    connectable: false,
    statementFormatId: 'ukrsib-business-csv',
    sellsMetals: false,
  },
  {
    id: 'alfa',
    displayName: 'Alfa-Bank',
    connectable: false,
    statementFormatId: 'alfa-business-csv',
    sellsMetals: false,
  },
  {
    id: 'pumb',
    displayName: 'PUMB',
    connectable: false,
    sellsMetals: true,
  },
  {
    id: 'oschadbank',
    displayName: 'Oschadbank',
    connectable: false,
    sellsMetals: true,
  },
  {
    id: 'raiffeisen',
    displayName: 'Raiffeisen Bank',
    connectable: false,
    sellsMetals: false,
  },
  {
    id: 'ukrgasbank',
    displayName: 'Ukrgasbank',
    connectable: false,
    sellsMetals: true,
  },
  {
    id: OTHER_BANK_ID,
    connectable: false,
    sellsMetals: false,
  },
];

export const isBankId = (value: string | null | undefined): value is BankId =>
  value !== null && value !== undefined && (bankIds as readonly string[]).includes(value);

/** A catalog id that names ONE real bank — `isBankId` without `other`. */
export const isSpecificBankId = (
  value: string | null | undefined,
): value is Exclude<BankId, typeof OTHER_BANK_ID> => isBankId(value) && value !== OTHER_BANK_ID;

const specificBankEntry = (bankId: string | null | undefined) =>
  isSpecificBankId(bankId) ? bankCatalog.find((entry) => entry.id === bankId) : undefined;

/** Resolves a stored `accounts.bankId` (or any other free-text candidate) to
 * the `StatementFormatId` its statement import should scope to — `undefined`
 * for an unset, `other`, or unrecognized value (an older account created
 * before this feature, or a value from a since-removed bank), so the caller
 * falls back to the existing multi-format auto-detect rather than throwing. */
export const statementFormatIdForBank = (
  bankId: string | null | undefined,
): StatementFormatId | undefined => specificBankEntry(bankId)?.statementFormatId;

/** Resolves a stored `accounts.bankId` to whether it is CONNECTABLE: `true`
 * for an unset, `other`, or unrecognized value (the account has not declared a
 * bank, or predates this feature — the
 * connect affordance stays available rather than guessing it is import-only)
 * and for Monobank; `false` for a known import-only bank (PrivatBank etc.),
 * which must show NO sync/connect affordance — only its statement import. */
export const isConnectableBank = (bankId: string | null | undefined): boolean =>
  specificBankEntry(bankId)?.connectable ?? true;

/** Resolves a stored `accounts.bankId` to whether that bank sells precious
 * metals (the `metal` holding allow-list): `false` for an unset, `other`, or
 * unrecognized value — UNLIKE `isConnectableBank`'s permissive default, an
 * unknown bank must not silently unlock the `metal` holding type — and
 * otherwise the catalog entry's own `sellsMetals` field (see that field's
 * comment above, `BankCatalogEntry.sellsMetals`, for the current set —
 * not restated here, it drifts). */
export const bankSellsMetals = (bankId: string | null | undefined): boolean =>
  specificBankEntry(bankId)?.sellsMetals ?? false;
