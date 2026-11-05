import { match, P } from 'ts-pattern';
import { i18n } from '@kiko/i18n/init';

import { BybitRateLimitError, type BybitRefusalClass, BybitRefusalError } from './bybit.client';

/** HTTP 403 as the client reports it: a banned IP and a US or China IP answer alike. */
const FORBIDDEN_STATUS = 403;

const generic = (code: number | undefined): string =>
  i18n.t('accountDetail.bybitRequestFailed', { code: code ?? '' });

/**
 * One text per refusal class. A class that names no cause the user can act on (a signing fault, a
 * window fault, a bound IP, a code the client does not know) gets the generic text with its code.
 */
const textOfRefusal = (refusal: BybitRefusalClass, code: number | undefined): string =>
  match(refusal)
    .returnType<string>()
    .with('expired', () => i18n.t('accountDetail.bybitKeyRefusedExpired'))
    .with('rejected', () => i18n.t('accountDetail.bybitKeyRefused'))
    .with('clock', () => i18n.t('accountDetail.bybitClockOff'))
    .with('permission', () => i18n.t('accountDetail.bybitKeyMissingPermission'))
    .with('compliance', () => i18n.t('accountDetail.bybitComplianceRefused'))
    .with('malformed', () => i18n.t('accountDetail.bybitMissingBalances'))
    .with(P.union('sign', 'window', 'ip', 'notUnified', 'unknown'), () => generic(code))
    .exhaustive();

/**
 * The error of a sync the cooldown stopped. The cooldown keeps no cause, and this text fits a rate
 * refusal and a 403 alike: it names both and states the wait as "up to 10 minutes". No cooldown
 * lasts longer than that (`retryAfterMsOf` keeps a reset time only within it), and a rate refusal
 * can cool the account for less.
 */
export const bybitCoolingFailure = (): Error => new Error(i18n.t('accountDetail.bybitForbidden'));

/**
 * A typed Bybit refusal as the localized error the sync shows (`useSyncAction` surfaces its
 * message as it is), since a typed error carries a fixed English message that is no user text.
 * An error that is no Bybit refusal, a lost network for one, passes as it is.
 */
export const bybitFailureOf = (error: unknown): unknown =>
  match(error)
    .returnType<unknown>()
    .with(P.instanceOf(BybitRateLimitError), ({ code }) =>
      code === FORBIDDEN_STATUS ? bybitCoolingFailure() : new Error(generic(code)),
    )
    .with(
      P.instanceOf(BybitRefusalError),
      ({ refusal, code }) => new Error(textOfRefusal(refusal, code)),
    )
    .otherwise(() => error);
