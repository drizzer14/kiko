import { match, P } from 'ts-pattern';
import { i18n } from '@kiko/i18n/init';

import { BybitRateLimitError, type BybitRefusalClass, BybitRefusalError } from './bybit.client';

const generic = (code: number | undefined): string =>
  code === undefined
    ? i18n.t('accountDetail.bybitRequestFailedNoCode')
    : i18n.t('accountDetail.bybitRequestFailed', { code });

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

const HTTP_FORBIDDEN = 403;

/**
 * The text of a `BybitRateLimitError`. An HTTP 403 (a banned IP, a US or China IP) gets the text
 * that names both reasons and states the wait as "up to 10 minutes". A rate refusal (codes 10006,
 * 10018, HTTP 429) gets a text that claims no wait Kiko keeps: the connect check starts no cooldown
 * (it has no account), so a second Connect tap sends every request again.
 */
const rateLimitText = (error: BybitRateLimitError): string =>
  error.code === HTTP_FORBIDDEN
    ? i18n.t('accountDetail.bybitForbidden')
    : i18n.t('accountDetail.bybitRateLimited');

/**
 * The error of a sync the cooldown stopped. The cooldown keeps no cause, so it reads the text that
 * fits a rate refusal and a 403 alike, and it does start a wait Kiko keeps.
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
    .with(P.instanceOf(BybitRateLimitError), (limit) => new Error(rateLimitText(limit)))
    .with(
      P.instanceOf(BybitRefusalError),
      ({ refusal, code }) => new Error(textOfRefusal(refusal, code)),
    )
    .otherwise(() => error);

/**
 * The text that refuses a key at connect. A rejected key reads differently there than on a sync:
 * the key may be wrong, or from a Bybit site Kiko does not serve, where a sync only ever sees a key
 * that Bybit once accepted. Every other refusal has the text a sync shows. An error that is no
 * Bybit refusal, a lost network for one, names no code.
 */
export const bybitConnectFailureText = (error: unknown): string =>
  match(error)
    .returnType<string>()
    .with(P.intersection(P.instanceOf(BybitRefusalError), { refusal: 'rejected' }), () =>
      i18n.t('accountDetail.bybitKeyRejected'),
    )
    .with(P.instanceOf(BybitRateLimitError), rateLimitText)
    .with(P.instanceOf(BybitRefusalError), ({ refusal, code }) => textOfRefusal(refusal, code))
    .otherwise(() => generic(undefined));
