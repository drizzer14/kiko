import { useEffect, useState } from 'react';

/**
 * A `now` timestamp that is stable across renders but REFRESHES every time the
 * screen becomes visible. The Statistics screen keys its default range end, its
 * three "value now" chart points, and the backfill's "today" on this value; a
 * plain `useMemo(() => Date.now(), [])` froze it at mount, so in a long-lived
 * session a just-added today/now row could fall outside the window or be valued
 * stale. Refreshing on visibility (never per-render — that would defeat the
 * downstream memos keyed on it) keeps those current. Visibility, not focus: a
 * screen shown as a pane default is on screen but never focused, so a focus
 * effect would never run there.
 */
export const useVisibleRefreshedNow = (isVisible: boolean): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (isVisible) {
      setNow(Date.now());
    }
  }, [isVisible]);

  return now;
};
