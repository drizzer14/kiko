/*
 Add `sync_state.exchange_state`: an exchange account's history walk state as JSON text, and copy
 into it the walk keys the Binance walks kept on the Spot BTC holding's metadata, so no walk loses
 its place.

 The copy reads only the FIRST Spot BTC holding of each account, ranked by `(sort_order,
 created_at)`, the order the walk reads holdings in, even when that holding has no walk key and a
 later one has (the walk reads the first one too). Ties stay in the order the engine returns them,
 as the walk's own query does. Every `json_extract` over `metadata` sits behind a `json_valid`
 CASE, because SQLite does not promise that an `AND` short-circuits and `json_extract` raises an
 error on malformed JSON: an account whose metadata is not JSON is skipped, and its walks start
 from their floors, where keys dedupe. A disconnected account copies too, so its floor values stay.

 Each walk entry is a `json_group_object` over the keys present on that holding, so an absent key
 adds no field, and each value is copied as stored through `json(...)`, so a string stays a string,
 `true` stays `true`, and a malformed `pending` value is kept for the reader to repair field by
 field. The entries are joined through `json(entry)`; without it an entry is stored as quoted text.
 Never `json_extract` straight into `json_object`: an absent key would write `null`, a string
 would lose its quotes and `true` would become 1.

 The insert creates the `sync_state` row when none exists, with its other columns null, so nothing
 reads the account as synced; an existing row keeps its stamps and gets only this column.

 Crash-safe: the runner applies both statements and its bookkeeping row in ONE transaction, so a
 crash leaves the database one step back to retry whole on the next launch. The old metadata keys
 stay where they are and are no longer read; the next balance sync drops them.
*/
ALTER TABLE `sync_state` ADD `exchange_state` text;
--> statement-breakpoint
WITH walk_key_map (walk, field, path) AS (
  VALUES
    ('capital', 'cursor', '$.binanceHistoryCursor'),
    ('capital', 'rescan', '$.binanceHistoryRescanCursor'),
    ('capital', 'pending', '$.binanceHistoryPendingOverlap'),
    ('capital', 'pointCursor', '$.binanceHistoryPointCursor'),
    ('capital', 'rangeCursor', '$.binanceHistoryRangeCursor'),
    ('capital', 'spanHints', '$.binanceHistorySpanHints'),
    ('pay', 'cursor', '$.binancePayHistoryCursor'),
    ('pay', 'rescan', '$.binancePayRescanCursor'),
    ('pay', 'pending', '$.binancePayPendingOverlap'),
    ('pay', 'pointCursor', '$.binancePayPointCursor'),
    ('pay', 'rangeCursor', '$.binancePayRangeCursor'),
    ('pay', 'spanHints', '$.binancePaySpanHints'),
    ('transfer', 'cursor', '$.binanceTransferHistoryCursor'),
    ('transfer', 'rescan', '$.binanceTransferRescanCursor'),
    ('transfer', 'pending', '$.binanceTransferPendingOverlap'),
    ('transfer', 'pointCursor', '$.binanceTransferPointCursor'),
    ('transfer', 'rangeCursor', '$.binanceTransferRangeCursor'),
    ('transfer', 'spanHints', '$.binanceTransferSpanHints'),
    ('earn', 'cursor', '$.binanceEarnHistoryCursor'),
    ('earn', 'rescan', '$.binanceEarnRescanCursor'),
    ('earn', 'pending', '$.binanceEarnPendingOverlap'),
    ('earn', 'pointCursor', '$.binanceEarnPointCursor'),
    ('earn', 'rangeCursor', '$.binanceEarnRangeCursor'),
    ('earn', 'spanHints', '$.binanceEarnSpanHints')
),
first_spot_btc AS (
  SELECT account_id, metadata FROM (
    SELECT account_id, metadata,
      ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY sort_order, created_at) AS position
    FROM holdings
    WHERE CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.binanceAsset') END = 'BTC'
  )
  WHERE position = 1
),
walk_entries AS (
  SELECT first_spot_btc.account_id AS account_id, walk_key_map.walk AS walk,
    json_group_object(
      walk_key_map.field,
      json(CASE WHEN json_valid(first_spot_btc.metadata)
        THEN first_spot_btc.metadata -> walk_key_map.path END)
    ) AS entry
  FROM first_spot_btc, walk_key_map
  WHERE CASE WHEN json_valid(first_spot_btc.metadata)
    THEN json_type(first_spot_btc.metadata, walk_key_map.path) END IS NOT NULL
  GROUP BY first_spot_btc.account_id, walk_key_map.walk
)
INSERT INTO sync_state (account_id, exchange_state)
SELECT account_id, json_object('version', 1, 'walks', json_group_object(walk, json(entry)))
FROM walk_entries
GROUP BY account_id
ON CONFLICT(account_id) DO UPDATE SET exchange_state = excluded.exchange_state;
