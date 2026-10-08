import { act, renderHook } from '@testing-library/react-native';
import type { ImportBalancePreview } from '@kiko/transactions/repo';
import type { ParsedStatement } from '@kiko/statement-import/parser';

const mockPreviewParsedStatementBalance = jest.fn();
jest.mock('@kiko/statement-import/import-statement', () => ({
  previewParsedStatementBalance: (...args: unknown[]) => mockPreviewParsedStatementBalance(...args),
}));

const mockLogFailure = jest.fn();
jest.mock('@kiko/diagnostics', () => ({
  logFailure: (...args: unknown[]) => mockLogFailure(...args),
}));

import { useImportBalancePreview } from './use-import-balance-preview';

const statementOf = (description: string): ParsedStatement => ({
  formatId: 'column-mapping',
  account: { currency: 'UAH' },
  transactions: [
    { currency: 'UAH', amountMinorUnits: -100, timeSeconds: 1_700_000_000, description },
  ],
});

const stays = (minorUnits: number): ImportBalancePreview => ({
  kind: 'stays',
  currency: 'UAH',
  minorUnits,
});

type Deferred = {
  promise: Promise<ImportBalancePreview>;
  resolve: (value: ImportBalancePreview) => void;
};

const deferred = (): Deferred => {
  let resolve: Deferred['resolve'] = () => undefined;
  const promise = new Promise<ImportBalancePreview>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
};

const renderForHolding = (statement: ParsedStatement) =>
  renderHook(
    ({ holdingId }: { holdingId: string }) => useImportBalancePreview(statement, holdingId),
    { initialProps: { holdingId: 'holding-1' } },
  );

describe('useImportBalancePreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('asks for nothing and shows nothing until a holding is picked', async () => {
    const { result } = await renderHook(() => useImportBalancePreview(statementOf('a'), undefined));

    expect(result.current).toBeUndefined();
    expect(mockPreviewParsedStatementBalance).not.toHaveBeenCalled();
  });

  it('asks for nothing and shows nothing while there is no statement', async () => {
    const { result } = await renderHook(() => useImportBalancePreview(undefined, 'holding-1'));

    expect(result.current).toBeUndefined();
    expect(mockPreviewParsedStatementBalance).not.toHaveBeenCalled();
  });

  it('shows the preview of the statement for the picked holding', async () => {
    const statement = statementOf('a');

    mockPreviewParsedStatementBalance.mockResolvedValue(stays(500));

    const { result } = await renderHook(() => useImportBalancePreview(statement, 'holding-1'));

    await act(async () => {});

    expect(mockPreviewParsedStatementBalance).toHaveBeenCalledWith(statement, 'holding-1');
    expect(result.current).toEqual(stays(500));
  });

  it('shows nothing when the preview cannot be read', async () => {
    const statement = statementOf('a');

    mockPreviewParsedStatementBalance.mockRejectedValue(
      new Error('statement-import/synced-account'),
    );

    const { result } = await renderHook(() => useImportBalancePreview(statement, 'holding-1'));

    await act(async () => {});

    expect(result.current).toBeUndefined();
  });

  it('logs a preview that cannot be read, with the failure it raised', async () => {
    const statement = statementOf('a');
    const failure = new Error('statement-import/preview-pending');

    mockPreviewParsedStatementBalance.mockRejectedValue(failure);

    await renderHook(() => useImportBalancePreview(statement, 'holding-1'));

    await act(async () => {});

    expect(mockLogFailure).toHaveBeenCalledTimes(1);
    expect(mockLogFailure).toHaveBeenCalledWith(
      '[statement-import] balance preview failed',
      failure,
    );
  });

  it('logs nothing when the preview is read', async () => {
    const statement = statementOf('a');

    mockPreviewParsedStatementBalance.mockResolvedValue(stays(500));

    await renderHook(() => useImportBalancePreview(statement, 'holding-1'));

    await act(async () => {});

    expect(mockLogFailure).not.toHaveBeenCalled();
  });

  it('asks again for a new holding and never shows the old holding’s number meanwhile', async () => {
    const statement = statementOf('a');
    const second = deferred();

    mockPreviewParsedStatementBalance.mockResolvedValueOnce(stays(500));
    mockPreviewParsedStatementBalance.mockReturnValueOnce(second.promise);

    const { result, rerender } = await renderForHolding(statement);

    await act(async () => {});

    expect(result.current).toEqual(stays(500));

    await rerender({ holdingId: 'holding-2' });

    expect(result.current).toBeUndefined();

    await act(async () => {
      second.resolve(stays(900));
    });

    expect(mockPreviewParsedStatementBalance).toHaveBeenLastCalledWith(statement, 'holding-2');
    expect(result.current).toEqual(stays(900));
  });

  it('asks again for a changed statement', async () => {
    mockPreviewParsedStatementBalance.mockResolvedValue(stays(500));

    const { rerender } = await renderHook(
      ({ statement }: { statement: ParsedStatement }) =>
        useImportBalancePreview(statement, 'holding-1'),
      { initialProps: { statement: statementOf('a') } },
    );

    await act(async () => {});
    await rerender({ statement: statementOf('b') });
    await act(async () => {});

    expect(mockPreviewParsedStatementBalance).toHaveBeenCalledTimes(2);
  });

  it('keeps the latest request when an earlier one settles last', async () => {
    const statement = statementOf('a');
    const first = deferred();
    const second = deferred();

    mockPreviewParsedStatementBalance.mockReturnValueOnce(first.promise);
    mockPreviewParsedStatementBalance.mockReturnValueOnce(second.promise);

    const { result, rerender } = await renderForHolding(statement);

    await rerender({ holdingId: 'holding-2' });
    await act(async () => {
      second.resolve(stays(900));
    });
    await act(async () => {
      first.resolve(stays(500));
    });

    expect(result.current).toEqual(stays(900));
  });

  it('does not ask again when it re-renders with the same statement and holding', async () => {
    const statement = statementOf('a');

    mockPreviewParsedStatementBalance.mockResolvedValue(stays(500));

    const { rerender } = await renderHook(() => useImportBalancePreview(statement, 'holding-1'));

    await act(async () => {});
    await rerender({});

    expect(mockPreviewParsedStatementBalance).toHaveBeenCalledTimes(1);
  });
});
