/**
 * The "which broker is this account" catalog, stored in `accounts.bankId` for
 * a `broker`-kind account. Identity only: a broker account is always manual,
 * so an entry carries no connect or import capability. Every entry always
 * renders (Guideline 5.6); `other` covers any broker not listed, and the
 * account's own name says which one it is.
 */
export const brokerIds = [
  'trading212',
  'ibkr',
  'freedom24',
  'revolut',
  'icu',
  'univer',
  'dragon',
  'other',
] as const;

export type BrokerId = (typeof brokerIds)[number];

type BrokerCatalogEntry = {
  id: BrokerId;
  /** Plain text only, never a logo. Absent for `other`, which renders its
   * translated label instead. */
  displayName?: string;
};

export const brokerCatalog: readonly BrokerCatalogEntry[] = [
  { id: 'trading212', displayName: 'Trading 212' },
  { id: 'ibkr', displayName: 'Interactive Brokers' },
  { id: 'freedom24', displayName: 'Freedom24' },
  { id: 'revolut', displayName: 'Revolut' },
  { id: 'icu', displayName: 'ICU' },
  { id: 'univer', displayName: 'UNIVER' },
  { id: 'dragon', displayName: 'Dragon Capital' },
  { id: 'other' },
];

export const isBrokerId = (value: string | null | undefined): value is BrokerId =>
  value !== null && value !== undefined && (brokerIds as readonly string[]).includes(value);
