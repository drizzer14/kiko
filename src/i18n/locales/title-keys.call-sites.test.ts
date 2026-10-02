// Title Case applies by UI role (kiko-translator), and TITLE_KEYS is the only
// place the casing and full-stop invariants learn a key is a heading. A
// heading key left out of it is silently checked as sentence case, so this
// walks every app `.tsx` call site that renders a key as a heading, a sheet
// title, or a nav title and requires that key to be in TITLE_KEYS.
import ts from 'typescript';
import { join, relative } from 'node:path';
import maybe, { foldMap } from 'fnts/maybe';
import { readdirSync, readFileSync } from 'node:fs';

import { TITLE_KEYS } from './title-keys';

const SOURCE_ROOT = join(__dirname, '..', '..');

// The components that render a prop as a heading or a sheet title, so a
// `t('...')` passed to that prop is a heading key. `sheetTitle` is a sheet
// title on any component, because SelectField wrappers pass it on.
const HEADING_PROPS: Record<string, readonly string[]> = {
  ConfirmSheet: ['title'],
  EntityAmountHeader: ['label'],
  LinkedPaymentsSection: ['title'],
  SummaryTable: ['title'],
};

// A heading whose key is not a literal cannot be read from the syntax tree, so
// each such site lists the keys it can render, verified by reading the site.
const DYNAMIC_HEADING_KEYS: Record<string, readonly string[]> = {
  'screens/account-detail/bank-sync-section/bank-sync-section.component.tsx#titleKey': [
    'accountDetail.disconnectMonobank',
  ],
  'screens/account-detail/close-holding-sheet/close-holding-sheet.component.tsx#copy.title': [
    'accountDetail.closeHoldingTitle',
    'accountDetail.closeLoanTitle',
  ],
  'screens/forms/convert-exchange-fields/convert-exchange-fields.component.tsx#counterpartSheetTitle':
    ['forms.transaction.fromSheetTitle', 'forms.transaction.toSheetTitle'],
  'screens/forms/price-point-form/price-point-form.screen.tsx#copy.title': [
    'forms.pricePoint.loanTitle',
  ],
  'screens/forms/transaction-form/transaction-form.screen.tsx#props.sheetTitle': [
    'forms.transaction.holdingSheetTitle',
  ],
  'screens/forms/transaction-form/transaction-form.screen.tsx#title': [
    'forms.transaction.title',
    'forms.transaction.editTitle',
    'forms.transaction.addTitle',
  ],
};

// A heading slot inside a component that renders its own prop there: the keys
// are checked at that component's call sites through HEADING_PROPS instead.
const FORWARDED_HEADING_SITES: Record<string, `${string}.${string}`> = {
  'design-system/components/confirm-sheet/confirm-sheet.component.tsx#title': 'ConfirmSheet.title',
  'design-system/components/currency-field/currency-field.component.tsx#sheetTitle':
    'CurrencyField.sheetTitle',
  'design-system/components/entity-amount-header/entity-amount-header.component.tsx#label':
    'EntityAmountHeader.label',
  'design-system/components/filter-menu/filter-menu.component.tsx#sheetTitle':
    'FilterMenu.sheetTitle',
  'design-system/components/select-field/select-field.component.tsx#sheetTitle':
    'SelectField.sheetTitle',
  'design-system/components/summary-table/summary-table.component.tsx#title': 'SummaryTable.title',
  'screens/column-mapping/column-select-field/column-select-field.component.tsx#sheetTitle':
    'ColumnSelectField.sheetTitle',
  'screens/forms/account-kind-field/account-kind-field.component.tsx#sheetTitle':
    'AccountKindField.sheetTitle',
  'screens/forms/bank-type-field/bank-type-field.component.tsx#sheetTitle':
    'BankTypeField.sheetTitle',
  'screens/forms/broker-type-field/broker-type-field.component.tsx#sheetTitle':
    'BrokerTypeField.sheetTitle',
  'screens/forms/category-field/category-field.component.tsx#sheetTitle':
    'CategoryField.sheetTitle',
  'screens/forms/date-field/date-field.component.tsx#sheetTitle': 'DateField.sheetTitle',
  'screens/forms/holding-select-field/holding-select-field.component.tsx#sheetTitle':
    'HoldingSelectField.sheetTitle',
  'screens/forms/loan-payment-field/loan-payment-field.component.tsx#sheetTitle':
    'LoanPaymentField.sheetTitle',
  'screens/forms/payment-holding-field/payment-holding-field.component.tsx#sheetTitle':
    'PaymentHoldingField.sheetTitle',
  'screens/forms/time-field/time-field.component.tsx#sheetTitle': 'TimeField.sheetTitle',
  'screens/holding-detail/holding-detail.screen.tsx#title': 'LinkedPaymentsSection.title',
};

