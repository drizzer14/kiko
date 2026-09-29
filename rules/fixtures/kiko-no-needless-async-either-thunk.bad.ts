// Semgrep fixture (POSITIVE): kiko-no-needless-async-either-thunk MUST report
// a finding on every pinned line below. Never "fix" this file — see
// kiko-code-style's "`fnts` FIRST".
import either from 'fnts/either';
import { useCallback } from 'react';

type Row = { id: string };

async function loadRows(): Promise<Row[]> {
  return [];
}

const drainQueue = async (): Promise<Row[]> => [];

const refresh = useCallback(async (): Promise<void> => {}, []);

export const expressionBody = async () =>
  // EXPECT-FINDING
  either<unknown, Row[]>(async () => loadRows());

export const awaitedBody = async () =>
  // EXPECT-FINDING
  either(async () => await drainQueue());

export const returnBlock = async () =>
  // EXPECT-FINDING
  either(async () => {
    return loadRows();
  });

export const awaitedReturnBlock = async () =>
  // EXPECT-FINDING
  either(async () => {
    return await drainQueue();
  });

export const restArguments = async () =>
  // EXPECT-FINDING
  either(async (...rest: []) => loadRows(...rest));

export const callbackTarget = async () =>
  // EXPECT-FINDING
  either<unknown, void>(async () => refresh());

export const plainThunk = async () =>
  // EXPECT-FINDING
  either(() => drainQueue());

export const nestedScope = async () => {
  const readLatest = async (): Promise<Row[]> => loadRows();

  // EXPECT-FINDING
  return either(async () => readLatest());
};

export const beforeDeclaration = async () =>
  // EXPECT-FINDING
  either(async () => hoisted());

async function hoisted(): Promise<number> {
  return 1;
}
