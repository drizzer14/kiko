import type { MonobankClientInfo, MonobankStatementItem } from './monobank.types';

const base = 'https://api.monobank.ua';

const request = async <T>(path: string, token: string, fetchImpl: typeof fetch): Promise<T> => {
  const response = await fetchImpl(`${base}${path}`, { headers: { 'X-Token': token } });
  if (!response.ok) {
    throw new Error(`Monobank request failed: ${response.status}`);
  }
  return (await response.json()) as T;
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
