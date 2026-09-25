// src/i18n/locales/title-keys.ts
//
// The explicit set of every screen/nav title, section heading, and
// sheet/modal title key — the Title Case role's own key list, now also
// reused by the full-stop-by-role invariant: a title/heading/sheet-title
// key is one of the roles with NO final "." either. Verified by call site
// (a nav `options.title`/
// `navigation.setOptions`, a `variant="heading"` `Text`, or a
// `BottomSheet`/`ConfirmSheet` title/header prop) against its own real
// call site. Extracted out of `en.casing-by-role.test.ts`
// into its own module (not a `.test.ts` file, so a non-test consumer — or a
// second test file — can import it without pulling in Jest globals) so the
// casing test and the full-stop test share ONE list rather than two
// hand-copied near-duplicates.
//
// Add a new title/heading key HERE on purpose; it is not picked up by a
// name pattern (a `Title`/`Heading`-suffixed key that is actually a button
// or a field label would otherwise be silently exempted from BOTH checks).
export const TITLE_KEYS = new Set([
  'accountDetail.addBankSheetTitle',
  'accountDetail.holdingsHeading',
  'accounts.title',
  'categories.chooseIconHeading',
  'columnMapping.rawPreview',
  'columnMapping.sectionAmount',
  'columnMapping.sectionCurrency',
  'columnMapping.sectionDates',
  'columnMapping.sectionDetails',
  'columnMapping.sectionFileFormat',
  'columnMapping.title',
  'forms.account.addTitle',
  'forms.account.editTitle',
  'forms.account.kindSheetTitle',
  'forms.contribution.addTitle',
  'forms.holding.addTitle',
  'forms.holding.couponFrequencySheetTitle',
  'forms.holding.editTitle',
  'forms.holding.loanKindSheetTitle',
  'forms.holding.typeSheetTitle',
  'forms.lot.addTitle',
  'forms.pricePoint.loanTitle',
  'forms.pricePoint.title',
  'forms.transaction.addTitle',
  'forms.transaction.applyCategoryToAll',
  'forms.transaction.editTitle',
  'forms.transaction.returnsHeading',
  'forms.transaction.title',
  'forms.transaction.typeSheetTitle',
  'holdingDetail.transactionsHeading',
  'home.dateRangeField.heading',
  'home.title',
  'settings.dataExport.title',
  'settings.dataImport.confirmTitle',
  'settings.dataImport.title',
  'settings.title',
  'statementImport.chooseHoldingSheetTitle',
  'statementImport.importResultTitle',
  'statementImport.previewHeading',
  'statistics.accountContribution',
  'statistics.byType',
  'statistics.expensesByCategory',
  'statistics.netWorthOverTime',
  'statistics.spendingTrendByCategory',
  'statistics.title',
  'statistics.trendFilter.title',
]);
