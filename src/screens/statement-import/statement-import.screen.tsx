import * as RNFS from 'react-native-fs';
import type { FC, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useRef, useEffect, useState } from 'react';
import { View, Alert, type ScrollViewInstance } from 'react-native';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type {
  ParsedStatement,
  SpreadsheetCellValue,
  StatementFormat,
  StatementFormatId,
  StatementFormatInput,
} from '../../statement-import/parser';
import {
  detectFormat,
  statementFormats,
  supportedFormatNames,
} from '../../statement-import/registry';
import {
  scrollToField,
  useHeaderInset,
  type FieldInstance,
} from '../forms/scroll-to-field/scroll-to-field';
import {
  fileNameOf,
  isXlsxFile,
  decodeStatementText,
  readSheetRowsSafely,
  deleteLocalStatementCopy,
} from '../../statement-import/read-statement-file';
import Box from '../../design-system/components/box';
import { useLiveQuery } from '../../db/use-live-query';
import Text from '../../design-system/components/text';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import { accountsRepo } from '../../accounts/accounts.repo';
import { settingsRepo } from '../../settings/settings.repo';
import type { AccountsStackParamList } from '../../navigation/types';
import SummaryTable from '../../design-system/components/summary-table';
import { readTableRows, findSavedMapping } from '../../statement-import/column-mapping';
import { importStatement, type ImportResult } from '../../statement-import/import-statement';

import { styles } from './statement-import.styles';
import ImportResultSheet from './import-result-sheet';
import PreviewDetailList from './preview-detail-list';
import ExampleTransaction from './example-transaction';
import TargetHoldingField from './target-holding-field';
import { previewStats } from './preview-stats/preview-stats';
import { useTargetHoldingOptions } from './use-target-holding-options/use-target-holding-options';

type StatementImportScreenProps = NativeStackScreenProps<AccountsStackParamList, 'StatementImport'>;

// The one format `expectedFormatId` names, or `undefined` when the route
// carries none (an account with no `bankId`, or the accountId-less Share
// Extension entry point) — the caller then falls back to the existing
// multi-format `detectFormat` auto-detect below.
const expectedFormatOf = (id: StatementFormatId | undefined): StatementFormat | undefined =>
  id === undefined ? undefined : statementFormats.find((format) => format.id === id);

// The recognized format for a ready `input` (device-feedback-round-1 item
// 5): scoped to `expectedFormat` when the account's bank is known — ONLY
// that bank's own format may match, so a file that parses as a DIFFERENT
// bank's format recognizes nothing here (the caller reports it as a
// mismatch, not a silent auto-detect success) — or the original
// cross-format `detectFormat` when no bank is known. `input === undefined`
// (still loading or unreadable) recognizes nothing either way. Extracted
// from the screen component so the scoping branch doesn't nest a ternary
// inside the component and push it over the cognitive-complexity budget.
const formatFor = (
  input: StatementFormatInput | undefined,
  expectedFormat: StatementFormat | undefined,
): StatementFormat | undefined => {
  if (input === undefined) {
    return undefined;
  }

  if (expectedFormat !== undefined) {
    return expectedFormat.detect(input) ? expectedFormat : undefined;
  }

  return detectFormat(input);
};

// `detect()` is a cheap header/signature sniff — it does NOT validate every
// data row, so a format it accepted can still throw `StatementParseError`
// out of `parse()` on a bad row (a truncated export, a reformatted date
// cell). There is no ErrorBoundary anywhere in this app, so an unguarded
// `parse()` call here would crash the whole screen instead of falling back
// to the same graceful "can't read this file" state the caller already
// shows for an outright unrecognized format. Returns `undefined` on ANY
// parse failure — not just the documented `StatementParseError` case — so a
// future format's unexpected throw degrades the same way rather than
// crashing.
const parseFormatSafely = (
  format: StatementFormat,
  input: StatementFormatInput,
): ParsedStatement | undefined => {
  try {
    return format.parse(input);
  } catch {
    // Any parse failure here — the documented `StatementParseError` a bad
    // data row throws, or anything else unexpected — degrades to the same
    // graceful state rather than crashing the screen.
    return undefined;
  }
};

