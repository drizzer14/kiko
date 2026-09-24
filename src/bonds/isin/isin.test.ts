import { normalizeIsin, validateIsin } from '.';

// Real NBU-register ISINs used as fixtures, all three confirmed against a
// live `GET https://bank.gov.ua/depo_securities?json` fetch (T24, 2026-09-24
// — see `src/bonds/nbu-register/__fixtures__/depo-securities-sample.json`):
// `UA4000227045` and `UA4000234215` are real domestic OVDP (DCP) ISINs;
// `XS2895055981` is a real Eurobond (OZDP) ISIN. T23 originally shipped
// `UA4000215008`/`XS2100000004` here with COMPUTED (not register-sourced)
// check digits — replaced by these three once the register was fetched.
describe('normalizeIsin', () => {
  it('trims surrounding whitespace and uppercases the value', () => {
    expect(normalizeIsin(' ua4000227045 ')).toBe('UA4000227045');
  });

  it('is idempotent on an already-normalized ISIN', () => {
    expect(normalizeIsin('XS2895055981')).toBe('XS2895055981');
  });
});

describe('validateIsin', () => {
  it('accepts a real UA ISIN, trimming and uppercasing it first', () => {
    expect(validateIsin(' ua4000227045 ')).toEqual({ ok: true, isin: 'UA4000227045' });
  });

  it('accepts a second UA ISIN', () => {
    expect(validateIsin('UA4000234215')).toEqual({ ok: true, isin: 'UA4000234215' });
  });

  it('accepts an XS (international) ISIN', () => {
    expect(validateIsin('XS2895055981')).toEqual({ ok: true, isin: 'XS2895055981' });
  });

  it('rejects a valid-shaped ISIN with one changed digit as a checkDigit failure', () => {
    // The last digit of a valid ISIN (UA4000227045) changed from 5 to 6 —
    // still 12 characters, still shaped `^[A-Z]{2}[A-Z0-9]{9}[0-9]$`, so the
    // format check passes and only the checksum catches it.
    expect(validateIsin('UA4000227046')).toEqual({ ok: false, reason: 'checkDigit' });
  });

  it('rejects a candidate shorter than 12 characters as a format failure', () => {
    expect(validateIsin('UA400022704')).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects a candidate longer than 12 characters as a format failure', () => {
    expect(validateIsin('UA40002270455')).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects a country prefix that is not two letters as a format failure', () => {
    expect(validateIsin('U14000227045')).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects a lowercase-with-symbols candidate as a format failure once trimmed/uppercased still invalid', () => {
    expect(validateIsin('UA-000227045')).toEqual({ ok: false, reason: 'format' });
  });
});
