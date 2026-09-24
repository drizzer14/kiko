import { normalizeIsin, validateIsin } from '.';

// Real NBU-register ISINs used as fixtures — `UA4000227045` is a real
// Ukrainian domestic government bond (OVDP) ISIN. `UA4000215008` and
// `XS2100000004` could not be confirmed against a live NBU register from
// this repo (grep of `docs/research` found no source list), so their check
// digits were COMPUTED with the ISO 6166 Luhn algorithm rather than sourced
// — see the T22/T23 report for the disclosure. All three are structurally
// well-formed (a real 2-letter country/issuer prefix, `UA` domestic or `XS`
// international, followed by 9 alphanumerics and a valid check digit), which
// is everything `validateIsin` actually checks.
describe('normalizeIsin', () => {
  it('trims surrounding whitespace and uppercases the value', () => {
    expect(normalizeIsin(' ua4000227045 ')).toBe('UA4000227045');
  });

  it('is idempotent on an already-normalized ISIN', () => {
    expect(normalizeIsin('XS2100000004')).toBe('XS2100000004');
  });
});

describe('validateIsin', () => {
  it('accepts a real UA ISIN, trimming and uppercasing it first', () => {
    expect(validateIsin(' ua4000227045 ')).toEqual({ ok: true, isin: 'UA4000227045' });
  });

  it('accepts a second UA ISIN', () => {
    expect(validateIsin('UA4000215008')).toEqual({ ok: true, isin: 'UA4000215008' });
  });

  it('accepts an XS (international) ISIN', () => {
    expect(validateIsin('XS2100000004')).toEqual({ ok: true, isin: 'XS2100000004' });
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
