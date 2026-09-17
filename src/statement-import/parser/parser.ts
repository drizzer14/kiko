import type { Currency } from '../../currency/currency';

/**
 * One row of a parsed statement, before domain mapping. Deliberately mirrors
 * `docs/plans/bank-providers.md`'s `ProviderStatementItem` shape (externalId,
 * amount, time, description, mcc, counterIban, comment) so the SAME mapping
 * discipline applies to a file-sourced row as to a live-API one.
 */
export type ParsedTransaction = {
  /** A bank-issued unique id, when the export format actually carries one.
   * NONE of the formats studied for this plan (section C) carry one —
   * `undefined` here is the NORMAL case, not a placeholder. The mapper (A.3)
   * synthesizes a deterministic key when this is absent (section D). */
  externalId?: string;
  amountMinorUnits: number;
  timeSeconds: number;
  description: string;
  mcc?: number;
  counterIban?: string;
  comment?: string;
};

export type ParsedAccountHint = {
  currency: Currency;
  /** A display name suggestion for a newly created holding (e.g. a masked
   * PAN or the export's own account label), never used to MATCH an existing
   * holding — matching is always the user's explicit pick (section C.3). */
  suggestedName?: string;
  iban?: string;
  maskedPan?: string;
};

export type ParsedStatement = {
  formatId: StatementFormatId;
  account: ParsedAccountHint;
  transactions: ParsedTransaction[];
};

/** One entry per SHIPPED format. Phase 1 ships Monobank CSV only — every
 * other bank studied for this plan (PrivatBank XLSX, Sensebank CSV, …) lands
 * in its own later phase and is deliberately NOT listed here yet. */
export const statementFormatIds = ['monobank-csv'] as const;
export type StatementFormatId = (typeof statementFormatIds)[number];

export type StatementFormatInput = { text: string; fileName: string };

export interface StatementFormat {
  id: StatementFormatId;
  displayName: string;
  /** A cheap, non-throwing header/content-signature sniff — see section C
   * (`docs/plans/statement-import.md`) for each format's exact signature. */
  detect: (input: StatementFormatInput) => boolean;
  /** Throws `StatementParseError` on a file that `detect` accepted but whose
   * body doesn't actually parse (a truncated download, a locale variant the
   * column mapper doesn't recognize). */
  parse: (input: StatementFormatInput) => ParsedStatement;
}

export class StatementParseError extends Error {}
