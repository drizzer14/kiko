import { loanInstallments } from '@kiko/holdings/loan-schedule';
import type { LoanMeta } from '@kiko/holdings/holding-metadata';

const mockLoanHoldingsQuery = jest.fn();
const mockLoanMatchCandidatesQuery = jest.fn();
const mockSetAutoLoanLinks = jest.fn();

jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { loanHoldingsQuery: () => mockLoanHoldingsQuery() },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    loanMatchCandidatesQuery: () => mockLoanMatchCandidatesQuery(),
    setAutoLoanLinks: (links: unknown) => mockSetAutoLoanLinks(links),
  },
}));

import { runLoanAutoLink } from './use-loan-auto-link';

const NOW = Date.UTC(2026, 8, 26);

// An interest-free 12-installment annuity, mirroring payment-matcher.test.ts's
// own fixture, so a real match can be proven end to end without mocking
// `matchLoanPayments` itself.
const loanMeta: LoanMeta = {
  kind: 'mortgage',
  principalMinorUnits: 1_200_000,
  startDate: Date.UTC(2025, 0, 15),
  annualRatePct: 0,
  termMonths: 12,
  schedule: 'annuity',
  paymentHoldingId: 'payer-1',
};

const firstInstallment = loanInstallments(loanMeta)[0];

const loanHoldingRow = { id: 'loan-1', currency: 'UAH', metadata: loanMeta };

const candidateRow = {
  id: 'txn-1',
  holdingId: 'payer-1',
  currency: 'UAH',
  amountMinorUnits: -firstInstallment.paymentMinorUnits,
  time: firstInstallment.dueDate,
  description: '',
  counterIban: null,
};

describe('runLoanAutoLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns without reading transactions at all when the user has no loan holdings (P-NOWORK)', async () => {
    mockLoanHoldingsQuery.mockResolvedValue([]);

    await runLoanAutoLink(NOW);

    expect(mockLoanMatchCandidatesQuery).not.toHaveBeenCalled();
    expect(mockSetAutoLoanLinks).not.toHaveBeenCalled();
  });

  it('returns without writing when there are loans but no candidate transactions', async () => {
    mockLoanHoldingsQuery.mockResolvedValue([loanHoldingRow]);
    mockLoanMatchCandidatesQuery.mockResolvedValue([]);

    await runLoanAutoLink(NOW);

    expect(mockSetAutoLoanLinks).not.toHaveBeenCalled();
  });

  it('writes every real match through setAutoLoanLinks', async () => {
    mockLoanHoldingsQuery.mockResolvedValue([loanHoldingRow]);
    mockLoanMatchCandidatesQuery.mockResolvedValue([candidateRow]);

    await runLoanAutoLink(NOW);

    expect(mockSetAutoLoanLinks).toHaveBeenCalledWith([
      { transactionId: 'txn-1', loanHoldingId: 'loan-1' },
    ]);
  });

  it('never writes when the candidates match nothing', async () => {
    mockLoanHoldingsQuery.mockResolvedValue([loanHoldingRow]);
    mockLoanMatchCandidatesQuery.mockResolvedValue([
      { ...candidateRow, holdingId: 'some-other-holding', description: 'unrelated rent' },
    ]);

    await runLoanAutoLink(NOW);

    expect(mockSetAutoLoanLinks).not.toHaveBeenCalled();
  });

  it('swallows a read failure and never rejects', async () => {
    mockLoanHoldingsQuery.mockRejectedValue(new Error('db unavailable'));

    await expect(runLoanAutoLink(NOW)).resolves.toBeUndefined();
    expect(mockSetAutoLoanLinks).not.toHaveBeenCalled();
  });

  it('defaults now to the current time when not given', async () => {
    mockLoanHoldingsQuery.mockResolvedValue([]);

    await expect(runLoanAutoLink()).resolves.toBeUndefined();
  });
});
