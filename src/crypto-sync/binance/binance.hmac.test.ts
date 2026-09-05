import { signQuery } from './binance.hmac';

// RFC 4231 §4.3 test case 2 (HMAC-SHA-256).
const RFC4231_CASE_2 = {
  signer: 'Jefe',
  data: 'what do ya want for nothing?',
  digest: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
};

// Binance "Request security" documentation example (public sample values):
// https://developers.binance.com/docs/binance-spot-api-docs/rest-api/request-security
const BINANCE_DOCS_EXAMPLE = {
  signer: 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j',
  data: 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559',
  digest: 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71',
};

describe('signQuery', () => {
  it('matches the RFC 4231 HMAC-SHA-256 test vector', () => {
    expect(signQuery(RFC4231_CASE_2.signer, RFC4231_CASE_2.data)).toBe(RFC4231_CASE_2.digest);
  });

  it("matches Binance's documented request-signing example", () => {
    expect(signQuery(BINANCE_DOCS_EXAMPLE.signer, BINANCE_DOCS_EXAMPLE.data)).toBe(
      BINANCE_DOCS_EXAMPLE.digest,
    );
  });

  it('signs an account query the way the client builds it', () => {
    // openssl dgst -sha256 -hmac 'secret-fixture' over the same query string.
    expect(signQuery('secret-fixture', 'timestamp=1704326400000&recvWindow=5000')).toBe(
      'c548b5a5c27c61b57b685766340cfe11dff7cb5d0a693484f3af3e13f129df7f',
    );
  });

  it('returns 64 lowercase hex characters', () => {
    expect(signQuery('a', 'b')).toMatch(/^[0-9a-f]{64}$/);
  });
});
