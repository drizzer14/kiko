# Pay in parts (instalment purchases) — research

- **Status:** RESEARCH ONLY, no decision. **Not in Round B scope.** Depends on the user's open scope question — see memory `shares-scope-may-be-cut`; the same scope caution applies here.
- **Date checked:** 2026-10-02, by `kiko:researcher`. The key data claim (Monobank statement fields) was spot-checked by the coordinator.

---

## 1. Ukrainian "pay in parts" products

| Product | Terms | Source |
|---|---|---|
| Monobank "Покупка частинами" | 2–25 parts; 0% when the merchant is a partner and pays the fee, else 1.9%/month; first part debited at confirmation, later parts the same day each month from the same card; draws the card's own credit limit; early repayment allowed | [monobank.ua/en/chast](https://monobank.ua/en/chast), [api-docs](https://monobank.ua/en/api-docs/chast), [knowledge base](https://monobank.ua/knowledge-base/chast/marketing/brand) |
| PrivatBank "Оплата частинами" | ~0.01%/month nominal, merchant pays | secondary: rates.fm, bankchart.com.ua; primary PDF `https://static.privatbank.ua/files/0000004286340827.pdf` not readable by the researcher |
| PrivatBank "Миттєва розстрочка" | ~1.9%/month, 2–25 payments | [help.wayforpay.com](https://help.wayforpay.com/view/13730132) |
| PUMB "Сплачуйте частинами" | 2–24 months, first part deferred ~1 month: **not verified** | — |
| UKRSIBBANK "Плати частинами" | 3–24 months | — |
| A-Bank | up to 25 payments | — |
| Sense Bank | promo 3 parts 0% | — |
| Raiffeisen | not found | — |

Missed-part handling (late fee, acceleration, credit-limit impact) is not documented anywhere for any of these products. **Not verified.**

---

## 2. What the data looks like

The Monobank personal statement item has these fields (coordinator downloaded `https://api.monobank.ua/docs/index.html` on 2026-10-02): `id`, `time`, `description`, `mcc`, `originalMcc`, `hold`, `amount`, `operationAmount`, `currencyCode`, `commissionRate`, `cashbackAmount`, `balance`, `comment`, `receiptId`, `invoiceId`, `counterEdrpou`, `counterIban`, `counterName`.

**No instalment marker exists** in this field set.

**[inferred, not verified against a real statement]** Each part likely arrives as its own monthly debit carrying the merchant's own description, so it looks like a recurring subscription in the statement. Automatic detection of an instalment purchase from the data alone is not reliable.

Statement exports of other banks (PrivatBank, PUMB, UKRSIBBANK, A-Bank, Sense Bank) for instalment purchases are not verified.

---

## 3. How other apps handle this

Monarch Money does not model BNPL/instalments as a distinct concept — each instalment debit is treated as an ordinary transaction ([thecollegeinvestor.com](https://thecollegeinvestor.com/32672/best-budgeting-apps/)). **[inferred]** the same holds for YNAB, Copilot, Spendee, Wallet, Monefy, and ZenMoney — none of these publicize an instalment-purchase feature.

Apple Pay Later was discontinued; Apple Pay now routes "pay later" through third parties (Affirm, Klarna) instead of a native Apple feature ([shopify.com](https://www.shopify.com/blog/bnpl-companies)).

---

## 4. Fit with Kiko

A 0% loan already works today in the existing loan model:

- `src/screens/forms/holding-form/loan/use-loan-fields/use-loan-fields.ts:90-93` — `annualRateError` only fires when `rate >= 0` fails, so a rate of exactly 0 passes validation.
- `src/holdings/loan-schedule/loan-schedule.ts:57-61` — the `monthlyRate === 0` branch computes a flat `principal / termMonths` payment, so a 0% schedule already amortizes correctly.
- `src/holdings/holding-metadata/holding-metadata.ts` — `asLoanMeta` accepts a loan with rate 0.

**Gaps:**

1. `src/loans/payment-matcher/payment-matcher.ts` needs a third signal (paid-from holding, lender IBAN, loan keyword, or lender name) to link a payment, per its existing matching rules (see the file's own matching logic around `paymentHoldingId`/`lenderName`/`lenderIban`, `src/loans/payment-matcher/payment-matcher.ts:130-139`). A merchant-named monthly part debit matches only through `paymentHoldingId`, with a real false-match risk against any other same-size recurring debit (a subscription, rent). Without a link, each part is just counted as ordinary spending.
2. **Double-count risk:** if the user ALSO records the original full purchase as a one-time expense, the purchase is counted twice — once as the lump expense, once again as the sum of the linked monthly parts.

---

## 5. Options

**Option 1 (recommended):** add an "instalment purchase" preset to the existing loan form — 0% annuity, term = number of parts, paid-from = the card used — plus a suggested-link flow for each monthly debit that the user confirms with a tap, plus an explicit warning not to also record the purchase as a separate expense. Small effort; reuses the existing loan/payment-matcher machinery.

**Option 2:** spread one purchase's spending over N months inside Statistics only, with no loan/debt holding involved. Medium effort. Useful only for a lump-sum debit pattern (one debit at purchase time, amortized in reporting) — this does not match the Ukrainian "N separate monthly debits" pattern seen in §1, so it fits the data poorly.

**Option 3:** a plain tracker (principal, parts paid, next date) with no effect on net worth or spending categorization. Smallest effort, least value — it does not solve the double-count or spending-categorization problem at all.

All three options comply with Guideline 5.6 if shipped always-visible (no flag-gated or conditional rollout).

---

## 6. Next step before any design work

Confirm "one debit per part, each carrying the merchant's own description" against **one real Monobank statement** containing such a purchase. Check this locally and offline before relying on the inference in §2.
