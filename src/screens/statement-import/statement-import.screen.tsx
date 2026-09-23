import type { FC } from 'react';
import * as RNFS from 'react-native-fs';
import { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type {
  ParsedStatement,
  SpreadsheetCellValue,
  StatementFormat,
  StatementFormatId,
  StatementFormatInput,
} from '../../statement-import/parser';
import { readTableRows, findSavedMapping } from '../../statement-import/column-mapping';
import {
  fileNameOf,
  isXlsxFile,
  decodeStatementText,
  readSheetRowsSafely,
} from '../../statement-import/read-statement-file';
import Box from '../../design-system/components/box';
import { useLiveQuery } from '../../db/use-live-query';
import Text from '../../design-system/components/text';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import { accountsRepo } from '../../accounts/accounts.repo';
import { settingsRepo } from '../../settings/settings.repo';
import type { AccountsStackParamList } from '../../navigation/types';
import {
  detectFormat,
  statementFormats,
  supportedFormatNames,
} from '../../statement-import/registry';
import { importStatement, type ImportResult } from '../../statement-import/import-statement';

import ImportOutcome from './import-outcome';
import { styles } from './statement-import.styles';
import PreviewDetailList from './preview-detail-list';
import TargetHoldingSheet from './target-holding-sheet';
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

/**
 * The shared preview + target-holding screen both statement-import entry
 * points converge on — see docs/plans/statement-import.md section B. Reads
 * `filePath` as base64 (react-native-fs), decodes it back to UTF-8 text,
 * runs it through `detectFormat`/`format.parse`, and either shows the
 * "unrecognized format" state or a preview plus the target-holding picker
 * and the `importStatement` action.
 */
const StatementImportScreen: FC<StatementImportScreenProps> = ({ route, navigation }) => {
  const { filePath, accountId, expectedFormatId } = route.params;
  const { t } = useTranslation();
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedHoldingId, setSelectedHoldingId] = useState<string | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const [importResult, setImportResult] = useState<ImportResult | undefined>(undefined);
  const holdingOptions = useTargetHoldingOptions(accountId);

  // T7's auto-replace check: an account's own `bankId` and its saved
  // column-mapping entries. `accountId` is optional on this route (the
  // Share Extension entry point has none) — an empty-string id query simply
  // returns no rows rather than being skipped, so every render still calls
  // the SAME hooks (React's rules of hooks).
  const { data: accountRows } = useLiveQuery(accountsRepo.byIdQuery(accountId ?? ''), ['accounts']);
  const bankId = accountRows.at(0)?.bankId;
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const savedMappings = settingsRows.at(0)?.statementMappings;

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
  // its own. Runs at most once (`autoReplacedRef`), so a re-render (the
  // settings query resolving after the file read, say) never re-navigates.
  const autoReplacedRef = useRef(false);

  useEffect(() => {
    if (autoReplacedRef.current || !accountId || input === undefined || format !== undefined) {
      return;
    }

    const { rows } = readTableRows(input);
    const saved = findSavedMapping(savedMappings, bankId, rows);

    if (saved?.exact) {
      autoReplacedRef.current = true;
      navigation.replace('ColumnMapping', { filePath, accountId });
    }
  }, [accountId, input, format, savedMappings, bankId, filePath, navigation]);
  // Covers every "this file cannot be imported as-is" outcome EXCEPT the
  // bank-mismatch case (which renders its own, more specific message below):
  // the read itself failed, OR the read succeeded but no format recognized
  // it (and none was expected), OR a format matched and then failed to
  // parse a data row.
  const showUnreadable =
    !bankMismatch &&
    (loadState.kind === 'unreadable' || (input !== undefined && stats === undefined));

  const handleImport = async (): Promise<void> => {
    if (!input || !selectedHoldingId || importing) {
      return;
    }

    setImporting(true);
    setImportError(undefined);

    try {
      setImportResult(await importStatement(input, selectedHoldingId));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  // T7's manual entry point into the generic column-mapping screen. Only
  // navigates when `accountId` is known — the Share Extension entry point
  // (no `accountId`) has no defined "map for which account" behavior yet,
  // same carve-out `TargetHoldingSheet`'s own `onCreateNew` below already
  // makes, so this stays a harmless no-op rather than crashing on a missing
  // required `accountId`.
  const handleMapColumnsManually = (): void => {
    if (accountId) {
      navigation.navigate('ColumnMapping', { filePath, accountId });
    }
  };

  return (
    <Screen scroll>
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
          <Box gap={3} style={styles.previewBlock}>
            <Text variant="heading">{stats.displayName}</Text>
            {/* `Text` (the design-system wrapper) does not forward `testID` —
                each data row's testID lives on a wrapping `Box` instead. */}
            <Box testID="statement-import-transaction-count">
              <Text variant="body">{stats.transactionCount}</Text>
            </Box>
            <Box testID="statement-import-currency">
              <Text variant="body">{stats.currency}</Text>
            </Box>
            <Box testID="statement-import-date-span">
              <Text variant="body">{stats.dateSpan}</Text>
            </Box>

            {stats.maskedCardHints.length > 0 && (
              <PreviewDetailList
                items={stats.maskedCardHints}
                testID="statement-import-masked-cards"
              />
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

            <Button
              variant="secondaryTonal"
              fullWidth={false}
              onPress={() => setSheetVisible(true)}
            >
              {t('statementImport.chooseHolding')}
            </Button>

            <Button
              variant="primary"
              onPress={handleImport}
              disabled={selectedHoldingId === undefined || importing}
            >
              {t('statementImport.importButton')}
            </Button>

            <ImportOutcome error={importError} result={importResult} />
          </Box>
        )}

        {/* The generic column-mapping entry point (T7): offered under a
            recognized preview (`stats` above), AND in the unrecognized/
            bank-mismatch states — anywhere `input` resolved at all — but
            never during the unreadable-read state (`input` stays
            `undefined` there). */}
        {input !== undefined && (
          <Button variant="secondaryTonal" fullWidth={false} onPress={handleMapColumnsManually}>
            {t('statementImport.mapColumnsManually')}
          </Button>
        )}
      </Box>

      <TargetHoldingSheet
        visible={sheetVisible}
        onDismiss={() => setSheetVisible(false)}
        holdings={holdingOptions}
        accountId={accountId}
        onSelect={setSelectedHoldingId}
        // Entry point 2 (the Share Extension, no known `accountId`) has no
        // defined "create a holding for which account" behavior yet — see
        // `.superpowers/sdd/statement-import/task-2-report.md` concern 1/2 —
        // so "Create new holding" only navigates in the scoped (entry point
        // 1) case; it stays a harmless no-op otherwise rather than crashing
        // on a missing required `accountId`.
        onCreateNew={() => {
          if (accountId) {
            navigation.navigate('HoldingForm', { accountId });
          }
        }}
      />
    </Screen>
  );
};

export default StatementImportScreen;
