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
    noDataForRange: 'No data for this range',
    // A segment's position within its SegmentedControl group, e.g.
    // "1 of 2" — folded into each segment's accessibilityHint, since
    // React Native's own tab/tablist accessibility roles map to no trait
    // on iOS (RN 0.87).
    segmentPosition: '{{index}} of {{count}}',
  },
  settings: {
    appLock: {
      label: 'App lock',
      requireFaceIdOrPasscode: 'Require Face ID or passcode',
      hint: {
        passcodeNotSet: 'Set a device passcode in iOS Settings to use app lock.',
        passcodeOnly: 'No Face ID enrolled — your device passcode will be used.',
        unavailable: 'Biometric hardware is unavailable on this device.',
      },
    },
    baseCurrency: 'Base currency',
    categories: 'Categories',
    dataExport: {
      copied: 'Copied',
      copyKey: 'Copy key',
      description:
        'Export all your accounts, holdings, transactions, and categories to an encrypted file you can keep as a backup or move to another device.',
      errorMessage: 'Please try again.',
      errorTitle: 'Export failed',
      exportButton: 'Export data',
      includeSecrets: 'Include saved passwords & keys',
      includeSecretsHint:
        'Adds your saved Monobank token and Binance API keys to the file, so a restore can keep syncing without reconnecting. Turn this off to export only your data.',
      keyLabel: 'Encryption key',
      keyWarning:
        'Save this key somewhere safe — it will not be shown again, and it is the only way to unlock this file.',
      // The Settings screen's own row label — a menu item, always sentence
      // case — separate from `title` below, which is the nav header for the
      // same screen (a screen title, Title Case); the two roles read the
      // same string on the same screen otherwise, one casing wrong either way.
      rowLabel: 'Export data',
      shareFile: 'Share file',
      title: 'Export Data',
    },
    dataImport: {
      chooseFile: 'Choose file',
      confirmButton: 'Replace data',
      confirmMessage:
        'Importing replaces every account, holding, transaction, and category currently in Kiko with the contents of this file. This cannot be undone.',
      confirmTitle: 'Replace All Data?',
      description: 'Choose a Kiko export file and enter its encryption key to restore your data.',
      errorTitle: 'Import failed',
      importButton: 'Import data',
      invalidFileError: 'This does not look like a valid Kiko export file.',
      keyLabel: 'Encryption key',
      keyPlaceholder: 'Paste the key from your export',
      keyTooShortError: 'The key looks too short — paste the full key from your export.',
      noFileError: 'Choose a file to import.',
      pasteKey: 'Paste key from clipboard',
      // See `dataExport.rowLabel` above — same Settings-row-vs-nav-title split.
      rowLabel: 'Import data',
      successMessage: 'Import complete — {{count}} accounts restored.',
      title: 'Import Data',
      wrongFileTypeError: 'Choose a Kiko export file (.kiko).',
      wrongKeyError: 'The key is wrong, or the file is corrupted.',
    },
    footer: {
      appName: 'Kiko',
      copyrightHolder: 'Dmytro Vasylkivskyi',
      privacyPolicy: 'Privacy policy',
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
    // The eleventh default category, seeded by its own
    // later migration (0039) — the interest portion of a linked loan
    // payment (never its principal) files under this key.
    loan_interest: 'Loan interest',
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
      // The generic date/time field's own "nothing picked yet" copy — every
      // DateField/TimeField call site passes one of these two explicitly
      // (never its own `label` repeated as the unset-value text), including
      // the holding form's date fields, which used to carry a near-
      // duplicate copy of this same pair under `forms.holding`.
      selectDatePlaceholder: 'Select a date',
      selectTimePlaceholder: 'Select a time',
      time: 'Time',
    },
    account: {
      addTitle: 'Add Account',
      bank: 'Bank',
      bankColumnMappingOnly: 'Import with column mapping',
      bankConnectable: 'Connect and import statements.',
      bankDisclaimer:
        'Kiko is an independent app. It is not a bank and is not affiliated with or endorsed by any bank.',
      bankImportOnly: 'Statement import only — no live connection.',
      bankType: 'Bank type',
      cash: 'Cash',
      crypto: 'Crypto',
      debt: 'Debt',
      editTitle: 'Edit Account',
      importOnlyBankHint: 'You can import a statement for this bank after saving.',
      initialValue: 'Initial value',
      initialValueNegativeError: 'Initial value must be 0 or greater.',
      initialValuePlaceholder: '1000.00',
      initialValueRequiredError: 'Enter an initial value.',
      kind: 'Kind',
      // The account-kind SelectField's placeholder — unreachable today (an
      // account's kind is always a concrete value, never `null`), kept for
      // the SelectField contract's `selected: null` case, same as every
      // other select field's placeholder.
      kindPlaceholder: 'Select an account kind',
      // The account-kind SelectField's sheet header — Title Case, distinct
      // from the sentence-case field label (`kind` above).
      kindSheetTitle: 'Select an Account Kind',
      kindSubtitle: {
        bank: 'Synced or imported from a bank statement.',
        cash: 'Cash you hold outside a bank.',
        crypto: 'A wallet or exchange account.',
        debt: 'A loan or debt you owe.',
        metals: 'Gold, silver, platinum, palladium.',
        property: 'Real estate, car, valuables, money you lent.',
      },
      metals: 'Precious metals',
      namePlaceholder: 'Monobank',
      noBank: 'Free',
      property: 'Property',
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
      annualRatePct: 'Annual rate',
      annualRatePlaceholder: '12',
      // Frequency vocabulary shared by the term-deposit Compounding chip row
      // and the bond Coupon frequency select field within this same screen.
      annually: 'Annually',
      balance: 'Balance',
      balancePlaceholder: '1000.00',
      biWeekly: 'Bi-weekly',
      bond: 'Bond',
      bondKind: 'Bond kind',
      card: 'Card',
      compounding: 'Compounding',
      contributionAmount: 'Contribution {{index}} amount',
      contributionDate: 'Contribution {{index}} date',
      contributionIncompleteError: "Fill in this contribution's amount and date, or remove it.",
      contributionPlaceholder: '500.00',
      contributions: 'Contributions',
      contributionsRequiredError: 'Add at least one contribution with an amount and a date.',
      corporate: 'Corporate',
      couponFrequency: 'Coupon frequency',
      couponFrequencyPlaceholder: 'Select a frequency',
      couponFrequencyRequiredError: 'No coupon frequency selected.',
      // The bond coupon-frequency SelectField's sheet header — Title Case,
      // distinct from the sentence-case field label above.
      couponFrequencySheetTitle: 'Select a Frequency',
      couponPct: 'Coupon',
      couponPctError: 'Enter a coupon of 0 or higher.',
      couponPlaceholder: '8',
      // The ISIN-mode summary row's own label (SummaryTable), kept apart from
      // the field label `couponPct`: the row's value already carries the "%"
      // sign, so neither label may ever gain one.
      couponSummaryLabel: 'Coupon',
      cryptoAsset: 'Crypto asset',
      deposit: 'Deposit',
      details: 'Details',
      // The Bond form's ISIN-mode hint: Diia itself sells no
      // bonds, it is a storefront for a partner bank/broker, so the bond is
      // added under whichever institution the user actually picked there.
      diiaHint: 'Bought in Diia? Add the bond under the bank or broker you chose there.',
      editTitle: 'Edit Holding',
      faceValue: 'Face value',
      faceValueError: 'Enter a face value greater than 0.',
      faceValuePlaceholder: '1000.00',
      government: 'Government',
      isin: 'ISIN',
      isinCheckDigitError: 'ISIN check digit is wrong.',
      isinCurrencyMismatchError: "This ISIN's currency doesn't match the holding's currency.",
      isinFormatError: 'Enter a valid ISIN.',
      isinMode: 'Entry mode',
      isinModeIsin: 'ISIN',
      isinModeManual: 'Manual',
      isinNotInRegister: 'Not in the NBU register.',
      isinPlaceholder: 'UA4000234215',
      isinRegisterNotLoaded: 'Register not loaded yet.',
      isinRequiredError: "Enter the bond's ISIN.",
      jar: 'Jar',
      loan: 'Loan',
      // The Loan form's own kind SelectField option map; see loanKindLabel.
      loanKind: {
        carLoan: 'Car loan',
        consumerLoan: 'Consumer loan',
        mortgage: 'Mortgage',
        personal: 'From a person',
      },
      loanKindLabel: 'Loan kind',
      // The loan-kind select field's placeholder — unreachable today (see
      // `categoryPlaceholder`'s own doc comment).
      loanKindPlaceholder: 'Select a loan kind',
      // The loan-kind SelectField's sheet header — Title Case, distinct from
      // the sentence-case field label (`loanKindLabel` above).
      loanKindSheetTitle: 'Select a Loan Kind',
      // The loan-payment matcher's own optional inputs — the "Paid from"
      // holding picker's field label + its synthetic "None" row, and the
      // lender's own name/IBAN text fields. None of these are required.
      loanLenderIban: 'Lender IBAN',
      loanLenderIbanPlaceholder: 'UA123456789012345678901234567',
      loanLenderName: 'Lender name',
      loanLenderNamePlaceholder: 'e.g. PrivatBank',
      loanPaidFrom: 'Paid from',
      loanPaidFromNone: 'None',
      loanPrincipal: 'Principal',
      loanPrincipalError: 'Principal must be greater than 0.',
      loanPrincipalPlaceholder: '1000.00',
      // The Loan form's own schedule SegmentedControl option map.
      loanSchedule: {
        annuity: 'Annuity',
        differentiated: 'Differentiated',
        none: 'No schedule',
      },
      loanScheduleLabel: 'Schedule',
      loanStartDate: 'Start date',
      loanStartDateError: 'No start date selected.',
      maturityDate: 'Maturity date',
      maturityDateError: 'Maturity date must be after the purchase date.',
      maturityDateRequiredError: 'No maturity date selected.',
      metal: 'Precious metal',
      metalForm: 'Form',
      metalFormBankAccount: 'Metal account',
      metalFormBar: 'Bar',
      metalFormCoin: 'Coin',
      metalKind: {
        gold: 'Gold',
        palladium: 'Palladium',
        platinum: 'Platinum',
        silver: 'Silver',
      },
      metalUnit: 'Unit',
      metalUnitG: 'Grams',
      metalUnitOz: 'Troy ounces',
      monthly: 'Monthly',
      namePlaceholder: 'Apple shares',
      propertyCategory: {
        businessShare: 'Business share',
        loanGiven: 'Loan given',
        other: 'Other',
        realEstate: 'Real estate',
        valuable: 'Valuable',
        vehicle: 'Vehicle',
      },
      propertyCost: 'Cost',
      propertyCostError: 'Enter a cost greater than 0.',
      propertyCostPlaceholder: '1000.00',
      propertyItem: 'Property',
      purchaseDate: 'Purchase date',
      purchaseDateRequiredError: 'No purchase date selected.',
      purchasePrice: 'Purchase price (total paid)',
      purchasePricePlaceholder: 'Defaults to nominal',
      purity: 'Purity',
      purityError: 'Enter a fineness above 0 and up to 1000 ‰.',
      purityPlaceholder: '999.9',
      quantity: 'Quantity',
      quantityError: 'Enter a quantity greater than 0.',
      quantityPlaceholder: '10',
      quarterly: 'Quarterly',
      recapitalization: 'Recapitalization',
      remove: 'Remove',
      removeContribution: 'Remove contribution {{index}}',
      semiannually: 'Semiannually',
      switchToManual: 'Switch to manual',
      termMonths: 'Term',
      termMonthsError: 'Enter a whole number of months greater than 0.',
      termMonthsMaxError: 'Enter a whole number of months from 1 to {{max}}.',
      termMonthsPlaceholder: '12',
      termUnitMonths: 'Months',
      termUnitYears: 'Years',
      termYearsError: 'Enter a whole number of years greater than 0.',
      termYearsMaxError: 'Enter a whole number of years from 1 to {{max}}.',
      terms: 'Terms',
      type: 'Type',
      // The holding-type SelectField's placeholder — unreachable today (a
      // holding's type is always a concrete value, never `null`), kept for
      // the SelectField contract's `selected: null` case, same as every
      // other select field's placeholder.
      typePlaceholder: 'Select a type',
      // The holding-type SelectField's sheet header — Title Case, distinct
      // from the sentence-case field label (`type` above).
      typeSheetTitle: 'Select a Type',
    },
    lot: {
      addTitle: 'Add Lot',
      buy: 'Buy',
      quantity: 'Quantity',
      quantityError: 'Enter a quantity greater than 0.',
      quantityPlaceholder: '10',
      save: 'Save lot',
      sell: 'Sell',
      sellExceedsError: "You can't sell more than you currently hold.",
      totalCost: 'Total cost',
      totalCostError: 'Total cost must be greater than 0.',
      totalCostPlaceholder: '1000.00',
      type: 'Type',
    },
    pricePoint: {
      // Loan-specific title/field/button/error `PricePointFormScreen` applies
      // once the holding loads as a loan; `loanValueError` also accepts 0.
      loanSave: 'Save outstanding',
      loanTitle: 'Update Outstanding',
      loanValue: 'Outstanding',
      loanValueError: 'Outstanding must be 0 or greater.',
      save: 'Save value',
      title: 'Update Value',
      value: 'Value',
      valueError: 'Value must be greater than 0.',
      valuePlaceholder: '1000.00',
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
      comment: 'Comment',
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
      // The auto-suggested loan-payment link's own caption, shown above its
      // Undo action — a caption, so it carries the final "." (see
      // `loanLinkUndo` below, a button label, which does not).
      loanLinkedAuto: 'Linked automatically.',
      loanLinkUndo: 'Undo',
      loanPayment: 'Loan payment',
      // The loan-payment picker's own "clear the link" row/value — distinct
      // wording from `noBank`'s "Free" (a different field's own "no pick"
      // copy), since this field's "no loan" state is itself a MEANINGFUL,
      // stored choice (`loanLinkRejected`), not just an empty default.
      loanPaymentNone: 'None',
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
      syncedNotice: 'This was synced, so only the category and loan link can be changed.',
      title: 'Transaction',
      to: 'To',
      type: 'Type',
      // The transaction-type SelectField's placeholder — unreachable today
      // (a transaction's mode is always a concrete value, never `null`),
      // kept for the SelectField contract's `selected: null` case, same as
      // every other select field's placeholder.
      typePlaceholder: 'Select a transaction type',
      // The transaction-type SelectField's sheet header — Title Case,
      // distinct from the sentence-case field label (`type` above).
      typeSheetTitle: 'Select a Transaction Type',
      valueIn: 'Value in',
      valueInError: 'Amount must be greater than 0.',
      valueInPlaceholder: '100.00',
      valueOut: 'Value out',
      valueOutError: 'Amount must be greater than 0.',
      valueOutPlaceholder: '100.00',
    },
    // The unit a numeric field shows after its value (`TextField`'s
    // `suffix`), never inside its label.
    units: {
      grams: 'g',
      months: 'mo',
      percent: '%',
      perMille: '‰',
      pieces: 'pcs',
      troyOunces: 'oz',
      years: 'yr',
    },
  },
  accounts: {
    addAccount: 'Add account',
    // The accounts list's own "Debts" section heading, above the debt
    // accounts' own drag-and-drop grid.
    debtsSection: 'Debts',
    emptyState: 'No accounts yet',
    icon: '{{name}} icon',
    // The accounts list's own "Property" section heading, above the
    // property accounts' own drag-and-drop grid — mirrors `debtsSection`.
    propertySection: 'Property',
    title: 'Accounts',
  },
  // The "add a bank" catalog copy (src/bank-sync/provider-catalog/): one
  // about/eligibility pair per native provider, shown on the picker before
  // any credential is entered. Guideline 5.6 remediation: PrivatBank, bunq,
  // and Starling entries were removed — Monobank is the sole shipped
  // provider.
  addBank: {
    monobank: {
      about:
        'Monobank is a Ukrainian mobile-only bank. Kiko connects with a personal API token you generate in the Monobank app.',
      eligibility: 'Works with any personal Monobank account. No business or FOP account needed.',
    },
  },
  accountDetail: {
    addBankAction: 'Add a bank',
    // The `AddBankProviderSheet` header — a sheet title, Title Case — kept
    // separate from `addBankAction` above (the Button that opens it, sentence
    // case): the same string reads correctly in only one of the two roles.
    addBankSheetTitle: 'Add a Bank',
    addHolding: 'Add holding',
    addressLabel: 'Address',
    apiKeyLabel: 'API key',
    apiKeyRequiredError: 'Enter the API key.',
    apiSecretLabel: 'API secret',
    balanceLabel: 'Balance',
    binance: 'Binance',
    binanceApiKeyPlaceholder: 'Binance API key',
    binanceApiSecretPlaceholder: 'Binance API secret',
    binanceConnected: 'Binance connected',
    binanceFundingResponseNotArray: 'Binance funding response was not an array',
    binanceKeychainDisclosure:
      "Your Binance API key is stored only in your device's Keychain, used only to fetch your own data directly from Binance, and is never sent to Kiko or any server.",
    binanceMissingBalancesArray: 'Binance account response did not contain a balances array',
    binanceMissingRowsArray: 'Binance simple-earn response did not contain a rows array',
    binanceNonNumericBalanceAmount: 'Binance balance contained a non-numeric free/locked amount',
    binanceNonNumericFundingAmount: 'Binance funding balance contained a non-numeric amount',
    binanceNonNumericPositionAmount: 'Binance simple-earn position contained a non-numeric amount',
    binanceRequestFailed: 'Binance request failed: {{status}}{{detail}}',
    blockExplorerRequestFailed: 'Block explorer request failed: {{status}}',
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
    monobankRequestFailed: 'Monobank request failed: {{status}}',
    monobankTimeout: 'Monobank did not respond in time. Please try again.',
    monobankTokenPlaceholder: 'Monobank token',
    never: 'Never',
    noBinanceCredentials: 'No Binance credentials stored; connect Binance before syncing.',
    noConnectionFound: 'No {{name}} connection found',
    noMonobankConnection: 'No Monobank account connected',
    noMonobankToken: 'No Monobank token found; connect an account before syncing.',
    noWalletAddressStored: 'No wallet address stored; connect a wallet before syncing.',
    openBinanceLink: 'Open Binance API management',
    openMonobankLink: 'Open api.monobank.ua',
    pasteApiKey: 'Paste API key from clipboard',
    pasteApiSecret: 'Paste API secret from clipboard',
    pasteFromClipboard: 'Paste from clipboard',
    secretRequiredError: 'Enter the secret key.',
    sourceLabel: 'Source',
    synchronization: 'Synchronization',
    syncing: 'Syncing…',
    syncNow: 'Sync',
    tokenLabel: 'Token',
    tokenRequiredError: 'Enter your Monobank token.',
    tryAgainMessage: 'Please try again.',
    unsupportedCurrencyCode: 'Unsupported Monobank currency code: {{code}}.',
    wallet: 'Wallet',
    walletAddressRequiredError: 'Enter a wallet address.',
    walletConnected: 'Wallet connected',
  },
  holdingDetail: {
    addLot: 'Add lot',
    addTransaction: 'Add transaction',
    // The derived lifecycle ledger lines (src/holdings/derived-entries.ts) a
    // term-deposit or bond's Holding-detail screen renders inline — a bank
    // statement's own line structure, not a stored transaction.
    capitalization: 'Capitalization',
    computed: 'Computed',
    coupon: 'Coupon',
    cost: 'Cost',
    // The ledger FlatList's own empty state — the SAME "no rows yet"
    // pattern `home.emptyTransactions` uses, replacing a bare
    // "Transactions" heading with nothing below it.
    emptyTransactions: 'No transactions',
    expectedProfit: 'Expected profit',
    // A priced type's (property, metal) breakdown gain row: gross value minus
    // cost basis. Reads green for a gain, red for a loss (MoneyText's own
    // sign-based tone, no explicit override — see `pricedBreakdownRows`).
    gain: 'Gain',
    grossValue: 'Gross value',
    incomeTax: 'Income tax {{pct}}%',
    interest: 'Interest',
    interestAccrual: 'Interest accrual',
    interestEarned: 'Interest earned',
    // The loan detail breakdown's rows (`loanLedgerSummary`): the interest
    // and principal parts of the linked payments, their total, and the
    // outstanding every other screen shows for the loan.
    interestPaid: 'Interest paid',
    // The loan detail screen's own "Linked payments" section heading: the
    // transactions the auto-link matcher (or a manual pick) linked to this
    // loan, newest first.
    linkedPayments: 'Linked payments',
    militaryLevy: 'Military levy {{pct}}%',
    // The loan detail screen's "next installment" panel (annuity/
    // differentiated only); its principal/interest split reuses the shared
    // labels below.
    nextInstallment: 'Next installment ({{date}})',
    openingDeposit: 'Opening deposit',
    outstanding: 'Outstanding',
    paidSoFar: 'Paid so far',
    principal: 'Principal',
    principalRepaid: 'Principal repaid',
    projected: 'Projected',
    purchase: 'Purchase',
    redemption: 'Redemption',
    sale: 'Sale',
    tax: 'Tax',
    taxWithheld: 'Tax withheld',
    topUp: 'Top-up',
    transactionsHeading: 'Transactions',
    // The loan footer action's label — writes a correction to the loan's
    // manual outstanding series via `PricePointForm` (same mechanism as
    // `updateValue` below, for a priced holding).
    updateOutstanding: 'Update outstanding',
    updateValue: 'Update value',
    // A priced type's (property, metal) breakdown value row — its current
    // priced value, distinct from `grossValue` (the deposit/bond breakdown's
    // OWN row, which reads wrong here: a priced type has no gross-vs-net
    // distinction, since it withholds no tax).
    value: 'Value',
    valueLabel: 'Value',
  },
  home: {
    // The floating "+" action's accessibility label (the global add-transaction
    // FAB pinned over the Home list).
    addTransaction: 'Add transaction',
    // The shared Home/Statistics date-range sheet (see
    // src/design-system/components/date-range-field) — its own literals,
    // namespaced under Home since that is the copy's original owner.
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
    // The "Debts" total shown under the account pie — a debt's own
    // negative held value, rendered through MoneyText.
    debtsTotal: 'Debts',
    expensesByCategory: 'Expenses by Category',
    filterAccounts: 'Accounts',
    filterCategories: 'Categories',
    netWorthOverTime: 'Net Worth Over Time',
    noSpendingToShow: 'No spending to show',
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
        allCategories: 'All categories',
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
    // The plain fallback with no holding name at all — used only when
    // the caller has no holding name yet (the
    // statement-import preview before a target holding is chosen), so an
    // empty name never interpolates into a dangling "{{name}} expense".
    defaultDescriptionExpensePlain: 'Expense',
    defaultDescriptionIncomePlain: 'Income',
    exchangeFrom: 'Exchange from {{name}}',
    exchangeTo: 'Exchange to {{name}}',
  },
  // Shared design-system components (src/design-system/components/*) that
  // carry their own hardcoded copy rather than taking it as a prop.
  components: {
    netWorthLine: {
      loadingHistory: 'Loading history',
    },
    pieChart: {
      emptyDefault: 'No accounts to show',
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
  // The shared preview + target-holding screen
  // (src/screens/statement-import/statement-import.screen.tsx) that both statement-
  // import entry points converge on.
  statementImport: {
    previewHeading: 'Statement Preview',
    reading: 'Reading the file…',
    unrecognizedFormat:
      "We don't recognize this file's format. Kiko can import statements from: {{formats}}.",
    // The field's own caption — a plain noun, like every other field label
    // on this screen (see `columnMapping.dateColumn`'s own "Date"), not the
    // imperative "Choose a holding" the sheet title below already carries;
    // repeating the same phrase as BOTH the caption and the closed field's
    // own placeholder read as the same line twice.
    chooseHolding: 'Holding',
    // The target-holding sheet's own header — a sheet title, Title Case —
    // kept separate from `chooseHolding` above (a field label on the same
    // screen, sentence case): see `accountDetail.addBankSheetTitle` for the
    // identical split.
    chooseHoldingSheetTitle: 'Choose a Holding',
    // The field's own "nothing picked yet" value: never `chooseHolding`
    // repeated verbatim — the established "Select a …" copy style shared
    // with `columnMapping.dateColumnPlaceholder` and its siblings.
    chooseHoldingPlaceholder: 'Select a holding',
    // Shown on the field when Import was pressed with no holding chosen —
    // "No X selected." is the shared picker-field error shape (see the
    // 7 columnMapping.*ColumnError keys and forms.holding.loanStartDateError),
    // never a synonym of the placeholder's own "Select …" verb above.
    chooseHoldingError: 'No holding selected.',
    createNewHolding: 'Create new holding',
    importButton: 'Import',
    // A caught `importStatement`/`importParsedStatement` failure shows as
    // this translated Alert — `import-data.screen.tsx`'s own
    // `Alert.alert(t(errorTitle), t(errorMessage))` pattern — never the raw,
    // untranslated `error.message` sitting inline at the page bottom.
    // Shared by BOTH `statement-import.screen.tsx` and
    // `column-mapping.screen.tsx`, since both run the exact same import
    // action through one error-title key for the same Alert.
    importErrorTitle: 'Import failed',
    importErrorMessage: 'Please try again.',
    importedCount: 'Imported {{imported}} of {{total}}',
    // The modal a successful Import shows, carrying the exact
    // same result text `ImportOutcome` already rendered inline — its "Done"
    // button (`common.done`) navigates back to the account screen.
    importResultTitle: 'Import Complete',
    // A row a format's parse could not resolve (e.g. a PrivatBank currency
    // word its abbreviation map doesn't cover yet) — excluded
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
    // than one currency (a multi-card PrivatBank export) —
    // helps the user pick a holding that actually matches BEFORE importing,
    // since `importStatement` excludes any row whose currency doesn't match
    // the target holding's.
    detectedCurrenciesLabel: 'This file contains multiple currencies:',
    // Rows excluded from the write because their currency didn't match the
    // target holding's — Kiko has no FX, so a mismatched row is excluded,
    // never converted or written verbatim (see `ImportResult.skippedWrongCurrency`
    // in import-statement.ts).
    skippedWrongCurrency_one: '{{count}} row in a different currency was skipped',
    skippedWrongCurrency_few: '{{count}} rows in a different currency were skipped',
    skippedWrongCurrency_many: '{{count}} rows in a different currency were skipped',
    skippedWrongCurrency_other: '{{count}} rows in a different currency were skipped',
    // Names WHICH currencies were skipped, alongside the count line above —
    // `ImportResult.skippedWrongCurrencyCodes`, distinct sorted ISO codes
    // joined with ", ". A "Label: {{value}}" string like its sibling result
    // lines above, so no final "." (kiko-translator's full-stop rule).
    skippedWrongCurrencyCodes: 'Skipped currencies: {{currencies}}',
    // The picked file recognized as a DIFFERENT bank's format than the one
    // scoped by `expectedFormatId` — a more specific state than the generic
    // `unrecognizedFormat`, so the user knows WHY (wrong bank's export), not
    // just that the file failed.
    bankMismatch: "This doesn't look like a {{bank}} statement. Pick the matching file.",
    // The generic column-mapping import's own entry point: offered
    // under a recognized preview AND in the unrecognized/bank-mismatch
    // states, so a file no shipped parser recognizes can still be imported.
    mapColumnsManually: 'Map columns manually',
    // The heading above the shared `ExampleTransaction` row — the first
    // parsed row, shown under the summary table on both this screen and the
    // column-mapping result section so the user sees what will actually be
    // written before tapping Import.
    exampleTransaction: 'Example transaction',
    // The shared `SummaryTable`'s row labels — the statement's own summary
    // rows, reusing the deposit table's LAYOUT only, never its
    // value/percent/tax columns.
    transactionCountLabel: 'Transactions',
    currencyLabel: 'Currency',
    dateSpanLabel: 'Date range',
  },
  // The generic column-mapping import screen
  // (src/screens/column-mapping/column-mapping.screen.tsx): lets a user map
  // an unrecognized (or bank-mismatched) statement's own columns onto the
  // fields every import needs, rather than being limited to a shipped
  // dedicated bank format.
  columnMapping: {
    title: 'Map Columns',
    rawPreview: 'Tap the Row with the Column Names',
    // Section headings: every group on this screen shows its own heading
    // now that the screen no longer duplicates the native stack header's
    // own title.
    sectionFileFormat: 'File Format',
    sectionDates: 'Dates',
    sectionAmount: 'Amount Columns',
    sectionCurrency: 'Currency',
    sectionDetails: 'Additional Details',
    encoding: 'Encoding',
    delimiter: 'Separator',
    delimiterTab: 'Tab',
    decimalSeparator: 'Decimal separator',
    dateFormat: 'Date format',
    dateColumn: 'Date',
    amountModeSingle: 'One amount column',
    amountModeDebitCredit: 'Debit and credit columns',
    amountColumn: 'Amount',
    debitColumn: 'Debit (money out)',
    creditColumn: 'Credit (money in)',
    descriptionColumn: 'Description',
    currencyColumn: 'Currency column',
    fixedCurrency: 'Currency for all rows',
    // No longer suffixed "(optional)" — the field's own
    // FieldTrigger/FieldLabel carries no `required` marker, which now reads
    // as the one "this field is optional" signal, matching
    // every other optional field in the app.
    counterpartyColumn: 'Counterparty',
    // Optional, like counterpartyColumn.
    balanceColumn: 'Balance',
    notUsed: 'Not used',
    // Every column field's own placeholder — distinct per column role
    // (never a bare generic "Select", which reads the same everywhere),
    // matching the established "Select a date" (`selectDatePlaceholder`)
    // copy style. `ColumnSelectField`'s `placeholder` prop is required, so
    // every field below carries its own.
    dateColumnPlaceholder: 'Select a date column',
    dateFormatPlaceholder: 'Select a date format',
    amountColumnPlaceholder: 'Select an amount column',
    debitColumnPlaceholder: 'Select a debit column',
    creditColumnPlaceholder: 'Select a credit column',
    currencyColumnPlaceholder: 'Select a currency column',
    descriptionColumnPlaceholder: 'Select a description column',
    counterpartyColumnPlaceholder: 'Select a counterparty column',
    balanceColumnPlaceholder: 'Select a balance column',
    // Field-level Import-press validation errors — Import is never
    // disabled; every required field validates on press instead. The "No …
    // selected." form reads as its own distinct line next to each field's
    // own "Select a …" placeholder above, rather than the same imperative
    // verb stacked twice.
    dateColumnError: 'No date column selected.',
    dateFormatError: 'No date format selected.',
    amountColumnError: 'No amount column selected.',
    debitColumnError: 'No debit column selected.',
    creditColumnError: 'No credit column selected.',
    currencyColumnError: 'No currency column selected.',
    // A currency column whose values resolve to NO known ISO code anywhere
    // in the file — `applyColumnMapping` throws in exactly this case (see
    // its own doc comment) — shown on the currency-column field itself,
    // once Import is pressed, same as every other field error here.
    currencyColumnUnresolvedError:
      'None of the values in this column are currency codes Kiko recognizes.',
    descriptionColumnError: 'No description column selected.',
    // Every required field IS mapped and the mapping applied without
    // throwing, but literally zero rows survived their own per-row checks
    // (e.g. a date format that matches none of the file's actual date
    // cells) — shown on the Result block itself, once Import is pressed,
    // since no single INPUT field is the one at fault here.
    noRowsResolvedError: 'None of the rows in this file could be read with the current mapping.',
    result: 'Result',
    // Shown while ANY required field is still unmapped — date, date format,
    // amount(s), description, or (in column-currency mode) the currency
    // column — so a naming-only list of 3 fields would misname the real gap
    // whenever it's the currency column instead.
    incomplete: 'Choose the required columns.',
    rowError: {
      date: 'Row {{row}}: the date does not match the format',
      amount: 'Row {{row}}: the amount is not a number',
      debitAndCredit: 'Row {{row}}: both debit and credit are filled',
      currency: 'Row {{row}}: unknown currency “{{value}}”',
    },
    // The row-error list truncates to the first 20 entries; this reports the
    // remaining overflow count below them. English selects _one/_other; the
    // _few/_many forms exist only to mirror Ukrainian's plural set (see
    // uk.ts), so the two catalogues keep an identical key set and `typeof
    // en` still types uk.
    rowsSkipped_one: '{{count}} row will be skipped',
    rowsSkipped_few: '{{count}} rows will be skipped',
    rowsSkipped_many: '{{count}} rows will be skipped',
    rowsSkipped_other: '{{count}} rows will be skipped',
    savedApplied: 'Your saved column mapping is applied. Check the result before importing.',
    xlsNotSupported:
      'Old .xls files are not supported. Save the file as .xlsx or CSV and try again.',
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
