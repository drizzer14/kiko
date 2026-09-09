// The canonical English catalog. This object is BOTH the runtime English
// resource AND the source of the catalog's TypeScript type (see i18next.d.ts).
// Every user-facing string lives here, namespaced by app area. uk.ts mirrors
// this exact key set.
//
// Deliberately NOT `as const`: `i18next.d.ts` needs only this object's KEY
// STRUCTURE, and a literal-typed `typeof en` made uk.ts's `typeof en`
// annotation demand the exact ENGLISH strings — 261 tsc errors, one per
// translated value, which buried the real "uk.ts is missing a key" error the
// annotation exists to surface.
export const en = {
  // The system Face ID/passcode prompt (src/auth/use-app-lock.ts) and the
  // full-screen LockGate it backs (src/auth/lock-gate) — the very first UI a
  // locked launch shows, before the navigator mounts.
  auth: {
    hint: {
      default: 'Unlock with Face ID or your device passcode.',
      cancelled: 'Authentication was cancelled.',
      lockout: 'Face ID is locked. Use your device passcode instead.',
      passcodeNotSet: 'Set a device passcode to unlock Kiko.',
      failed: 'Authentication failed. Try again.',
    },
    locked: 'Locked',
    unlock: 'Unlock',
    unlockPrompt: 'Unlock Kiko',
    usePasscode: 'Use passcode',
  },
  common: {
    all: 'All',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    deleteNamed: 'Delete "{{name}}"',
    done: 'Done',
    edit: 'Edit',
    changeIcon: 'Change icon',
    changeIconLabel: 'Change {{label}}',
    iconLabel: 'Icon {{name}}',
    noDataForRange: 'No Data For This Range',
  },
  settings: {
    appLock: {
      label: 'App Lock',
      requireFaceIdOrPasscode: 'Require Face ID or Passcode',
      hint: {
        passcodeNotSet: 'Set a device passcode in iOS Settings to use App Lock.',
        passcodeOnly: 'No Face ID enrolled — your device passcode will be used.',
        unavailable: 'Biometric hardware is unavailable on this device.',
      },
    },
    baseCurrency: 'Base Currency',
    categories: 'Categories',
    language: 'Language',
    system: 'System',
    title: 'Settings',
  },
  language: {
    en: '🇬🇧 English',
    uk: '🇺🇦 Українська',
  },
  calendar: {
    month: {
      january: 'January',
      february: 'February',
      march: 'March',
      april: 'April',
      may: 'May',
      june: 'June',
      july: 'July',
      august: 'August',
      september: 'September',
      october: 'October',
      november: 'November',
      december: 'December',
    },
    weekday: {
      sun: 'Sun',
      mon: 'Mon',
      tue: 'Tue',
      wed: 'Wed',
      thu: 'Thu',
      fri: 'Fri',
      sat: 'Sat',
    },
    previousYear: 'Previous year',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    nextYear: 'Next year',
  },
  categories: {
    groceries: 'Groceries',
    dining: 'Dining',
    transport: 'Transport',
    shopping: 'Shopping',
    utilities: 'Utilities',
    entertainment: 'Entertainment',
    health: 'Health',
    cash: 'Cash',
    transfers: 'Transfers',
    other: 'Other',
    // Categories screen and inline add-category-row UI copy (distinct from the
    // seeded default-category display names above).
    addCategory: 'Add category',
    changeIconLabel: 'Change {{title}} icon',
    chooseIconHeading: 'Choose Icon',
    chooseNewIconLabel: 'Choose new category icon',
    colorLabel: 'Color',
    deleteLabel: 'Delete {{title}}',
    dismissIconPicker: 'Dismiss icon picker',
    iconOptionLabel: 'Choose icon {{icon}}',
    isDefaultLabel: '{{title}} is the default category',
    moveToBottomLabel: 'Move {{title}} to bottom',
    moveToTopLabel: 'Move {{title}} to top',
    namePlaceholder: 'Category name',
    newColorPrefix: 'New category color',
    rowColorPrefix: '{{title}} color',
    setAsDefaultLabel: 'Set {{title}} as default',
    titleFieldLabel: '{{title}} title',
    // The ultimate fallback display (src/categories/category-display.ts
    // NEUTRAL_CATEGORY) shown only when a category cannot be resolved AND
    // the default-category row itself is missing (e.g. before the seed
    // migration runs) — not the ordinary "Other" bucket above.
    uncategorized: 'Uncategorized',
  },
  forms: {
    // Field labels reused across two or more of the forms below (the account,
    // holding, transaction, and contribution create/edit screens), so callers
    // share one key instead of duplicating the same English/Ukrainian pair
    // per screen.
    fields: {
      amount: 'Amount',
      color: 'Color',
      currency: 'Currency',
      date: 'Date',
      icon: 'Icon',
      name: 'Name',
      selectCategory: 'Select category',
      time: 'Time',
    },
    account: {
      addTitle: 'Add Account',
      bank: 'Bank',
      cash: 'Cash',
      crypto: 'Crypto',
      editTitle: 'Edit Account',
      initialValue: 'Initial value',
      kind: 'Kind',
    },
    contribution: {
      addTitle: 'Add Contribution',
      errorMessage: 'Please try again.',
      errorTitle: 'Could not add contribution',
      save: 'Save contribution',
    },
    holding: {
      addContribution: 'Add contribution',
      addTitle: 'Add Holding',
      annualRatePct: 'Annual Rate %',
      // Frequency vocabulary shared by the term-deposit Compounding chip row
      // and the bond Coupon frequency chip row within this same screen.
      annually: 'Annually',
      balance: 'Balance',
      biWeekly: 'Bi-weekly',
      bond: 'Bond',
      bondKind: 'Bond Kind',
      card: 'Card',
      compounding: 'Compounding',
      contributionAmount: 'Contribution {{index}} Amount',
      contributionDate: 'Contribution {{index}} Date',
      corporate: 'Corporate',
      couponFrequency: 'Coupon frequency',
      couponPct: 'Coupon %',
      cryptoAsset: 'Crypto Asset',
      deposit: 'Deposit',
      editTitle: 'Edit Holding',
      faceValue: 'Face Value',
      government: 'Government',
      jar: 'Jar',
      maturityDate: 'Maturity Date',
      monthly: 'Monthly',
      purchaseDate: 'Purchase Date',
      purchasePrice: 'Purchase Price (total paid)',
      purchasePricePlaceholder: 'Defaults to nominal',
      quantity: 'Quantity',
      quarterly: 'Quarterly',
      recapitalization: 'Recapitalization',
      remove: 'Remove',
      removeContribution: 'Remove contribution {{index}}',
      selectDatePlaceholder: 'Select a date',
      semiannually: 'Semiannually',
      termMonths: 'Term (Months)',
      type: 'Type',
    },
    transaction: {
      addTitle: 'Add Transaction',
      apply: 'Apply',
      applyCategoryMessage:
        'Apply "{{category}}" to all transactions named "{{name}}"? This also applies to future imports.',
      applyCategoryToAll: 'Apply Category to All',
      applyToThisOne: 'Just for this one',
      category: 'Category',
      convertToExchange: 'Convert to exchange',
      deleteConfirmMessage: 'This transaction will be permanently removed.',
      deleteConfirmTitle: 'Delete Transaction',
      description: 'Description',
      editTitle: 'Edit Transaction',
      exchange: 'Exchange',
      expense: 'Expense',
      from: 'From',
      income: 'Income',
      monobankNotice: 'This transaction was imported from Monobank and cannot be edited.',
      selectHolding: 'Select holding',
      title: 'Transaction',
      to: 'To',
      valueIn: 'Value In',
      valueOut: 'Value Out',
    },
  },
  accounts: {
    addAccount: 'Add account',
    emptyState: 'No accounts yet',
    icon: '{{name}} icon',
    title: 'Accounts',
  },
  accountDetail: {
    addHolding: 'Add holding',
    addressLabel: 'Address',
    apiKeyLabel: 'API key',
    apiSecretLabel: 'API secret',
    balanceLabel: 'Balance',
    binance: 'Binance',
    binanceApiKeyPlaceholder: 'Binance API key',
    binanceApiSecretPlaceholder: 'Binance API secret',
    binanceConnected: 'Binance connected',
    btcAddressPlaceholder: 'BTC address',
    checking: 'Checking…',
    connectBinance: 'Connect Binance',
    connectedAs: 'Connected as {{name}}',
    connectedElsewhere: 'Monobank is connected to another account',
    connectMonobank: 'Connect Monobank',
    connectWallet: 'Connect wallet',
    couldNotConnectBinance: 'Could not connect Binance',
    couldNotConnectWallet: 'Could not connect wallet',
    couldNotSaveCredentials: 'Could not save credentials',
    couldNotSaveToken: 'Could not save token',
    disconnectAction: 'Disconnect',
    disconnectErrorTitle: 'Could not disconnect',
    disconnectMonobank: 'Disconnect Monobank',
    disconnectMonobankMessage:
      'This clears the connection and the stored token. Your holdings and transactions stay as a manual snapshot.',
    disconnectProvider: 'Disconnect {{provider}}',
    disconnectProviderMessage: {
      binance:
        'This clears the connection and the stored API key. Your BTC holding stays as a manual snapshot.',
      wallet: 'This clears the connection. Your BTC holding stays as a manual snapshot.',
    },
    holdingsHeading: 'Holdings',
    invalidApiKeyOrSecret: 'Invalid API key or secret',
    invalidBtcAddress: 'Invalid BTC address',
    invalidToken: 'Invalid token',
    lastSync: 'Last sync: {{time}}',
    monobankAlreadyConnected: 'A Monobank account is already connected',
    monobankRateLimited: 'Monobank is rate-limiting requests right now. Please try again shortly.',
    monobankTimeout: 'Monobank did not respond in time. Please try again.',
    monobankTokenPlaceholder: 'Monobank token',
    never: 'Never',
    noConnectionFound: 'No {{name}} connection found',
    noMonobankConnection: 'No Monobank account connected',
    noMonobankToken: 'No Monobank token found; connect an account before syncing.',
    noTokenMessage: 'Add your Monobank token above before connecting.',
    openBinanceLink: 'Open Binance API Management',
    openMonobankLink: 'Open api.monobank.ua',
    pasteApiKey: 'Paste API key from clipboard',
    pasteApiSecret: 'Paste API secret from clipboard',
    pasteFromClipboard: 'Paste from clipboard',
    sourceConnectedElsewhere: '{{source}} is already connected to another account',
    sourceLabel: 'Source',
    synchronization: 'Synchronization',
    syncing: 'Syncing…',
    syncNow: 'Sync now',
    tokenLabel: 'Token',
    tokenSaved: 'Token saved',
    tryAgainMessage: 'Please try again.',
    unsupportedCurrencyCode: 'Unsupported Monobank currency code: {{code}}',
    wallet: 'Wallet',
    walletConnected: 'Wallet connected',
  },
  holdingDetail: {
    addTransaction: 'Add transaction',
    // The derived lifecycle ledger lines (src/holdings/derived-entries.ts) a
    // term-deposit or bond's Holding-detail screen renders inline — a bank
    // statement's own line structure, not a stored transaction.
    capitalization: 'Capitalization',
    computed: 'Computed',
    coupon: 'Coupon',
    cost: 'Cost',
    expectedProfit: 'Expected profit',
    grossValue: 'Gross value',
    incomeTax: 'Income tax {{pct}}%',
    interest: 'Interest',
    interestAccrual: 'Interest accrual',
    interestEarned: 'Interest earned',
    militaryLevy: 'Military levy {{pct}}%',
    openingDeposit: 'Opening deposit',
    principal: 'Principal',
    projected: 'Projected',
    purchase: 'Purchase',
    redemption: 'Redemption',
    tax: 'Tax',
    taxWithheld: 'Tax withheld',
    topUp: 'Top-up',
    transactionsHeading: 'Transactions',
    valueLabel: 'Value',
  },
  home: {
    // The shared Home/Statistics date-range sheet (see
    // src/screens/home/date-range-field) — its own literals, namespaced under
    // Home since that is where the component lives.
    dateRangeField: {
      apply: 'Apply',
      clear: 'Clear',
      from: 'From {{date}}',
      heading: 'Date Range',
      label: 'Date range',
      until: 'Until {{date}}',
    },
    emptyTransactions: 'No transactions',
    filterAccounts: 'Accounts',
    filterCategories: 'Categories',
    // Also the home-screen widget's headline: it travels inside the snapshot
    // (src/widget/net-worth-snapshot.ts) rather than a Localizable.strings
    // bundle, and reuses THIS key so the two can never drift apart.
    netWorth: 'Net worth',
    syncFailedMessage: "Couldn't sync {{accounts}}.",
    // The determinate sync progress bar's label — the whole-run indicator on the
    // transactions list. `completed`/`total` are HOLDINGS counts, not cards: the
    // count of the holdings the user sees, with `completed` starting at the
    // holdings that do not require syncing (see useSyncProgress).
    syncingHoldings: 'Syncing holdings {{completed}}/{{total}}',
    title: 'Home',
    today: 'Today',
    yesterday: 'Yesterday',
  },
  statistics: {
    accountContribution: 'Account Contribution',
    byType: 'By Type',
    expensesByCategory: 'Expenses by Category',
    filterAccounts: 'Accounts',
    filterCategories: 'Categories',
    netWorthOverTime: 'Net Worth Over Time',
    noSpendingToShow: 'No Spending To Show',
    resetTrendCategories: 'Reset',
    spendingTrendByCategory: 'Spending Trend by Category',
    title: 'Statistics',
  },
  // The Home and Holding-detail rows both render the same fallback label
  // (src/transactions/default-description.ts) for a transaction with no
  // user-entered description, so it lives in its own small namespace rather
  // than duplicated under either screen.
  transactions: {
    defaultDescriptionExpense: '{{name}} expense',
    defaultDescriptionIncome: '{{name}} income',
    exchangeFrom: 'Exchange from {{name}}',
    exchangeTo: 'Exchange to {{name}}',
  },
  // Shared design-system components (src/design-system/components/*) that
  // carry their own hardcoded copy rather than taking it as a prop.
  components: {
    netWorthLine: {
      loadingHistory: 'Loading History',
    },
    pieChart: {
      emptyDefault: 'No Accounts To Show',
    },
    swipeableRow: {
      confirmMessage: 'This cannot be undone.',
    },
  },
  // The app-boot gate (src/db/migrations.gate.tsx) — its own UI is the very
  // first paint, before the navigator mounts, so it is keyed here rather than
  // under `common` even though it renders no other chrome.
  migrations: {
    error: 'Migration error: {{message}}',
    preparing: 'Preparing database…',
  },
};
