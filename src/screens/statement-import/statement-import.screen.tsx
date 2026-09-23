import type { FC } from 'react';
import * as RNFS from 'react-native-fs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type {
  SpreadsheetCellValue,
  StatementFormat,
  StatementFormatId,
  StatementFormatInput,
} from '../../statement-import/parser';
import { formatDate } from '../../dates/format';
import { holdingsRepo } from '../../holdings/repo';
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
import type { TargetHoldingOption } from './target-holding-sheet/target-holding-sheet.props';

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

type PreviewStats = {
  displayName: string;
  transactionCount: number;
  currency: string;
  dateSpan: string;
  // Distinct masked-card hints across every parsed row, in first-seen order.
  // PrivatBank XLSX is the only format that ever produces one (section C.1,
  // a multi-card export) — every other shipped format's rows carry none, so
  // this is always `[]` for them.
  maskedCardHints: string[];
  // Rows this format's parse could not resolve (e.g. an unmapped PrivatBank
  // currency word) — excluded from `transactionCount` above, but surfaced
  // here rather than silently dropped (controller ruling 2).
  unresolvedRowCount: number;
  // Distinct currencies across every parsed row, in first-seen order (Task 3
  // review, CRITICAL fix) — a multi-card PrivatBank export can mix
  // currencies per row, and `importStatement` excludes any row whose
  // currency doesn't match the target holding's, so the user needs this
  // BEFORE picking a holding to pick one that actually matches.
  detectedCurrencies: string[];
};

// The preview's transaction-count/date-span/currency block, derived from a
// RECOGNIZED parse. `timeSeconds` reduces to the min/max across every row —
// not just the first/last row's on-file order — so an out-of-order export
// still reports its true span.
//
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
const previewStats = (
  format: StatementFormat,
  input: StatementFormatInput,
): PreviewStats | undefined => {
  try {
    const parsed = format.parse(input);
    const times = parsed.transactions.map((transaction) => transaction.timeSeconds);
    const minSeconds = Math.min(...times);
    const maxSeconds = Math.max(...times);
    const maskedCardHints = Array.from(
      new Set(
        parsed.transactions
          .map((transaction) => transaction.maskedCardHint)
          .filter((hint): hint is string => hint !== undefined),
      ),
    );
    const detectedCurrencies = Array.from(
      new Set(parsed.transactions.map((transaction) => transaction.currency)),
    );

    return {
      displayName: format.displayName,
      transactionCount: parsed.transactions.length,
      currency: parsed.account.currency,
      dateSpan: `${formatDate(minSeconds * 1000)} – ${formatDate(maxSeconds * 1000)}`,
      maskedCardHints,
      unresolvedRowCount: parsed.unresolvedRows?.length ?? 0,
      detectedCurrencies,
    };
  } catch {
    // Any parse failure here — the documented `StatementParseError` a bad
    // data row throws, or anything else unexpected — degrades to the same
    // graceful state rather than crashing the screen.
    return undefined;
  }
};

// Joins the holding rows this screen is scoped to (per `accountId`, or every
// holding when absent) against the account rows this device knows about, so
// `TargetHoldingSheet` gets a fully-formed `accountName` per row without
// owning any repo dependency of its own.
const useTargetHoldingOptions = (accountId: string | undefined): TargetHoldingOption[] => {
  const { data: holdingRows } = useLiveQuery(
    accountId ? holdingsRepo.listByAccountQuery(accountId) : holdingsRepo.allQuery(),
    ['holdings'],
  );
  const { data: accountRows } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const accountNameById = new Map(accountRows.map((row) => [row.id, row.name] as const));

  return holdingRows.map((holding) => ({
    id: holding.id,
    name: holding.name,
    accountId: holding.accountId,
    accountName: accountNameById.get(holding.accountId) ?? '',
  }));
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
  const stats = format && input ? previewStats(format, input) : undefined;
  const bankMismatch = input !== undefined && expectedFormat !== undefined && format === undefined;
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