// A heading slot that renders no Title-role key, with the reason.
const UNCHECKED_HEADING_SITES: Record<string, string> = {
  'calendar/calendar-header/calendar-header.component.tsx#title':
    'a month name and a year, not a phrase that has a casing role',
  'design-system/components/card-context-menu/card-context-menu.component.tsx#name':
    'the user-entered name of the entity the menu acts on',
  'screens/account-detail/account-detail.screen.tsx#accountName': 'the user-entered account name',
  'screens/holding-detail/holding-detail.screen.tsx#holdingName': 'the user-entered holding name',
  'screens/settings/reminders/reminders.screen.tsx#group.name': 'the user-entered account name',
  'screens/statement-import/statement-preview-block/statement-preview-block.component.tsx#stats.displayName':
    'the statement format name the parser reports, a bank brand name',
};

type HeadingSite = { site: string; key: string | undefined; siteId: string };

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });

const isTranslateCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ((ts.isIdentifier(node.expression) && node.expression.text === 't') ||
    (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'));

const isJsx = (node: ts.Node): boolean =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);

// The expressions a heading slot can render: both arms of a conditional, the
// rendered side of `&&`, and every non-blank child of nested JSX.
const headingLeaves = (node: ts.Node): ts.Node[] => {
  if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) {
    return foldMap(maybe(node.expression), headingLeaves) ?? [];
  }

  if (ts.isJsxText(node)) {
    return node.containsOnlyTriviaWhiteSpaces ? [] : [node];
  }

  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    return node.children.flatMap(headingLeaves);
  }

  if (ts.isJsxSelfClosingElement(node)) {
    return [];
  }

  if (ts.isConditionalExpression(node)) {
    return [...headingLeaves(node.whenTrue), ...headingLeaves(node.whenFalse)];
  }

  return ts.isBinaryExpression(node) ? binaryLeaves(node) : [node];
};

const binaryLeaves = (node: ts.BinaryExpression): ts.Node[] => {
  const operator = node.operatorToken.kind;

  if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
    return headingLeaves(node.right);
  }

  if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
    return [...headingLeaves(node.left), ...headingLeaves(node.right)];
  }

  return [node];
};

const tagName = (element: ts.JsxOpeningLikeElement): string => element.tagName.getText();