// Combines `parseFormatSafely` and `previewStats` into the one derivation
// the component needs, keeping that component's own cognitive complexity
// under the project's Biome cap.
const statsFor = (
  format: StatementFormat | undefined,
  input: StatementFormatInput | undefined,
): ReturnType<typeof previewStats> | undefined => {
  const parsed = format && input ? parseFormatSafely(format, input) : undefined;

  return format && parsed ? previewStats(parsed, format.displayName) : undefined;
};

// The file-read pipeline's own state — kept separate from the derived
// format/stats below so the screen always has SOMETHING to render (a
// loading state while the read is pending, an error state on a failed read)
// instead of a permanently blank `Box` before the async read resolves.
type LoadState =
  | { kind: 'loading' }
  | { kind: 'unreadable' }
  | { kind: 'ready'; text: string; sheetRows?: SpreadsheetCellValue[][] };

// The screen's shared footer slot content (device-feedback-round-F1, items
// 1/4): Import and "Map columns manually" both moved out of the scrolling
// body into `Screen`'s own `footer`, the same slot every other main-action
// button in the app uses. Import only shows once a recognized preview
// (`hasStats`) exists; Map-columns-manually shows anywhere `input` resolved
// at all (mirroring its former inline gate). Renders `null` when NEITHER
// applies, so the caller passes `undefined` to `Screen` instead of an empty
// footer — a module-scope component (mirroring `ValueHeaderSecondary` in
// `holding-detail.screen.tsx`) so this branching doesn't count against the
// screen component's own cognitive-complexity budget.
const StatementImportFooter: FC<{
  hasStats: boolean;
  hasInput: boolean;
  // F4 audit 2: Import is ALWAYS enabled — this disables it ONLY while an
  // import is actually in flight, never behind a `!canImport` gate. See
  // `handleImport`'s own doc comment.
  importing: boolean;
  onImport: () => void;
  onMapColumnsManually: () => void;
}> = ({ hasStats, hasInput, importing, onImport, onMapColumnsManually }) => {
  const { t } = useTranslation();

  if (!hasStats && !hasInput) {
    return null;
  }

  return (
    <Box gap={2}>
      {hasStats && (
        <Button variant="primary" onPress={onImport} disabled={importing}>
          {t('statementImport.importButton')}
        </Button>
      )}

      {hasInput && (
        <Button variant="secondaryTonal" onPress={onMapColumnsManually}>
          {t('statementImport.mapColumnsManually')}
        </Button>
      )}
    </Box>
  );
};

