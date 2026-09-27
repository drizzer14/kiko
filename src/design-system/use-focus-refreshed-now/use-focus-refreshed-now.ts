import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

/**
 * A `now` timestamp that is stable across renders but REFRESHES every time the
 * screen regains focus. The Statistics screen keys its default range end, its
 * three "value now" chart points, and the backfill's "today" on this value; a
 * plain `useMemo(() => Date.now(), [])` froze it at mount, so in a long-lived
 * session a just-added today/now row could fall outside the window or be valued
 * stale. Refreshing on focus (never per-render — that would defeat the
 * downstream memos keyed on it) keeps those current.
 */
export const useFocusRefreshedNow = (): number => {
  const [now, setNow] = useState(() => Date.now());

  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
    }, []),
  );

  return now;
};
