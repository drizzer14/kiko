// Semgrep fixture (NEGATIVE): kiko-no-needless-async-either-thunk must report
// nothing here. `either` calls its thunk outside its own promise chain, so an
// `async` wrapper is needless ONLY around a function that is itself `async`.
import either from 'fnts/either';
import { useCallback } from 'react';
import { refreshBondRegisterIfStale } from '@kiko/bonds/bond-register-repo';

type Row = { id: string };

async function loadRows(): Promise<Row[]> {
  return [];
}

async function loadRow(id: string): Promise<Row> {
  return { id };
}

// Not async: it can throw synchronously, and only the async wrapper turns
// that throw into a Left.
const ensureAccount = (): Promise<string> => Promise.resolve('account');

const repository = { load: async (): Promise<Row[]> => [] };

const reload = useCallback((): Promise<Row[]> => loadRows(), []);

export const plainCallback = async () => either(async () => reload());

export const direct = async () => either(loadRows);

export const syncThrowGuarded = async () => either(async () => ensureAccount());

export const importedCallee = async () => either(async () => refreshBondRegisterIfStale());

export const methodCall = async () => either(async () => repository.load());

export const changedArguments = async () => either(async () => loadRow('row-1'));

export const twoCalls = async () =>
  either(async () => {
    await loadRows();

    return loadRows();
  });

export const voidBody = async () =>
  either(async () => {
    await loadRows();
  });

export const promiseValue = async (query: Promise<Row[]>) => either(async () => query);
