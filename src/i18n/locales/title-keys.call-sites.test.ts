// Title Case applies by UI role (kiko-translator), and TITLE_KEYS is the only
// place the casing and full-stop invariants learn a key is a heading. A
// heading key left out of it is silently checked as sentence case, so this
// walks every app `.tsx` call site that renders a key as a heading or a sheet
// title and requires that key to be in TITLE_KEYS.
import ts from 'typescript';
import { join, relative } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

import { TITLE_KEYS } from './title-keys';

const SOURCE_ROOT = join(__dirname, '..', '..');

// The components that render their `title` prop as a heading. `sheetTitle`
// is a sheet title on any component, because SelectField wrappers pass it on.
const TITLE_PROP_COMPONENTS = new Set(['SummaryTable', 'ConfirmSheet', 'LinkedPaymentsSection']);

// A heading whose key is not a literal cannot be read from the syntax tree, so
// each such site lists the keys it can render, verified by reading the site.
// A new dynamic site fails until it is listed here.
const DYNAMIC_HEADING_KEYS: Record<string, readonly string[]> = {
  'screens/account-detail/bank-sync-section/bank-sync-section.component.tsx#titleKey': [
    'accountDetail.disconnectMonobank',
  ],
};

type HeadingCall = { site: string; key: string | undefined; argument: string; file: string };

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

const translateCallsIn = (node: ts.Node): ts.CallExpression[] => {
  const nested = node.getChildren().flatMap(translateCallsIn);

  return isTranslateCall(node) ? [node, ...nested] : nested;
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

// A header that is itself a `<Text variant="heading">` is already walked as a
// heading; this adds the bare `header={t('...')}` form.
const directBottomSheetHeaderCall = (element: ts.JsxOpeningLikeElement): ts.Node[] => {
  const header = tagName(element) === 'BottomSheet' ? attribute(element, 'header') : undefined;
  const expression =
    header?.initializer && ts.isJsxExpression(header.initializer)
      ? header.initializer.expression
      : undefined;

  return expression !== undefined && isTranslateCall(expression) ? [expression] : [];
};

const headingNodes = (node: ts.Node): ts.Node[] => {
  const nested = node.getChildren().flatMap(headingNodes);

  if (ts.isJsxElement(node) && isHeadingText(node.openingElement)) {
    return [...node.children, ...nested];
  }

  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const headingProps = [
      TITLE_PROP_COMPONENTS.has(tagName(node)) ? attribute(node, 'title') : undefined,
      attribute(node, 'sheetTitle'),
    ].flatMap((prop) => (prop?.initializer ? [prop.initializer] : []));

    return [...headingProps, ...directBottomSheetHeaderCall(node), ...nested];
  }

  return nested;
};

const headingCallsIn = (file: string): HeadingCall[] => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const relativePath = relative(SOURCE_ROOT, file);

  return headingNodes(source)
    .flatMap(translateCallsIn)
    .map((call) => {
      const [firstArgument] = call.arguments;
      const line = source.getLineAndCharacterOfPosition(call.getStart()).line + 1;
      const isLiteral =
        firstArgument !== undefined &&
        (ts.isStringLiteral(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument));

      return {
        site: `${relativePath}:${line}`,
        key: isLiteral ? firstArgument.text : undefined,
        argument: firstArgument?.getText() ?? '',
        file: relativePath,
      };
    });
};

const headingCalls = sourceFiles(SOURCE_ROOT).flatMap(headingCallsIn);

const dynamicSiteId = (call: HeadingCall): string => `${call.file}#${call.argument}`;

describe('TITLE_KEYS covers every heading and sheet-title call site', () => {
  it('finds the known heading call sites', () => {
    expect(headingCalls.length).toBeGreaterThan(40);
    expect(headingCalls.map((call) => call.key)).toContain('holdingDetail.shareChanges');
    expect(headingCalls.map((call) => call.key)).toContain('holdingDetail.linkedPayments');
    expect(headingCalls.map((call) => call.key)).toContain('settings.dataImport.confirmTitle');
  });

  it('lists every literal heading key in TITLE_KEYS', () => {
    const missing = headingCalls
      .filter((call) => call.key !== undefined && !TITLE_KEYS.has(call.key))
      .map((call) => `${call.site} ${call.key}`);

    expect(missing).toEqual([]);
  });

  it('lists every dynamic heading site in DYNAMIC_HEADING_KEYS', () => {
    const unlisted = headingCalls
      .filter((call) => call.key === undefined && !(dynamicSiteId(call) in DYNAMIC_HEADING_KEYS))
      .map(dynamicSiteId);

    expect(unlisted).toEqual([]);
  });

  it('keeps DYNAMIC_HEADING_KEYS current and its keys in TITLE_KEYS', () => {
    const foundSites = new Set(
      headingCalls.filter((call) => call.key === undefined).map(dynamicSiteId),
    );
    const stale = Object.keys(DYNAMIC_HEADING_KEYS).filter((site) => !foundSites.has(site));
    const missing = Object.values(DYNAMIC_HEADING_KEYS)
      .flat()
      .filter((key) => !TITLE_KEYS.has(key));

    expect(stale).toEqual([]);
    expect(missing).toEqual([]);
  });
});
