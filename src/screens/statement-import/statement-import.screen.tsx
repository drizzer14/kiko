import type { FC } from 'react';
import * as RNFS from 'react-native-fs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { formatDate } from '../../dates/format';
import { holdingsRepo } from '../../holdings/repo';
import Box from '../../design-system/components/box';
import { useLiveQuery } from '../../db/use-live-query';
import Text from '../../design-system/components/text';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import { accountsRepo } from '../../accounts/accounts.repo';
import { detectFormat } from '../../statement-import/registry';
import type { AccountsStackParamList } from '../../navigation/types';
import type { StatementFormat } from '../../statement-import/parser';
import { importStatement, type ImportResult } from '../../statement-import/import-statement';

import { styles } from './statement-import.styles';
import TargetHoldingSheet from './target-holding-sheet';
import type { TargetHoldingOption } from './target-holding-sheet/target-holding-sheet.props';

type StatementImportScreenProps = NativeStackScreenProps<AccountsStackParamList, 'StatementImport'>;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Decodes a base64 string to its raw bytes, WITHOUT `Buffer` (not guaranteed
// to exist as a global under Hermes — this app has no `buffer` polyfill
// anywhere, confirmed by grep) and without `atob` (a standard global too, but
// one that only ever yields a Latin-1 byte string, one JS char per byte —
// exactly the shape `decodeUtf8Bytes` below needs, so a real `atob` would
// have worked as the FIRST half of this pipeline; it is avoided here purely
// because its Hermes availability is equally unverified, not because of any
// UTF-8 defect in what it returns). Table lookup + bit-shifting only, so this
// is provably correct under both Jest's Node engine and Hermes — no
// engine-specific API, just arithmetic.
const decodeBase64ToBytes = (base64: string): number[] => {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  // The regex above already dropped every character not in
  // `BASE64_ALPHABET`, so `BASE64_ALPHABET.indexOf(char)` can never miss
  // here — no `=== -1` guard needed.
  for (const char of clean) {
    const sextet = BASE64_ALPHABET.indexOf(char);

    buffer = (buffer << 6) | sextet;
    bitsCollected += 6;

    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  return bytes;
};

// Decodes a UTF-8 byte sequence to a JS string, handling every 1/2/3/4-byte
// form (the Monobank fixture's Cyrillic descriptions are 2-byte) — this is
// the step a bare `atob()` skips, which is what corrupts multi-byte text
// (see the task brief's base64-decode ruling): `atob` alone treats each BYTE
// as one Latin-1 CHARACTER, so a 2-byte Cyrillic codepoint renders as two
// mangled Latin-1 characters instead of being recombined into one.
const decodeUtf8Bytes = (bytes: number[]): string => {
  let result = '';
  let index = 0;

  while (index < bytes.length) {
    const byte1 = bytes[index];

    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
      index += 1;
    } else if ((byte1 & 0xe0) === 0xc0) {
      const codepoint = ((byte1 & 0x1f) << 6) | (bytes[index + 1] & 0x3f);
      result += String.fromCharCode(codepoint);
      index += 2;
    } else if ((byte1 & 0xf0) === 0xe0) {
      const codepoint =
        ((byte1 & 0x0f) << 12) | ((bytes[index + 1] & 0x3f) << 6) | (bytes[index + 2] & 0x3f);
      result += String.fromCharCode(codepoint);
      index += 3;
    } else {
      const codepoint =
        ((byte1 & 0x07) << 18) |
        ((bytes[index + 1] & 0x3f) << 12) |
        ((bytes[index + 2] & 0x3f) << 6) |
        (bytes[index + 3] & 0x3f);
      const surrogatePair = codepoint - 0x10000;
      result += String.fromCharCode(
        0xd800 + (surrogatePair >> 10),
        0xdc00 + (surrogatePair & 0x3ff),
      );
      index += 4;
    }
  }

  return result;
};

// The one Hermes-safe base64 -> UTF-8 decode path for a picked file's
// content — see `decodeBase64ToBytes`/`decodeUtf8Bytes` above for why this
// does not reach for `Buffer` or `atob`.
const decodeBase64Utf8 = (base64: string): string => decodeUtf8Bytes(decodeBase64ToBytes(base64));

// The file's own basename, derived from the resolved `filePath` — none of the
// shipped formats' `detect`/`parse` actually reads `fileName` (see
// `monobank-csv.format.ts`), but `StatementFormatInput` still carries it, so
// a real (if inert) value is passed rather than an empty string.
const fileNameOf = (filePath: string): string => filePath.split('/').pop() ?? filePath;

type PreviewStats = {
  displayName: string;
  transactionCount: number;
  currency: string;
  dateSpan: string;
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
  input: { text: string; fileName: string },
): PreviewStats | undefined => {
  try {
    const parsed = format.parse(input);
    const times = parsed.transactions.map((transaction) => transaction.timeSeconds);
    const minSeconds = Math.min(...times);
    const maxSeconds = Math.max(...times);

    return {
      displayName: format.displayName,
      transactionCount: parsed.transactions.length,
      currency: parsed.account.currency,
      dateSpan: `${formatDate(minSeconds * 1000)} – ${formatDate(maxSeconds * 1000)}`,
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
type LoadState = { kind: 'loading' } | { kind: 'unreadable' } | { kind: 'ready'; text: string };

/**
 * The shared preview + target-holding screen both statement-import entry
 * points converge on — see docs/plans/statement-import.md section B. Reads
 * `filePath` as base64 (react-native-fs), decodes it back to UTF-8 text,
 * runs it through `detectFormat`/`format.parse`, and either shows the
 * "unrecognized format" state or a preview plus the target-holding picker
 * and the `importStatement` action.
 */
const StatementImportScreen: FC<StatementImportScreenProps> = ({ route, navigation }) => {
  const { filePath, accountId } = route.params;
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
      .then((base64) => {
        if (!cancelled) {
          setLoadState({ kind: 'ready', text: decodeBase64Utf8(base64) });
        }
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
  const input = loadState.kind === 'ready' ? { text: loadState.text, fileName } : undefined;
  const format = input ? detectFormat(input) : undefined;
  const stats = format && input ? previewStats(format, input) : undefined;
  // Covers every "this file cannot be imported as-is" outcome under one
  // message: the read itself failed, OR the read succeeded but no format
  // recognized it, OR a format matched and then failed to parse a data row.
  // The user does not need to know WHERE in the pipeline it failed.
  const showUnreadable =
    loadState.kind === 'unreadable' || (input !== undefined && stats === undefined);

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

        {showUnreadable && <Text variant="body">{t('statementImport.unrecognizedFormat')}</Text>}

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

            {importError !== undefined && (
              <Text variant="body" tone="negative">
                {importError}
              </Text>
            )}

            {importResult && (
              <Text variant="body">
                {t('statementImport.importedCount', {
                  imported: importResult.imported,
                  total: importResult.total,
                })}
              </Text>
            )}
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
