// The data layer the real transaction form reads and writes, for a navigator test that renders the
// form itself. A test file imports it as `mockDataLayer` (the `mock` prefix lets a hoisted
// `jest.mock` factory read it) and installs each part with
// `jest.mock('<module>', () => mockDataLayer.<name>)`. It keeps its own live-query mock, because
// that is the part each test decides.

const query = () => ({ toSQL: () => ({ sql: '', params: [] }) });

export const transactionFormDataLayer = {
  transactionsRepo: {
    transactionsRepo: {
      recordManual: jest.fn().mockResolvedValue(undefined),
      getByIdQuery: query,
      distinctDescriptionsQuery: query,
      latestManualHoldingQuery: query,
    },
  },
  categoriesRepo: { categoriesRepo: { allQuery: query } },
  categoryRulesRepo: { categoryRulesRepo: { allQuery: query } },
  accountsRepo: { accountsRepo: { byIdQuery: query, listQuery: query } },
  holdingsRepo: { holdingsRepo: { byIdQuery: query, allQuery: query } },
  bondRegisterRepo: {
    bondRegisterRepo: { findByIsinQuery: query, fetchedAtQuery: query },
    refreshBondRegisterIfStale: jest.fn().mockResolvedValue(undefined),
  },
  useSync: { useSync: () => ({ sync: jest.fn() }) },
  useCryptoSync: { useCryptoSync: () => ({ sync: jest.fn() }) },
  refreshMarketData: { refreshMarketData: jest.fn().mockResolvedValue(undefined) },
  loanAutoLink: { runLoanAutoLink: jest.fn().mockResolvedValue(undefined) },
};
