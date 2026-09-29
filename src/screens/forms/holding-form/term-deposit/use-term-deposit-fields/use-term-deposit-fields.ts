import {
  asTermDepositMeta,
  type CompoundingFrequency,
  type TermDepositMeta,
} from '@kiko/holdings/holding-metadata';
import {
  termInputFromMonths,
  termMonthsFromInput,
  type TermUnit,
} from '@kiko/screens/forms/term-reasons';
import type { HoldingRow } from '@kiko/db';
import { parseAmount } from '@kiko/currency/parse';
import type { TextInputInstance } from 'react-native';
import type { Currency } from '@kiko/currency/currency';
import { type RefObject, useCallback, useRef, useState } from 'react';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import { groupAmount, majorAmountText } from '@kiko/screens/forms/amount-format';

import { saveMetadataEdit } from '../../save-metadata-edit';
import type { CreatePayload, EditContext, HoldingTypeForm } from '../../holding-type-form';

import {
  parsedContributions,
  termDepositFieldErrors,
  termDepositReasonKey,
  type Contribution,
  type TermDepositFieldErrors,
  type TermDepositReasonKey,
} from './term-deposit-reasons';

// Seed the repeatable contributions list from a stored deposit: each stored
// amount is minor units, shown back in the field as a grouped major string
// the user can edit (the inverse of the create form's parse-on-save). Every
// seeded row is `saved: true` — it already exists in the database, so it
// cannot be removed here.
const seedContributions = (meta: TermDepositMeta, currency: Currency): Contribution[] =>
  meta.contributions.map((contribution, index) => ({
    id: index,
    amount: groupAmount(majorAmountText(currency, contribution.amountMinorUnits)),
    date: contribution.date,
    saved: true,
  }));

type UseTermDepositFieldsParams = {
  currency: Currency;
  scrollTo: (ref: RefObject<FieldInstance | null>, focus?: () => void) => void;
};

export type UseTermDepositFieldsResult = HoldingTypeForm & {
  currency: Currency;
  contributions: Contribution[];
  addContribution: () => void;
  removeContribution: (index: number) => void;
  updateContributionAmount: (index: number, next: string) => void;
  updateContributionDate: (index: number, next: number) => void;
  annualRate: string;
  setAnnualRate: (value: string) => void;
  term: string;
  setTerm: (value: string) => void;
  termUnit: TermUnit;
  setTermUnit: (value: TermUnit) => void;
  recapitalization: boolean;
  setRecap: (value: boolean) => void;
  compounding: CompoundingFrequency;
  setCompounding: (value: CompoundingFrequency) => void;
  fieldErrors: TermDepositFieldErrors;
  reasonKey: TermDepositReasonKey | null;
  refs: {
    contributionsFieldRef: RefObject<FieldInstance | null>;
    lastContributionFieldRef: RefObject<FieldInstance | null>;
    annualRateFieldRef: RefObject<FieldInstance | null>;
    termFieldRef: RefObject<FieldInstance | null>;
    annualRateInputRef: RefObject<TextInputInstance | null>;
    termInputRef: RefObject<TextInputInstance | null>;
  };
};

/**
 * Owns every term_deposit form field: the repeatable contributions list, the
 * rate/term/recapitalization/compounding state, the per-field validation
 * reasons, the edit-mode seed, and the create/edit payload builders —
 * extracted out of `HoldingFormScreen` the same way `useLoanFields` extracted
 * the Loan form's own state.
 */
