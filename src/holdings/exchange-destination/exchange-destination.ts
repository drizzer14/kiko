import type { HoldingType } from '../holding-type';
import { holdingDescriptor } from '../holding-descriptor';

// The receive path an Exchange destination takes, keyed by its holding type.
// This is the ONE source of truth for both `recordExchange`'s dispatch and the
// form's destination filter, so the two can never disagree on what is
// eligible; each type's own descriptor (`src/holdings/holding-descriptor/`)
// carries it, so adding a holding type is a compile error there until this
// mapping is updated.
export type ExchangeReceivePath = 'plain' | 'contribution' | 'excluded';

export const exchangeReceivePath = (type: HoldingType): ExchangeReceivePath =>
  holdingDescriptor(type).exchange.receivePath;

// A type is an eligible Exchange destination when it has any receive path other
// than 'excluded' (bond/jar have no clear "receive an arbitrary amount" path).
export const isExchangeDestinationType = (type: HoldingType): boolean =>
  exchangeReceivePath(type) !== 'excluded';

// Exchange is offered only from a liquid source — cash or card.
export const isExchangeSourceType = (type: HoldingType): boolean =>
  holdingDescriptor(type).exchange.source;

// CREATE-mode eligibility (Requirement B, device review 2026-09-06): a NEW
// exchange must move cash -> cash. Narrower than `isExchangeSourceType` /
// `isExchangeDestinationType` (the wider convert-mode rule), which stay as-is so
// convert-mode keeps the original card/crypto/term_deposit reach. Both sides
// share the same rule today (cash only) but are kept as two named predicates
// on the descriptor so the source and destination create-rules can diverge
// later without a call-site change.
export const isExchangeCreateSourceType = (type: HoldingType): boolean =>
  holdingDescriptor(type).exchange.createSource;

export const isExchangeCreateDestinationType = (type: HoldingType): boolean =>
  holdingDescriptor(type).exchange.createDestination;