const attribute = (element: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined =>
  element.attributes.properties
    .filter(ts.isJsxAttribute)
    .find((candidate) => candidate.name.getText() === name);

const isHeadingText = (element: ts.JsxOpeningLikeElement): boolean => {
  const initializer = attribute(element, 'variant')?.initializer;

  return (
    tagName(element) === 'Text' &&
    initializer !== undefined &&
    ts.isStringLiteral(initializer) &&
    initializer.text === 'heading'
  );
};

const headingProps = (element: ts.JsxOpeningLikeElement): ts.Node[] =>
  [...(HEADING_PROPS[tagName(element)] ?? []), 'sheetTitle'].flatMap(
    (name) =>
      foldMap(maybe(attribute(element, name)?.initializer), (initializer) => [initializer]) ?? [],
  );

// A JSX header is walked on its own (its `<Text variant="heading">`), so only
// a bare expression given to `header` is a heading slot here.
const bottomSheetHeader = (element: ts.JsxOpeningLikeElement): ts.Node[] => {
  const header = tagName(element) === 'BottomSheet' ? attribute(element, 'header') : undefined;
  const expression =
    header?.initializer && ts.isJsxExpression(header.initializer)
      ? header.initializer.expression
      : undefined;

  return expression === undefined || isJsx(expression) ? [] : [expression];
};

const titleProperty = (objectLiteral: ts.Node): ts.Node[] => {
  if (!ts.isObjectLiteralExpression(objectLiteral)) {
    return [];
  }

  return objectLiteral.properties.flatMap((property) => {
    if (property.name?.getText() !== 'title') {
      return [];
    }

    if (ts.isPropertyAssignment(property)) {
      return [property.initializer];
    }

    return ts.isShorthandPropertyAssignment(property) ? [property.name] : [];
  });
};

// A nav title: `options={{ title }}` on a screen, or `navigation.setOptions({ title })`.
const navigationTitle = (node: ts.Node): ts.Node[] => {
  if (ts.isJsxAttribute(node) && node.name.getText() === 'options') {
    const initializer = node.initializer;

    return initializer && ts.isJsxExpression(initializer) && initializer.expression
      ? titleProperty(initializer.expression)
      : [];
  }

  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'setOptions'
  ) {
    return node.arguments.flatMap(titleProperty);
  }

  return [];
};

const headingSlots = (node: ts.Node): ts.Node[] => {
  const nested = node.getChildren().flatMap(headingSlots);

  if (ts.isJsxElement(node) && isHeadingText(node.openingElement)) {
    return [...node.children, ...nested];
  }

  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    return [...headingProps(node), ...bottomSheetHeader(node), ...nested];
  }

  return [...navigationTitle(node), ...nested];
};

const oneLine = (node: ts.Node): string => node.getText().replace(/\s+/g, ' ').trim();

const isStringLiteralLike = (node: ts.Node): node is ts.StringLiteralLike =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

// Stryker's mutation-testing instrumentation rewrites a literal call
// argument `'key'` into `stryMutAct_x("n") ? "" : (stryCov_x("n"), 'key')` —
// a conditional whose "mutant inactive" branch is a parenthesized comma
// sequence ending in the original literal. This walks through that shape
// (and any nesting of it) to reach the literal underneath, so a heading key
// is still read correctly from the instrumented copy of a file Stryker's
// own test run reads off disk, not only from the pristine source.
const strykerUnwrapped = (node: ts.Node): ts.Node => {
  if (ts.isParenthesizedExpression(node)) {
    return strykerUnwrapped(node.expression);
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return strykerUnwrapped(node.right);
  }

  return ts.isConditionalExpression(node) ? strykerUnwrapped(node.whenFalse) : node;
};

const sitesInSource = (fileName: string, text: string): HeadingSite[] => {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const relativePath = relative(SOURCE_ROOT, fileName);

  return headingSlots(source)
    .flatMap(headingLeaves)
    .map((leaf) => {
      const line = source.getLineAndCharacterOfPosition(leaf.getStart()).line + 1;
      const site = `${relativePath}:${line}`;

      if (!isTranslateCall(leaf)) {
        return { site, key: undefined, siteId: `${relativePath}#${oneLine(leaf)}` };
      }

      const [firstArgument] = leaf.arguments;
      const literal = foldMap(maybe(firstArgument), strykerUnwrapped);

      return {
        site,
        key: literal !== undefined && isStringLiteralLike(literal) ? literal.text : undefined,
        siteId: `${relativePath}#${foldMap(maybe(firstArgument), oneLine) ?? ''}`,
      };
    });
};

// strykerUnwrapped reads the original key back out of an instrumented call.
const headingSitesIn = (file: string): HeadingSite[] =>
  // nosemgrep: kiko-no-source-text-read-in-test OVERRIDE(unwraps Stryker instrumentation)
  sitesInSource(file, readFileSync(file, 'utf8'));

