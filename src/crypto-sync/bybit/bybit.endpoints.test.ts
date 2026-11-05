import path from 'node:path';
import { BYBIT_API_ENDPOINT } from '@env';
import { readFileSync, readdirSync } from 'node:fs';

import {
  fetchFundBalance,
  fetchKeyInfo,
  fetchUnifiedBalance,
  signedBybitGet,
} from './bybit.client';
import { BYBIT_SIGNED_PATHS } from './bybit.endpoints';
import { API_KEY, SECRET, answerWith, envelopeOf } from './bybit.client-test-fixtures';

const ROOT = path.join(__dirname, '../../..');

// The closed list of reads. A route is added here, by its literal, in the step that adds it, so no
// other path can reach the client without this file changing in the same commit.
const READ_PATHS = [
  '/v5/account/wallet-balance',
  '/v5/asset/transfer/query-account-coins-balance',
  '/v5/user/query-api',
];

const ENV_FILES = [path.join(ROOT, '.env.example'), path.join(ROOT, '.env.test')];

const PLIST = path.join(ROOT, 'ios/Kiko/Info.plist');

const FORBIDDEN_HOSTS = /api\.bybit\.eu|api-testnet|api\.bytick\.com/;

// Every source module but a test: a host name in a test is the very thing this file looks for.
const sourceModules = (): string[] =>
  readdirSync(path.join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))
    .map((file) => path.join(ROOT, 'src', file));

const namesForbiddenHost = (file: string): boolean =>
  // nosemgrep: kiko-no-source-text-read-in-test OVERRIDE(host-name search)
  FORBIDDEN_HOSTS.test(readFileSync(file, 'utf8'));

const pathOf = (url: string): string => new URL(url).pathname;

describe('the closed list of Bybit reads', () => {
  it('the signed paths equal the literal list of reads, and the client sends only GET', async () => {
    expect([...BYBIT_SIGNED_PATHS]).toEqual(READ_PATHS);

    const { fetchImpl, sent } = answerWith({ body: envelopeOf(0, {}) });

    for (const readPath of BYBIT_SIGNED_PATHS) {
      await signedBybitGet(API_KEY, SECRET, readPath, {}, { fetchImpl });
    }

    expect(sent.map((request) => pathOf(request.url))).toEqual(READ_PATHS);
    expect(sent.map((request) => request.init.method)).toEqual(['GET', 'GET', 'GET']);
  });

  it('every read the client exports goes through the listed paths with GET', async () => {
    const { fetchImpl, sent } = answerWith({
      body: envelopeOf(0, { list: [{ coin: [] }], balance: [] }),
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl);

    await fetchKeyInfo(API_KEY, SECRET);
    await fetchUnifiedBalance(API_KEY, SECRET);
    await fetchFundBalance(API_KEY, SECRET);
    fetchSpy.mockRestore();

    expect(sent.map((request) => pathOf(request.url)).sort()).toEqual(READ_PATHS);
    expect(sent.map((request) => request.init.method)).toEqual(['GET', 'GET', 'GET']);
  });
});

describe('the host of a Bybit key', () => {
  it('the one signed host is api.bybit.com, and no tracked env file, plist entry or source module names api.bybit.eu or api-testnet', () => {
    const modules = sourceModules();

    expect(BYBIT_API_ENDPOINT).toBe('https://api.bybit.com');
    expect(modules.length).toBeGreaterThan(100);
    expect([...ENV_FILES, PLIST, ...modules].filter(namesForbiddenHost)).toEqual([]);
  });

  it('pins the host in the plist', () => {
    expect(readFileSync(PLIST, 'utf8')).toContain('<key>api.bybit.com</key>');
  });

  it('sends every request to the host of the environment value', async () => {
    const { fetchImpl, sent } = answerWith({
      body: envelopeOf(0, { list: [{ coin: [] }], balance: [] }),
    });

    await fetchKeyInfo(API_KEY, SECRET, { fetchImpl });
    await fetchUnifiedBalance(API_KEY, SECRET, { fetchImpl });
    await fetchFundBalance(API_KEY, SECRET, { fetchImpl });

    expect(sent.every((request) => request.url.startsWith(`${BYBIT_API_ENDPOINT}/v5/`))).toBe(true);
  });
});
