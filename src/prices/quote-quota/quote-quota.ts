/**
 * The EODHD calls spent on one `day`: a UTC-midnight day, because EODHD resets
 * its daily limit at midnight GMT, not on the device's day. `symbols` are the
 * symbols already requested that day, so a symbol costs at most one refresh
 * per day even when its answer brought no new close.
 */
export type QuoteQuota = { day: number; calls: number; dailyLimit: number; symbols: string[] };
