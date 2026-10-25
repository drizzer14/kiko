import { useCallback, useMemo, useState } from 'react';
import type { UpcomingLoanInstallment } from '@kiko/holdings/loan-ledger';

// A 30-year mortgage lists up to 360 payments, so only the next year of them is drawn until
// the user asks for the rest.
const SCHEDULED_PAYMENT_PREVIEW_COUNT = 12;

type ScheduledPreview = {
  shown: readonly UpcomingLoanInstallment[];
  expanded: boolean;
  canExpand: boolean;
  toggle: () => void;
};

// The scheduled payments the loan's list draws now: the next few, or all once the user asks.
// `shown` keeps its identity between renders, so the screen's ledger is not rebuilt for nothing.
export const useScheduledPreview = (
  installments: readonly UpcomingLoanInstallment[],
): ScheduledPreview => {
  const [expanded, setExpanded] = useState(false);
  const shown = useMemo(
    () => (expanded ? installments : installments.slice(0, SCHEDULED_PAYMENT_PREVIEW_COUNT)),
    [installments, expanded],
  );
  const toggle = useCallback(() => setExpanded((isExpanded) => !isExpanded), []);

  return {
    shown,
    expanded,
    canExpand: installments.length > SCHEDULED_PAYMENT_PREVIEW_COUNT,
    toggle,
  };
};
