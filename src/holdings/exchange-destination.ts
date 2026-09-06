import { match } from 'ts-pattern';

import type { HoldingType } from './holding-type';

// The receive path an Exchange destination takes, keyed by its holding type.
// Exhaustive over the `holdings.type` enum (schema.ts:25) so adding a holding
// type is a compile error here until this mapping is updated. This is the ONE
// source of truth for both `recordExchange`'s dispatch and the form's
// destination filter, so the two can never disagree on what is eligible.
type ExchangeReceivePath = 'plain' | 'contribution' | 'excluded';

export const exchangeReceivePath = (type: HoldingType): ExchangeReceivePath =>
  match(type)
    .with('cash', 'card', 'crypto_asset', () => 'plain' as const)
    .with('term_deposit', () => 'contribution' as const)
    .with('bond', 'jar', () => 'excluded' as const)
    .exhaustive();

// A type is an eligible Exchange destination when it has any receive path other
// than 'excluded' (bond/jar have no clear "receive an arbitrary amount" path).
export const isExchangeDestinationType = (type: HoldingType): boolean =>
  exchangeReceivePath(type) !== 'excluded';

// Exchange is offered only from a liquid source — cash or card. Exhaustive so a
// new holding type must be classified here explicitly rather than defaulting in.
export const isExchangeSourceType = (type: HoldingType): boolean =>
  match(type)
    .with('cash', 'card', () => true)
    .with('term_deposit', 'bond', 'crypto_asset', 'jar', () => false)
    .exhaustive();

// CREATE-mode eligibility (Requirement B, device review 2026-09-06): a NEW
// exchange must move cash -> cash. Narrower than `isExchangeSourceType` /
// `isExchangeDestinationType` (the wider convert-mode rule), which stay as-is so
// convert-mode keeps the original card/crypto/term_deposit reach. Exhaustive so
// a new holding type must be classified here explicitly rather than defaulting
// in. Both sides share the same rule today (cash only) but are kept as two named
// predicates so the source and destination create-rules can diverge later
// without a call-site change.
export const isExchangeCreateSourceType = (type: HoldingType): boolean =>
  match(type)
    .with('cash', () => true)
    .with('card', 'term_deposit', 'bond', 'crypto_asset', 'jar', () => false)
    .exhaustive();

export const isExchangeCreateDestinationType = (type: HoldingType): boolean =>
  match(type)
    .with('cash', () => true)
    .with('card', 'term_deposit', 'bond', 'crypto_asset', 'jar', () => false)
    .exhaustive();
