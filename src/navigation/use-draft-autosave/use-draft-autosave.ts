import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsLargeWindow, useLayoutMode } from '@kiko/display-regions';

/**
 * Decides when a form's draft is saved: after a field blurs, when the window changes between
 * one pane and two, and when it becomes or stops being a large window. Never per keystroke, and
 * never for a form the user has not changed. The returned handler goes to `Screen`'s
 * `onFieldBlur`.
 *
 * A form that opens blank and takes the saved draft's values a moment later passes that draft as
 * `restored`: it is what the route holds, so a change back to the blank form still needs saving.
 *
 * A blur saves after the commit it causes, not in the event itself, so state the field's own blur
 * handler set (a category chosen from the typed name) is in the draft. The window change saves
 * because a fold or unfold remounts the screen a moment later: a field still being typed in, or a
 * choice made since the last blur, would be lost without it. A window that turns large keeps the
 * layout mode (columns stay columns) yet merges the Home and Statistics tabs, and the form is
 * carried to the Home tab with only what its route params hold.
 */
export const useDraftAutosave = <Draft>(
  draft: Draft,
  saveDraft: (draft: Draft) => void,
  restored?: Draft,
): (() => void) => {
  const latest = useRef(draft);
  // The draft the route holds, as text. A form opened from a saved draft starts equal to it.
  const saved = useRef(JSON.stringify(restored ?? draft));
  const [blurs, setBlurs] = useState(0);
  const layoutMode = useLayoutMode();
  const previousLayoutMode = useRef(layoutMode);
  const isLargeWindow = useIsLargeWindow();
  const previousIsLargeWindow = useRef(isLargeWindow);

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
    if (
      previousLayoutMode.current !== layoutMode ||
      previousIsLargeWindow.current !== isLargeWindow
    ) {
      previousLayoutMode.current = layoutMode;
      previousIsLargeWindow.current = isLargeWindow;
      save();
    }
  }, [layoutMode, isLargeWindow, save]);

  return useCallback(() => setBlurs((count) => count + 1), []);
};