// The recognized-preview block (device-feedback-round-F1, items 2/3/14): the
// shared `SummaryTable` (the deposit/bond value-breakdown table's own
// layout, never its columns), the shared `ExampleTransaction`, the optional
// masked-card/unresolved-row/multi-currency details, the holding SELECT
// field, and the import outcome — a module-scope component (mirroring
// `StatementImportFooter` above) so this branching doesn't count against the
// screen component's own cognitive-complexity budget.
const StatementPreviewBlock: FC<{
  stats: ReturnType<typeof previewStats>;
  holdingOptions: ReturnType<typeof useTargetHoldingOptions>;
  accountId: string | undefined;
  selectedHoldingId: string | undefined;
  onSelectHolding: (holdingId: string) => void;
  onCreateNewHolding: () => void;
  // F4 audit 2/15: Import-press field-level error, `undefined` before the
  // first press — mirrors `column-mapping.screen.tsx`'s own validation
  // model for the SAME target-holding field.
  targetHoldingError: string | undefined;
  targetHoldingFieldRef: RefObject<FieldInstance | null>;
}> = ({
  stats,
  holdingOptions,
  accountId,
  selectedHoldingId,
  onSelectHolding,
  onCreateNewHolding,
  targetHoldingError,
  targetHoldingFieldRef,
}) => {
  const { t } = useTranslation();
  const selectedHoldingName = holdingOptions.find(
    (holding) => holding.id === selectedHoldingId,
  )?.name;

  return (
    <Box gap={3} style={styles.previewBlock}>
      {/* F3 fix round 2, I1/I2: the same plain-first-child-of-gap={3} heading
          pattern `column-mapping.screen.tsx`'s sections use — `SummaryTable`
          gets no `title` here either, so this screen's preview heading sits
          at the SAME 12pt spacing every column-mapping section heading does,
          not `SummaryTable`'s own `gap={1}` (4pt) internal spacing. */}
      <Text variant="heading">{stats.displayName}</Text>

      <SummaryTable
        rows={[
          {
            key: 'transactionCount',
            label: t('statementImport.transactionCountLabel'),
            value: <Text variant="body">{stats.transactionCount}</Text>,
            testID: 'statement-import-transaction-count',
          },
          {
            key: 'currency',
            label: t('statementImport.currencyLabel'),
            value: <Text variant="body">{stats.currency}</Text>,
            testID: 'statement-import-currency',
          },
          {
            key: 'dateSpan',
            label: t('statementImport.dateSpanLabel'),
            value: <Text variant="body">{stats.dateSpan}</Text>,
            testID: 'statement-import-date-span',
          },
        ]}
      />

      {stats.firstTransaction && (
        <ExampleTransaction
          transaction={stats.firstTransaction}
          holdingName={selectedHoldingName}
        />
      )}

      {stats.maskedCardHints.length > 0 && (
        <PreviewDetailList items={stats.maskedCardHints} testID="statement-import-masked-cards" />
      )}

      {stats.unresolvedRowCount > 0 && (
        <Text variant="body" tone="textSecondary">
          {t('statementImport.unresolvedRowsSkipped', { count: stats.unresolvedRowCount })}
        </Text>
      )}

      {stats.detectedCurrencies.length > 1 && (
        <PreviewDetailList
          items={stats.detectedCurrencies}
          label={t('statementImport.detectedCurrenciesLabel')}
          testID="statement-import-detected-currencies"
        />
      )}

      <View ref={targetHoldingFieldRef}>
        <TargetHoldingField
          label={t('statementImport.chooseHolding')}
          required
          holdings={holdingOptions}
          accountId={accountId}
          selectedId={selectedHoldingId}
          onSelect={onSelectHolding}
          onCreateNew={onCreateNewHolding}
          placeholder={t('statementImport.chooseHoldingPlaceholder')}
          error={targetHoldingError}
          testID="target-holding-field"
        />
      </View>
    </Box>
  );
};

/**
 * The shared preview + target-holding screen both statement-import entry
 * points converge on — see docs/plans/statement-import.md section B. Reads
 * `filePath` as base64 (react-native-fs), decodes it back to UTF-8 text,
 * runs it through `detectFormat`/`format.parse`, and either shows the
 * "unrecognized format" state or a preview plus the target-holding picker
 * and the `importStatement` action.
 */
