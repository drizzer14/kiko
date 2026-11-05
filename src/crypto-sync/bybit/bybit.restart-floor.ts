/**
 * The cursor every Bybit walk goes back to when its account disconnects. It is earlier than any
 * rolling floor a walk reads from, so a walk that ignores a mark at or below it starts from its
 * own floor, and a different Bybit account that connects later cannot inherit the old one's
 * cursor. It is also at or below Binance's `HISTORY_FLOOR_MS`: the reset state stays on the
 * account, and a Binance connect on it later would start its walk at a later cursor, leaving the
 * ground between the two unread for BTC.
 */
export const BYBIT_RESTART_FLOOR_MS = Date.UTC(2017, 0, 1);
