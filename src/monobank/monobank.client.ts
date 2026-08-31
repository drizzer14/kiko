import { guard } from 'fnts';

import type { MonobankClientInfo, MonobankStatementItem } from './monobank.types';

const base = 'https://api.monobank.ua';

/**
 * Read a Monobank JSON body, or throw on a non-ok response. The ok-check is a
 * `guard` validator/executor pair rather than an imperative `if (!ok) throw`:
 * a non-ok response fails into the throwing executor; the default executor
 * parses the body.
 */
const readBody = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`Monobank request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<unknown> => response.json(),
);

const request = async <T>(path: string, token: string, fetchImpl: typeof fetch): Promise<T> => {
  const response = await fetchImpl(`${base}${path}`, { headers: { 'X-Token': token } });

  return (await readBody(response)) as T;
};

export const fetchClientInfo = (
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MonobankClientInfo> => request('/personal/client-info', token, fetchImpl);

export const fetchStatement = (
  token: string,
  accountId: string,
  fromSeconds: number,
  toSeconds: number,
  fetchImpl: typeof fetch = fetch,
): Promise<MonobankStatementItem[]> =>
  request(`/personal/statement/${accountId}/${fromSeconds}/${toSeconds}`, token, fetchImpl);
