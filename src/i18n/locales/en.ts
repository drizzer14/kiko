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
    clear: 'Clear',
    cancel: 'Cancel',
    delete: 'Delete',
    duplicate: 'Duplicate',
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
    dataExport: {
      copied: 'Copied',
      copyKey: 'Copy Key',
      description:
        'Export all your accounts, holdings, transactions, and categories to an encrypted file you can keep as a backup or move to another device.',
      errorMessage: 'Please try again.',
      errorTitle: 'Export Failed',
      exportButton: 'Export Data',
      includeSecrets: 'Include saved passwords & keys',
      includeSecretsHint:
        'Adds your saved Monobank token and Binance API keys to the file, so a restore can keep syncing without reconnecting. Turn this off to export only your data.',
      keyLabel: 'Encryption Key',
      keyWarning:
        'Save this key somewhere safe — it will not be shown again, and it is the only way to unlock this file.',
      shareFile: 'Share File',
      title: 'Export Data',
    },
    dataImport: {
      chooseFile: 'Choose File',
      confirmButton: 'Replace Data',
      confirmMessage:
        'Importing replaces every account, holding, transaction, and category currently in Kiko with the contents of this file. This cannot be undone.',
      confirmTitle: 'Replace All Data?',
      description: 'Choose a Kiko export file and enter its encryption key to restore your data.',
      errorTitle: 'Import Failed',
      importButton: 'Import Data',
      invalidFileError: 'This does not look like a valid Kiko export file.',
      keyLabel: 'Encryption Key',
      keyPlaceholder: 'Paste the key from your export',
      keyTooShortError: 'The key looks too short — paste the full key from your export.',
      noFileError: 'Choose a file to import.',
      pasteKey: 'Paste key from clipboard',
      successMessage: 'Import complete — {{count}} accounts restored.',
      title: 'Import Data',
      wrongFileTypeError: 'Choose a Kiko export file (.kiko).',
      wrongKeyError: 'The key is wrong, or the file is corrupted.',
    },
    footer: {
      appName: 'Kiko',
      copyrightHolder: 'Dmytro Vasylkivskyi',
      privacyPolicy: 'Privacy Policy',
    },
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
    namePlaceholder: 'Groceries',
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
      nameRequiredError: 'Enter a name.',
      saveErrorMessage: 'Please try again.',
      saveErrorTitle: 'Could not save',
      searchCurrencyPlaceholder: 'Search by code or name',
      selectCategory: 'Select category',
      selectCurrency: 'Select currency',
      time: 'Time',
    },
    account: {
      addTitle: 'Add Account',
      bank: 'Bank',
      bankConnectable: 'Connect and import statements.',
      bankDisclaimer:
        'Kiko is an independent app. It is not a bank and is not affiliated with or endorsed by any bank.',
      bankImportOnly: 'Statement import only — no live connection.',
      bankType: 'Bank type',
      cash: 'Cash',
      crypto: 'Crypto',
      editTitle: 'Edit Account',
      importOnlyBankHint: 'You can import a statement for this bank after saving.',
      initialValue: 'Initial value',
      initialValuePlaceholder: '1000.00',
      kind: 'Kind',
      namePlaceholder: 'Monobank',
      selectBankPlaceholder: 'Select a bank (optional)',
    },
    contribution: {
      addTitle: 'Add Contribution',
      amountError: 'Amount must be greater than 0.',
      amountPlaceholder: '500.00',
      errorMessage: 'Please try again.',
      errorTitle: 'Could not add contribution',
      save: 'Save contribution',
    },
    holding: {
      addContribution: 'Add contribution',
      addTitle: 'Add Holding',
      annualRateError: 'Enter a rate of 0 or higher.',
      annualRatePct: 'Annual Rate %',
      annualRatePlaceholder: '12',
      // Frequency vocabulary shared by the term-deposit Compounding chip row
      // and the bond Coupon frequency chip row within this same screen.
      annually: 'Annually',
      balance: 'Balance',
      balancePlaceholder: '1000.00',
      biWeekly: 'Bi-weekly',
      bond: 'Bond',
      bondKind: 'Bond Kind',
      card: 'Card',
      compounding: 'Compounding',
      contributionAmount: 'Contribution {{index}} Amount',
      contributionDate: 'Contribution {{index}} Date',
      contributionIncompleteError: "Fill in this contribution's amount and date, or remove it.",
      contributionPlaceholder: '500.00',
      contributions: 'Contributions',
      contributionsRequiredError: 'Add at least one contribution with an amount and a date.',
      corporate: 'Corporate',
      couponFrequency: 'Coupon frequency',
      couponPct: 'Coupon %',
      couponPctError: 'Enter a coupon of 0 or higher.',
      couponPlaceholder: '8',
      cryptoAsset: 'Crypto Asset',
      deposit: 'Deposit',
      details: 'Details',
      editTitle: 'Edit Holding',
      faceValue: 'Face Value',
      faceValueError: 'Enter a face value greater than 0.',
      faceValuePlaceholder: '1000.00',
      government: 'Government',
      jar: 'Jar',
      maturityDate: 'Maturity Date',
      maturityDateError: 'Maturity date must be after the purchase date.',
      monthly: 'Monthly',
      namePlaceholder: 'Apple shares',
      purchaseDate: 'Purchase Date',
      purchasePrice: 'Purchase Price (total paid)',
      purchasePricePlaceholder: 'Defaults to nominal',
      quantity: 'Quantity',
      quantityError: 'Enter a quantity greater than 0.',
      quantityPlaceholder: '10',
      quarterly: 'Quarterly',
      recapitalization: 'Recapitalization',
      remove: 'Remove',
      removeContribution: 'Remove contribution {{index}}',
      selectDatePlaceholder: 'Select a date',
      semiannually: 'Semiannually',
      termMonths: 'Term (Months)',
      termMonthsError: 'Enter a whole number of months greater than 0.',
      termMonthsPlaceholder: '12',
      terms: 'Terms',
      type: 'Type',
    },
    transaction: {
      addReturn: 'Add return',
      addTitle: 'Add Transaction',
      amountError: 'Amount must be greater than 0.',
      amountPlaceholder: '250.00',
      apply: 'Apply',
      applyCategoryMessage:
        'Apply "{{category}}" to all transactions named "{{name}}"? This also applies to future imports.',
      applyCategoryToAll: 'Apply Category to All',
      applyToThisOne: 'Just for this one',
      category: 'Category',
      convertAmountPlaceholder: '100.00',
      convertToExchange: 'Exchange',
      counterpartAmountError: 'Amount must be greater than 0.',
      description: 'Description',
      descriptionPlaceholder: 'Coffee',
      editTitle: 'Edit Transaction',
      exchange: 'Exchange',
      expense: 'Expense',
      from: 'From',
      holding: 'Holding',
      income: 'Income',
      remove: 'Remove',
      removeReturn: 'Remove return {{index}}',
      returnAmount: 'Return {{index}}',
      returnsHeading: 'Change Returns',
      returnTo: 'Return to {{index}}',
      selectCategoryError: 'Select a category.',
      selectCounterpartError: 'Select an account to convert into.',
      selectDestinationError: 'Select a destination account.',
      selectHolding: 'Select holding',
      split: 'Split',
      splitInvalidError: 'Enter a payment amount and at least one valid return.',
      syncedNotice: 'This was synced, so only the category can be changed.',
      title: 'Transaction',
      to: 'To',
      type: 'Type',
      valueIn: 'Value In',
      valueInError: 'Amount must be greater than 0.',
      valueInPlaceholder: '100.00',
      valueOut: 'Value Out',
      valueOutError: 'Amount must be greater than 0.',
      valueOutPlaceholder: '100.00',
    },
  },
  accounts: {
    addAccount: 'Add account',
    emptyState: 'No accounts yet',
    icon: '{{name}} icon',
    title: 'Accounts',
  },
  // The "add a bank" catalog copy (src/bank-sync/provider-catalog/): one
  // about/dataProvided/eligibility triple per native provider, shown on the
  // picker before any credential is entered. Guideline 5.6 remediation:
  // PrivatBank, bunq, and Starling entries were removed — Monobank is the
  // sole shipped provider.
  addBank: {
    monobank: {
      about:
        'Monobank is a Ukrainian mobile-only bank. Kiko connects with a personal API token you generate in the Monobank app.',
      dataProvided:
        'Balances, jars, and transaction history, refreshed automatically and on pull-to-refresh. Read-only — Kiko cannot move money.',
      eligibility: 'Works with any personal Monobank account. No business or FOP account needed.',
    },
  },
  accountDetail: {
    addBankAction: 'Add a bank',
    addHolding: 'Add holding',
    addressLabel: 'Address',
    apiKeyLabel: 'API key',
    apiSecretLabel: 'API secret',
    balanceLabel: 'Balance',
    binance: 'Binance',
    binanceApiKeyPlaceholder: 'Binance API key',
    binanceApiSecretPlaceholder: 'Binance API secret',
    binanceConnected: 'Binance connected',
    binanceKeychainDisclosure:
      "Your Binance API key is stored only in your device's Keychain, used only to fetch your own data directly from Binance, and is never sent to Kiko or any server.",
    btcAddressPlaceholder: 'BTC address',
    changeBankAction: 'Change bank',
    checking: 'Checking…',
    connectBinance: 'Connect Binance',
    connectedAs: 'Connected as {{name}}',
    connectMonobank: 'Connect Monobank',
    connectWallet: 'Connect wallet',
    couldNotConnectBinance: 'Could not connect Binance',
    couldNotConnectMonobank: 'Could not connect Monobank',
    couldNotConnectWallet: 'Could not connect wallet',
    couldNotSaveCredentials: 'Could not save credentials',
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
    importStatement: 'Import statement',
    invalidApiKeyOrSecret: 'Invalid API key or secret',
    invalidBTCAddress: 'Invalid BTC address',
    invalidToken: 'Invalid token',
    lastSync: 'Last sync: {{time}}',
    monobankKeychainDisclosure:
      "Your token is stored only in your device's Keychain, used only to fetch your own data directly from Monobank, and is never sent to Kiko or any server.",
    monobankRateLimited:
      'Monobank allows at most 1 request per 60 seconds. Wait a minute, then try again.',
    monobankTimeout: 'Monobank did not respond in time. Please try again.',
    monobankTokenPlaceholder: 'Monobank token',
    never: 'Never',
    noConnectionFound: 'No {{name}} connection found',
    noMonobankConnection: 'No Monobank account connected',
    noMonobankToken: 'No Monobank token found; connect an account before syncing.',
    openBinanceLink: 'Open Binance API Management',
    openMonobankLink: 'Open api.monobank.ua',
    pasteApiKey: 'Paste API key from clipboard',
    pasteApiSecret: 'Paste API secret from clipboard',
    pasteFromClipboard: 'Paste from clipboard',
    sourceLabel: 'Source',
    synchronization: 'Synchronization',
    syncing: 'Syncing…',
    syncNow: 'Sync',
    tokenLabel: 'Token',
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
    // The floating "+" action's accessibility label (the global add-transaction
    // FAB pinned over the Home list).
    addTransaction: 'Add transaction',
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
    spendingTrendByCategory: 'Spending Trend by Category',
    title: 'Statistics',
    // The spending-trend chart's filter: a single "Filters" button (its label
    // reflects the applied selection) opening a bottom sheet.
    trendFilter: {
      title: 'Filters',
      selection: 'Selection',
      manual: 'Manual',
      top: 'Top',
      amount: 'Amount',
      by: 'By',
      // The section header above the manual-mode category list.
      categories: 'Categories',
      // The three "Top N" ranking measures. Shared by the "By" chips AND the
      // button's `{{measure}}` interpolation (English has no case inflection).
      measure: {
        contribution: 'Contribution',
        frequency: 'Frequency',
        rising: 'Rising',
      },
      // The applied-filter button label. `manual` uses i18next plurals on
      // `count` (English selects _one / _other; the _few / _many forms exist
      // only to mirror Ukrainian's plural set — see uk.ts — so the two
      // catalogues keep an identical key set and `typeof en` still types uk).
      // `allCategories` is the empty-manual case. `top` interpolates the
      // instrumental-case `{{measure}}`.
      button: {
        allCategories: 'All Categories',
        manual_one: '{{count}} Category',
        manual_few: '{{count}} Categories',
        manual_many: '{{count}} Categories',
        manual_other: '{{count}} Categories',
        top: 'Top {{count}} by {{measure}}',
      },
    },
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
      showAll: 'Show all',
      showLess: 'Show less',
    },
  },
  // The app-boot gate (src/migration/migrations.gate.tsx) — its own UI is the very
  // first paint, before the navigator mounts, so it is keyed here rather than
  // under `common` even though it renders no other chrome.
  migrations: {
    error: 'Migration error: {{message}}',
    preparing: 'Preparing database…',
  },
  // The shared preview + target-holding screen (Phase 1b,
  // src/screens/statement-import/statement-import.screen.tsx) that both statement-
  // import entry points converge on — see docs/plans/statement-import.md section B.
  statementImport: {
    previewHeading: 'Statement preview',
    reading: 'Reading the file…',
    unrecognizedFormat:
      "We don't recognize this file's format. Kiko can import statements from: {{formats}}.",
    chooseHolding: 'Choose a holding',
    createNewHolding: 'Create new holding',
    importButton: 'Import',
    importedCount: 'Imported {{imported}} of {{total}}',
    // A row a format's parse could not resolve (e.g. a PrivatBank currency
    // word its abbreviation map doesn't cover yet, section C.1) — excluded
    // from the import, but surfaced honestly rather than silently dropped
    // (see `ParsedStatement.unresolvedRows` in parser.ts). English selects
    // _one/_other; the _few/_many forms exist only to mirror Ukrainian's
    // plural set (see uk.ts), so the two catalogues keep an identical key
    // set and `typeof en` still types uk.
    unresolvedRowsSkipped_one: '{{count}} row skipped: unrecognized currency',
    unresolvedRowsSkipped_few: '{{count}} rows skipped: unrecognized currency',
    unresolvedRowsSkipped_many: '{{count}} rows skipped: unrecognized currency',
    unresolvedRowsSkipped_other: '{{count}} rows skipped: unrecognized currency',
    // Shown above the preview's currency list ONLY when a file mixes more
    // than one currency (a multi-card PrivatBank export, section C.1) —
    // helps the user pick a holding that actually matches BEFORE importing,
    // since `importStatement` excludes any row whose currency doesn't match
    // the target holding's (Task 3 review, CRITICAL fix).
    detectedCurrenciesLabel: 'This file contains multiple currencies:',
    // Rows excluded from the write because their currency didn't match the
    // target holding's — Kiko has no FX, so a mismatched row is excluded,
    // never converted or written verbatim (see `ImportResult.skippedWrongCurrency`
    // in import-statement.ts).
    skippedWrongCurrency_one: '{{count}} row in a different currency was skipped',
    skippedWrongCurrency_few: '{{count}} rows in a different currency were skipped',
    skippedWrongCurrency_many: '{{count}} rows in a different currency were skipped',
    skippedWrongCurrency_other: '{{count}} rows in a different currency were skipped',
    // The picked file recognized as a DIFFERENT bank's format than the one
    // scoped by `expectedFormatId` (device-feedback-round-1 item 5) — a more
    // specific state than the generic `unrecognizedFormat`, so the user
    // knows WHY (wrong bank's export), not just that the file failed.
    bankMismatch: "This doesn't look like a {{bank}} statement. Pick the matching file.",
  },
  // The human-readable display name per ISO currency code, shown alongside the
  // code in the searchable CurrencyField (trigger label, rows, accessibility
  // label) and matched against the search query. Keyed by letter code so a
  // reader looks a name up as t(`currencyNames.${code}`). English is the
  // canonical label carried over from the retired currency.ts `currencyName`
  // map; uk.ts mirrors this key set with the Ukrainian names.
  currencyNames: {
    UAH: 'Ukrainian Hryvnia',
    USD: 'US Dollar',
    EUR: 'Euro',
    GBP: 'British Pound',
    CHF: 'Swiss Franc',
    AED: 'UAE Dirham',
    AFN: 'Afghan Afghani',
    ALL: 'Albanian Lek',
    AMD: 'Armenian Dram',
    AOA: 'Angolan Kwanza',
    ARS: 'Argentine Peso',
    AUD: 'Australian Dollar',
    AZN: 'Azerbaijani Manat',
    BDT: 'Bangladeshi Taka',
    BGN: 'Bulgarian Lev',
    BHD: 'Bahraini Dinar',
    BIF: 'Burundian Franc',
    BND: 'Brunei Dollar',
    BOB: 'Bolivian Boliviano',
    BRL: 'Brazilian Real',
    BWP: 'Botswana Pula',
    BYN: 'Belarusian Ruble',
    CAD: 'Canadian Dollar',
    CDF: 'Congolese Franc',
    CLP: 'Chilean Peso',
    CNY: 'Chinese Yuan',
    COP: 'Colombian Peso',
    CRC: 'Costa Rican Colon',
    CUP: 'Cuban Peso',
    CZK: 'Czech Koruna',
    DJF: 'Djiboutian Franc',
    DKK: 'Danish Krone',
    DZD: 'Algerian Dinar',
    EGP: 'Egyptian Pound',
    ETB: 'Ethiopian Birr',
    GEL: 'Georgian Lari',
    GHS: 'Ghanaian Cedi',
    GMD: 'Gambian Dalasi',
    GNF: 'Guinean Franc',
    HKD: 'Hong Kong Dollar',
    HRK: 'Croatian Kuna',
    HUF: 'Hungarian Forint',
    IDR: 'Indonesian Rupiah',
    ILS: 'Israeli New Shekel',
    INR: 'Indian Rupee',
    IQD: 'Iraqi Dinar',
    ISK: 'Icelandic Krona',
    JOD: 'Jordanian Dinar',
    JPY: 'Japanese Yen',
    KES: 'Kenyan Shilling',
    KGS: 'Kyrgyzstani Som',
    KHR: 'Cambodian Riel',
    KRW: 'South Korean Won',
    KWD: 'Kuwaiti Dinar',
    KZT: 'Kazakhstani Tenge',
    LAK: 'Lao Kip',
    LBP: 'Lebanese Pound',
    LKR: 'Sri Lankan Rupee',
    LYD: 'Libyan Dinar',
    MAD: 'Moroccan Dirham',
    MDL: 'Moldovan Leu',
    MGA: 'Malagasy Ariary',
    MKD: 'Macedonian Denar',
    MNT: 'Mongolian Tugrik',
    MUR: 'Mauritian Rupee',
    MWK: 'Malawian Kwacha',
    MXN: 'Mexican Peso',
    MYR: 'Malaysian Ringgit',
    MZN: 'Mozambican Metical',
    NAD: 'Namibian Dollar',
    NGN: 'Nigerian Naira',
    NIO: 'Nicaraguan Cordoba',
    NOK: 'Norwegian Krone',
    NPR: 'Nepalese Rupee',
    NZD: 'New Zealand Dollar',
    OMR: 'Omani Rial',
    PEN: 'Peruvian Sol',
    PHP: 'Philippine Peso',
    PKR: 'Pakistani Rupee',
    PLN: 'Polish Zloty',
    PYG: 'Paraguayan Guarani',
    QAR: 'Qatari Riyal',
    RON: 'Romanian Leu',
    RSD: 'Serbian Dinar',
    SAR: 'Saudi Riyal',
    SCR: 'Seychellois Rupee',
    SDG: 'Sudanese Pound',
    SEK: 'Swedish Krona',
    SGD: 'Singapore Dollar',
    SLL: 'Sierra Leonean Leone',
    SOS: 'Somali Shilling',
    SRD: 'Surinamese Dollar',
    SZL: 'Swazi Lilangeni',
    THB: 'Thai Baht',
    TJS: 'Tajikistani Somoni',
    TND: 'Tunisian Dinar',
    TRY: 'Turkish Lira',
    TWD: 'New Taiwan Dollar',
    TZS: 'Tanzanian Shilling',
    UGX: 'Ugandan Shilling',
    UYU: 'Uruguayan Peso',
    UZS: 'Uzbekistani Som',
    VND: 'Vietnamese Dong',
    XAF: 'Central African CFA Franc',
    XOF: 'West African CFA Franc',
    YER: 'Yemeni Rial',
    ZAR: 'South African Rand',
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    USDT: 'Tether',
  },
};
