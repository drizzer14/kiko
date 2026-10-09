import { useLayoutMode } from '@kiko/display-regions';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Decides when a form's draft is saved: after a field blurs, and when the window changes between
 * one pane and two. Never per keystroke, and never for a form the user has not changed. The
 * returned handler goes to `Screen`'s `onFieldBlur`.
 *
 * A blur saves after the commit it causes, not in the event itself, so state the field's own blur
 * handler set (a category chosen from the typed name) is in the draft. The window change saves
 * because a fold or unfold remounts the screen a moment later: a field still being typed in, or a
 * choice made since the last blur, would be lost without it.
 */
export const useDraftAutosave = <Draft>(
  draft: Draft,
  saveDraft: (draft: Draft) => void,
): (() => void) => {
  const latest = useRef(draft);
  // The draft the route holds, as text. A form opened from a saved draft starts equal to it.
  const saved = useRef(JSON.stringify(draft));
  const [blurs, setBlurs] = useState(0);
  const layoutMode = useLayoutMode();
  const previousLayoutMode = useRef(layoutMode);

  const save = useCallback(() => {
    const text = JSON.stringify(latest.current);

    if (text !== saved.current) {
      saved.current = text;
      saveDraft(latest.current);
    }
  }, [saveDraft]);

  useEffect(() => {
    latest.current = draft;
  });

  useEffect(() => {
    if (blurs > 0) {
      save();
    }
  }, [blurs, save]);

  useEffect(() => {
    if (previousLayoutMode.current !== layoutMode) {
      previousLayoutMode.current = layoutMode;
      save();
    }
  }, [layoutMode, save]);

  return useCallback(() => setBlurs((count) => count + 1), []);
};
