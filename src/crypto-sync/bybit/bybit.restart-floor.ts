/**
 * The cursor every Bybit walk goes back to when its account disconnects. It is earlier than any
 * rolling floor a walk reads from, so a walk that ignores a mark at or below it starts from its
 * own floor, and a different Bybit account that connects later cannot inherit the old one's
 * cursor.
 */
export const BYBIT_RESTART_FLOOR_MS = Date.UTC(2018, 0, 1);
