// PrivatBank AutoClient API wire shapes. EVERY field's presence, name, and
// format below is UNVERIFIED — modeled on the placeholder shapes in
// docs/plans/bank-providers.md section B and on the public reference clients
// `volodymyrsmirnov/Privatbank.Business` and `kagatan/privatbank-autoclient`,
// not on a confirmed live response. Each assumption carries its own
// TODO(VERIFY LIVE) marker; the coordinator runs the live verification pass
// separately (see the task brief's "VERIFY-LIVE discipline").

export interface PrivatbankAccount {
  // TODO(VERIFY LIVE): confirm whether `acc` is the account's IBAN or an
  // internal PrivatBank account id, and whether a separate `id` field also
  // exists alongside it.
  acc: string;
  // TODO(VERIFY LIVE): confirm whether PrivatBank returns an alphabetic ISO
  // 4217 code ('UAH') like this placeholder assumes, or a numeric code like
  // Monobank's `currencyCode` — see `currencyFromPrivatbankCode` in
  // `src/privatbank/sync/sync.ts`.
  currency: string;
  // TODO(VERIFY LIVE): confirm the balance is a decimal string in MAJOR units
  // (e.g. '1234.56'), not integer minor units like Monobank's `balance`.
  balance: string;
  name?: string;
}

export interface PrivatbankStatementItem {
  // TODO(VERIFY LIVE): confirm this id is unique per-account (this repo's
  // namespaced `externalId` — `${accountId}:${item.id}` — tolerates either),
  // and whether it is stable across a re-fetch of the same statement window.
  id: string;
  // TODO(VERIFY LIVE): confirm the exact date format — assumed
  // 'DD.MM.YYYY HH:mm:ss' here, per the reference clients' documented
  // convention (Monobank instead returns unix seconds).
  date: string;
  // TODO(VERIFY LIVE): confirm this is a signed decimal string in MAJOR units
  // (debit negative / credit positive), not integer minor units.
  amount: string;
  currency: string;
  description?: string;
  counterIban?: string;
}