const headingSites = sourceFiles(SOURCE_ROOT).flatMap(headingSitesIn);

const dynamicSiteIds = new Set(
  headingSites.filter((heading) => heading.key === undefined).map((heading) => heading.siteId),
);

const allowlists = [DYNAMIC_HEADING_KEYS, FORWARDED_HEADING_SITES, UNCHECKED_HEADING_SITES];

describe('TITLE_KEYS covers every heading, sheet-title, and nav-title call site', () => {
  it('finds the known heading call sites', () => {
    const keys = headingSites.map((heading) => heading.key);

    expect(headingSites.length).toBeGreaterThan(40);
    expect(keys).toContain('holdingDetail.shareChanges');
    expect(keys).toContain('holdingDetail.linkedPayments');
    expect(keys).toContain('settings.dataImport.confirmTitle');
    expect(keys).toContain('accountDetail.balanceLabel');
    expect(keys).toContain('holdingDetail.valueLabel');
    expect(keys).toContain('settings.categories');
    expect(keys).toContain('forms.account.editTitle');
  });

  it('lists every literal heading key in TITLE_KEYS', () => {
    const missing = headingSites
      .filter((heading) => heading.key !== undefined && !TITLE_KEYS.has(heading.key))
      .map((heading) => `${heading.site} ${heading.key}`);

    expect(missing).toEqual([]);
  });

  it('lists every non-literal heading site in exactly one allowlist', () => {
    const unlisted = [...dynamicSiteIds].filter(
      (siteId) => allowlists.filter((allowlist) => siteId in allowlist).length !== 1,
    );

    expect(unlisted).toEqual([]);
  });

  it('keeps every allowlist current', () => {
    const stale = allowlists
      .flatMap((allowlist) => Object.keys(allowlist))
      .filter((siteId) => !dynamicSiteIds.has(siteId));

    expect(stale).toEqual([]);
  });

  it('keeps DYNAMIC_HEADING_KEYS keys in TITLE_KEYS', () => {
    const missing = Object.values(DYNAMIC_HEADING_KEYS)
      .flat()
      .filter((key) => !TITLE_KEYS.has(key));

    expect(missing).toEqual([]);
  });

  it('maps every forwarded heading prop in HEADING_PROPS, and forwards every HEADING_PROPS prop', () => {
    const forwarded: Set<string> = new Set(Object.values(FORWARDED_HEADING_SITES));
    const unmapped = [...forwarded].filter((componentProp) => {
      const [component = '', prop = ''] = componentProp.split('.');

      return prop !== 'sheetTitle' && !(HEADING_PROPS[component] ?? []).includes(prop);
    });
    const unforwarded = Object.entries(HEADING_PROPS)
      .flatMap(([component, props]) => props.map((prop) => `${component}.${prop}`))
      .filter((componentProp) => !forwarded.has(componentProp));

    expect(unmapped).toEqual([]);
    expect(unforwarded).toEqual([]);
  });
});

describe('reading a heading key survives Stryker mutation-testing instrumentation', () => {
  it('still reads the literal key through the instrumented conditional-comma shape', () => {
    const sites = sitesInSource(
      'fixture-stryker-instrumented.tsx',
      `const Heading = () => (
        <Text variant="heading">
          {t(stryMutAct_9fa48("114") ? "" : (stryCov_9fa48("114"), 'settings.dataImport.confirmTitle'))}
        </Text>
      );`,
    );

    expect(sites.map((site) => site.key)).toEqual(['settings.dataImport.confirmTitle']);
  });

  it('still treats a genuinely dynamic call site as non-literal', () => {
    const sites = sitesInSource(
      'fixture-dynamic.tsx',
      `const Heading = (props) => (
        <Text variant="heading">{t(props.someKey)}</Text>
      );`,
    );

    expect(sites.map((site) => site.key)).toEqual([undefined]);
  });
});
