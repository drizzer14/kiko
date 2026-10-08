// The maximum whole-month term a loan OR a term deposit's form accepts.
// Shared by `loanFieldErrors` and `termDepositFieldErrors` so both fields cap
// identically: an uncapped value (e.g. "99999999", still a valid positive
// integer) makes `loanInstallments`/deposit compounding math build an
// unbounded number of rows on every render, hanging the app. 600 months (50
// years) comfortably covers any real mortgage/car-loan/deposit term.
export const MAX_TERM_MONTHS = 600;