export const useTermDepositFields = (
  params: UseTermDepositFieldsParams,
): UseTermDepositFieldsResult => {
  const { currency, scrollTo } = params;

  const nextContributionId = useRef(1);
  const [contributions, setContributions] = useState<Contribution[]>([
    { id: 0, amount: '', date: null, saved: false },
  ]);
  const [annualRate, setAnnualRate] = useState('');
  const [term, setTerm] = useState('');
  const [termUnit, setTermUnit] = useState<TermUnit>('months');
  const [recapitalization, setRecap] = useState(false);
  const [compounding, setCompounding] = useState<CompoundingFrequency>('bi-weekly');

  const contributionsFieldRef = useRef<FieldInstance>(null);
  // A SEPARATE ref from `contributionsFieldRef` above (which always anchors
  // row 0, for the Save-invalid scroll) — so `addContribution` below can
  // scroll to whichever row is newest, via the SAME occlusion-aware
  // `scrollTo` the screen's blocked-Save path uses.
  const lastContributionFieldRef = useRef<FieldInstance>(null);
  const annualRateFieldRef = useRef<FieldInstance>(null);
  const termFieldRef = useRef<FieldInstance>(null);
  const annualRateInputRef = useRef<TextInputInstance>(null);
  const termInputRef = useRef<TextInputInstance>(null);

  const addContribution = (): void => {
    const id = nextContributionId.current++;
    setContributions((rows) => [...rows, { id, amount: '', date: null, saved: false }]);

    // The new row's fields are only measured after this render commits, so
    // the scroll is deferred to the next frame — otherwise
    // `lastContributionFieldRef` would still measure the PRE-add (one row
    // shorter) layout.
    requestAnimationFrame(() => {
      scrollTo(lastContributionFieldRef);
    });
  };

  const removeContribution = (index: number): void => {
    setContributions((rows) => rows.filter((_, i) => i !== index));
  };

  const updateContributionAmount = (index: number, next: string): void => {
    setContributions((rows) =>
      rows.map((row, i) => (i === index ? { ...row, amount: next } : row)),
    );
  };

  const updateContributionDate = (index: number, next: number): void => {
    setContributions((rows) => rows.map((row, i) => (i === index ? { ...row, date: next } : row)));
  };

  const buildDepositMetadata = (): Record<string, unknown> | undefined => {
    const rows = parsedContributions(contributions, currency);

    if (rows.length === 0) {
      return undefined;
    }

    return {
      contributions: rows,
      annualRatePct: parseAmount(annualRate) || 0,
      termMonths: termMonthsFromInput(term, termUnit) ?? 0,
      recapitalization,
      compounding,
    };
  };

  const validation = { contributions, annualRate, term, termUnit, currency };
  const fieldErrors = termDepositFieldErrors(validation);
  const reasonKey = termDepositReasonKey(validation);

  const seed = useCallback((holding: HoldingRow): void => {
    const meta = asTermDepositMeta(holding.metadata);

    if (meta === null) {
      return;
    }

    const rows = seedContributions(meta, holding.currency);
    setContributions(rows);
    nextContributionId.current = rows.length;
    setAnnualRate(String(meta.annualRatePct));
    const seededTerm = termInputFromMonths(meta.termMonths);
    setTerm(seededTerm.value);
    setTermUnit(seededTerm.unit);
    setRecap(meta.recapitalization);
    setCompounding(meta.compounding);
  }, []);

  // Ledgerless: a term deposit's value derives entirely from its
  // contributions/schedule, never a typed opening balance — the stored
  // balance is always 0, the same as property/metal/loan.
  const createPayload = (): CreatePayload => ({
    metadata: buildDepositMetadata(),
  });

  const saveEdit = (context: EditContext): Promise<void> =>
    saveMetadataEdit(context, buildDepositMetadata());

  return {
    currency,
    contributions,
    addContribution,
    removeContribution,
    updateContributionAmount,
    updateContributionDate,
    annualRate,
    setAnnualRate,
    term,
    setTerm,
    termUnit,
    setTermUnit,
    recapitalization,
    setRecap,
    compounding,
    setCompounding,
    fieldErrors,
    reasonKey,
    isValid: reasonKey === null,
    scrollTargets: [
      { invalid: fieldErrors.contributionsError !== null, ref: contributionsFieldRef },
      {
        invalid: fieldErrors.annualRateError !== null,
        ref: annualRateFieldRef,
        focus: () => annualRateInputRef.current?.focus(),
      },
      {
        invalid: fieldErrors.termError !== null,
        ref: termFieldRef,
        focus: () => termInputRef.current?.focus(),
      },
    ],
    createPayload,
    saveEdit,
    seed,
    refs: {
      contributionsFieldRef,
      lastContributionFieldRef,
      annualRateFieldRef,
      termFieldRef,
      annualRateInputRef,
      termInputRef,
    },
  };
};
