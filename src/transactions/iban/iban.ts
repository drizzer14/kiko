// Matches the ISO 13616 IBAN shape: 2 uppercase letters (country code), 2
// check digits, then the BBAN (11-30 alphanumerics) — the same shape a
// `counterpartyColumn` value must have to be treated as an IBAN rather than a
// free-text counterparty name (routed to `comment` instead). No checksum is
// read: a fixture or restored value fails it.
export const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/** The one spelling an IBAN is compared in: no spaces, uppercase. */
export const ibanKeyOf = (iban: string): string => iban.replace(/\s+/g, '').toUpperCase();