const StatementImportScreen: FC<StatementImportScreenProps> = ({ route, navigation }) => {
  const { filePath, accountId, expectedFormatId, holdingId } = route.params;
  const { t } = useTranslation();
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [selectedHoldingId, setSelectedHoldingId] = useState<string | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | undefined>(undefined);
  // N4 (F3 part 1 fix round 2): decoupled from `importResult` itself — see
  // `handleImportDone` below for why.
  const [resultSheetVisible, setResultSheetVisible] = useState(false);
  // R2-1 (F3 part 1 fix round 3): guards `handleSheetClosed` against running
  // its navigation more than once — see that function's own comment.
  const navigatedAwayRef = useRef(false);
  // F4 audit 2: Import is ALWAYS enabled — this flips true on the FIRST
  // Import press and stays true, the same "validate on press" contract every
  // other Kiko form uses (`kiko-code-style`'s "Form validation model").
  const [attemptedImport, setAttemptedImport] = useState(false);
  const targetHoldingFieldRef = useRef<FieldInstance>(null);
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const headerInset = useHeaderInset();
  const contentHeightRef = useRef(0);
  const holdingOptions = useTargetHoldingOptions(accountId);

  // T7's auto-replace check: an account's own `bankId` and its saved
  // column-mapping entries. `accountId` is optional on this route (the
  // Share Extension entry point has none) — an empty-string id query simply
  // returns no rows rather than being skipped, so every render still calls
  // the SAME hooks (React's rules of hooks).
  const { data: accountRows, isLoading: accountIsLoading } = useLiveQuery(
    accountsRepo.byIdQuery(accountId ?? ''),
    ['accounts'],
  );
  const bankId = accountRows.at(0)?.bankId;
  const { data: settingsRows, isLoading: settingsIsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
  );
  const savedMappings = settingsRows.at(0)?.statementMappings;

  // Item 2 (F3, BUG): a holding created via "Add new" (`handleCreateNewHolding`
  // below) never got SELECTED — the live-queried option list already showed
  // it (`useTargetHoldingOptions` above), but nothing told the picker to
  // select it. `HoldingFormScreen`'s create-save path now hands the new id
  // back through this same route's own `holdingId` param, merged in via
  // `navigation.popTo(..., { merge: true })` — NOT `navigate`, which on
  // React Navigation 7 pushes a duplicate of this already-on-stack route
  // instead of reusing it (C1, F3 part 1 fix round 1; see `returnTo` on
  // `HoldingForm`'s route type, and
  // `src/navigation/statement-import-return.navigator.test.tsx` for the
  // real-router proof). This effect selects it the moment it arrives.
  useEffect(() => {
    if (holdingId !== undefined) {
      setSelectedHoldingId(holdingId);
    }
  }, [holdingId]);

  useEffect(() => {
    let cancelled = false;

    RNFS.readFile(filePath, 'base64')
      .then(async (base64) => {
        if (cancelled) {
          return;
        }

        // The picked file's own extension decides the text-vs-spreadsheet
        // branch (an honest, visible check — see `isXlsxFile`'s doc
        // comment). PrivatBank XLSX is the only spreadsheet format in
        // scope, so this stays a plain two-way split.
        if (isXlsxFile(fileNameOf(filePath))) {
          const sheetRows = await readSheetRowsSafely(base64);

          if (!cancelled) {
            setLoadState({ kind: 'ready', text: '', sheetRows });
          }

          return;
        }

        const utf8Text = decodeStatementText(base64, 'utf-8');
        const utf8Input = { text: utf8Text, fileName: fileNameOf(filePath) };

        // Sensebank (and Phase 4's FOP CSVs) are cp1251-encoded, not UTF-8 —
        // section C.2's KEY DESIGN. A UTF-8 decode of cp1251 bytes never
        // matches a cp1251 format's own Cyrillic detect signature, so this is
        // an honest, visible second decode attempt of the SAME bytes — no
        // flag, no per-format bytes field — that runs only when the first
        // (UTF-8) pass matched no known format.
        const text = detectFormat(utf8Input)
          ? utf8Text
          : decodeStatementText(base64, 'windows-1251');

        setLoadState({ kind: 'ready', text });
      })
      .catch(() => {
        // A failed read — an iCloud placeholder not yet downloaded, a
        // revoked security-scoped URL, a file removed after picking —
        // degrades to the SAME graceful "can't read this file" state the
        // unrecognized-format case shows below, never a blank screen.
        if (!cancelled) {
          setLoadState({ kind: 'unreadable' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const fileName = fileNameOf(filePath);
  const input =
    loadState.kind === 'ready'
      ? { text: loadState.text, fileName, sheetRows: loadState.sheetRows }
      : undefined;
  const expectedFormat = expectedFormatOf(expectedFormatId);
  // Scoped recognition (device-feedback-round-1 item 5) — see `formatFor`'s
  // doc comment above for the full rule.
  const format = formatFor(input, expectedFormat);
  const stats = statsFor(format, input);
  const bankMismatch = input !== undefined && expectedFormat !== undefined && format === undefined;

  // T7: when this file matched NO format (unrecognized, or a bank
  // mismatch) and an EXACT saved mapping exists for this account's own
  // bank, skip straight to the manual-mapping screen instead of showing the
  // "we don't recognize this file" state — `ColumnMapping` still requires
  // its own Import tap (Review Focus 3), so this never imports anything on
  // its own.
  const autoReplacedRef = useRef(false);
  // The user chose the manual-mapping path themselves (`handleMapColumnsManually`
  // below) — once that happens, the auto-replace check must never act for
  // this screen instance again, no matter what it later re-evaluates.
  const manualMapPushedRef = useRef(false);
  // Decides at most once, the FIRST time `input` resolves AND both the
  // account and settings live queries have finished their own INITIAL
  // load — whether or not that look finds a match. Both queries start at
  // `data: []`/`isLoading: true` and fill in later: deciding while either
  // is still loading would read an empty `savedMappings`/`bankId` as "no
  // mapping exists" and lock in a wrong "no match" for a returning user
  // whose mapping simply hadn't loaded yet. `savedMappings` stays a
  // dependency (a mapping already saved before the queries resolve must
  // still be seen), but once the decision is made it refuses to revisit
  // it: a `savedMappings` write that lands LATER — the pushed ColumnMapping
  // screen this effect is unaware of saving its own mapping while this
  // screen sits blurred underneath it — used to flip the match from false to
  // true and call `navigation.replace` from a screen the user had already
  // navigated away from; the router's REPLACE carries no target and falls
  // back to the FOCUSED route, silently swapping out the live ColumnMapping
  // instance (and its open success sheet) for a brand-new one.
  const evaluatedRef = useRef(false);

  useEffect(() => {
    if (
      evaluatedRef.current ||
      manualMapPushedRef.current ||
      !accountId ||
      input === undefined ||
      format !== undefined ||
      accountIsLoading ||
      settingsIsLoading
    ) {
      return;
    }

    evaluatedRef.current = true;

    // A stack-mutating call from an effect must never act for a screen the
    // user has already navigated away from.
    if (!navigation.isFocused()) {
      return;
    }

    const { rows } = readTableRows(input);
    const saved = findSavedMapping(savedMappings, bankId, rows);

    if (saved?.exact) {
      autoReplacedRef.current = true;
      // N2 (F3 part 1 fix round 2): `ownsFile: true` — this REPLACES
      // StatementImport (no `StatementImport` route left below it on the
      // stack), so ColumnMapping becomes the file's sole owner from here.
      // The OTHER ColumnMapping entry point ("Map columns manually",
      // below) never sets this: it PUSHES on top, leaving StatementImport
      // still mounted and still the owner.
      navigation.replace('ColumnMapping', { filePath, accountId, ownsFile: true });
    }
  }, [
    accountId,
    input,
    format,
    savedMappings,
    bankId,
    filePath,
    navigation,
    accountIsLoading,
    settingsIsLoading,
  ]);

  // M8 (F3 part 1 fix round 1, Important): `filePath` is a plaintext local
  // cache copy (item 6's `keepLocalCopy` fix) outside the encrypted
  // database — deleted once this screen is REMOVED from the stack (a
  // successful import's `popTo`, or the user backing all the way out),
  // never left behind in `Library/Caches`. `useEffect`'s cleanup fires
  // exactly on unmount — which native-stack only does when a screen is
  // actually popped, NOT when merely backgrounded by a push on top (Map
  // Columns stays reachable, this screen's own `RNFS.readFile` calls keep
  // working, its column-mapping state is preserved — see C1's real-router
  // test). Guarded on `autoReplacedRef`: the T7 auto-replace above ALSO
  // unmounts this screen (`navigation.replace`), but hands the SAME
  // `filePath` to the ColumnMapping screen that replaces it — that screen
  // owns the file from then on (its own matching cleanup effect, gated on
  // the `ownsFile` param this screen just set — N2), so this one must NOT
  // delete out from under it.
  useEffect(() => {
    return () => {
      if (!autoReplacedRef.current) {
        deleteLocalStatementCopy(filePath);
      }
    };
  }, [filePath]);
  // Covers every "this file cannot be imported as-is" outcome EXCEPT the
  // bank-mismatch case (which renders its own, more specific message below):
  // the read itself failed, OR the read succeeded but no format recognized
  // it (and none was expected), OR a format matched and then failed to
  // parse a data row.
  const showUnreadable =
    !bankMismatch &&
    (loadState.kind === 'unreadable' || (input !== undefined && stats === undefined));

  // F4 audit 2: Import is ALWAYS enabled (`disabled={importing}` only, see
  // the footer below) — this validates on press instead of standing behind a
  // `disabled={!canImport}` gate, mirroring `column-mapping.screen.tsx`'s own
  // `handleImport` for the SAME target-holding field.
  const handleImport = async (): Promise<void> => {
    if (!input || importing) {
      return;
    }

    if (!selectedHoldingId) {
      setAttemptedImport(true);
      scrollToField(scrollableRef, targetHoldingFieldRef, {
        currentOffset: scrollOffset.value,
        headerInset,
        contentHeight: contentHeightRef.current,
      });

      return;
    }

    setImporting(true);

    try {
      setImportResult(await importStatement(input, selectedHoldingId));
      setResultSheetVisible(true);
    } catch {
      // F4 audit 7: a translated Alert, never raw `error.message` rendered
      // inline — see `statementImport.importErrorTitle`'s own doc comment.
      Alert.alert(t('statementImport.importErrorTitle'), t('statementImport.importErrorMessage'));
    } finally {
      setImporting(false);
    }
  };

  // Item 15 (F3): closes the successful-import modal. Does NOT navigate —
  // see `handleSheetClosed` below (R2-1, fix round 3): a native-stack pop
  // must wait for the sheet to ACTUALLY finish closing, which `onDone` (a
  // Done press or a scrim tap) cannot promise on its own — only `onClosed`
  // (the sheet's real completion signal) can. `importResult` itself is
  // NEVER cleared (M4, fix round 1), so the sheet's last content stays
  // correct for the whole close animation, independent of `visible`.
  const handleImportDone = (): void => {
    setResultSheetVisible(false);
  };

  // R2-1 (F3 part 1 fix round 3): runs once `ImportResultSheet`'s `onClosed`
  // fires — `BottomSheet`'s pass-through of RN `Modal`'s own `onDismiss`,
  // which only fires once the close ANIMATION has actually finished (round
  // 2 re-review: a guessed `setTimeout` delay was "not tied to the real
  // animation" — this removes the guess entirely). `navigatedAwayRef`
  // ignores a repeated call (a double Done tap, or `onClosed` somehow
  // firing more than once) so this navigates at most ONCE.
  //
  // `navigation.popTo` — NOT `navigate`, which on React Navigation 7 pushes
  // a DUPLICATE of an already-on-stack route instead of reusing it (C1, F3
  // part 1 fix round 1 — see
  // `src/navigation/statement-import-return.navigator.test.tsx` for the
  // real-router proof) — finds the existing `AccountDetail` instance
  // already on the stack (this screen, and Map Columns before it, were both
  // pushed FROM there) and pops back to it in place, regardless of how many
  // screens deep this import happened. Falls back to a plain `goBack()`
  // when the account isn't resolvable (the accountId-less Share Extension
  // entry point) — NEVER `popTo` in that branch, which would ADD an
  // `AccountDetail` that was never on this stack.
  const handleSheetClosed = (): void => {
    if (navigatedAwayRef.current) {
      return;
    }

    navigatedAwayRef.current = true;

    const account = accountRows.at(0);

    if (accountId && account) {
      navigation.popTo('AccountDetail', { accountId, name: account.name }, { merge: true });

      return;
    }

    navigation.goBack();
  };

  // T7's manual entry point into the generic column-mapping screen. Only
  // navigates when `accountId` is known — the Share Extension entry point
  // (no `accountId`) has no defined "map for which account" behavior yet,
  // same carve-out `TargetHoldingField`'s own `onCreateNew` below already
  // makes, so this stays a harmless no-op rather than crashing on a missing
  // required `accountId`.
  const handleMapColumnsManually = (): void => {
    if (accountId) {
      manualMapPushedRef.current = true;
      // Item 11 (F3): carry the holding already chosen on THIS preview
      // through to Map Columns, so it pre-fills instead of asking again.
      navigation.navigate('ColumnMapping', { filePath, accountId, holdingId: selectedHoldingId });
    }
  };

  // Entry point 2 (the Share Extension, no known `accountId`) has no defined
  // "create a holding for which account" behavior yet — see
  // `.superpowers/sdd/statement-import/task-2-report.md` concern 1/2 — so
  // "Create new holding" only navigates in the scoped (entry point 1) case;
  // it stays a harmless no-op otherwise rather than crashing on a missing
  // required `accountId`.
  const handleCreateNewHolding = (): void => {
    if (accountId) {
      navigation.navigate('HoldingForm', {
        accountId,
        returnTo: { screen: 'StatementImport', params: route.params },
      });
    }
  };

  // `Screen`'s own `footer` prop treats ANY defined node (even one that
  // itself renders null) as "has a footer" and reserves the clearance for
  // it — so this stays `undefined` rather than an always-defined element,
  // exactly mirroring the FORMER inline `input !== undefined` gate below.
  const footer =
    stats !== undefined || input !== undefined ? (
      <StatementImportFooter
        hasStats={stats !== undefined}
        hasInput={input !== undefined}
        importing={importing}
        onImport={handleImport}
        onMapColumnsManually={handleMapColumnsManually}
      />
    ) : undefined;

  return (
    <Screen
      scroll
      footer={footer}
      scrollableRef={scrollableRef}
      onContentSizeChange={(_width, height) => {
        contentHeightRef.current = height;
      }}
    >
      <Box gap={4} testID="statement-import-content">
        {loadState.kind === 'loading' && (
          <Text variant="body" tone="textSecondary">
            {t('statementImport.reading')}
          </Text>
        )}

        {bankMismatch && expectedFormat && (
          <Text variant="body">
            {t('statementImport.bankMismatch', { bank: expectedFormat.displayName })}
          </Text>
        )}

        {showUnreadable && (
          <Text variant="body">
            {t('statementImport.unrecognizedFormat', { formats: supportedFormatNames })}
          </Text>
        )}

        {stats && (
          <StatementPreviewBlock
            stats={stats}
            holdingOptions={holdingOptions}
            accountId={accountId}
            selectedHoldingId={selectedHoldingId}
            onSelectHolding={setSelectedHoldingId}
            onCreateNewHolding={handleCreateNewHolding}
            targetHoldingError={
              attemptedImport && selectedHoldingId === undefined
                ? t('statementImport.chooseHoldingError')
                : undefined
            }
            targetHoldingFieldRef={targetHoldingFieldRef}
          />
        )}
      </Box>

      <ImportResultSheet
        visible={resultSheetVisible}
        result={importResult}
        onDone={handleImportDone}
        onClosed={handleSheetClosed}
      />
    </Screen>
  );
};

export default StatementImportScreen;
