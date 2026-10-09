import { useCallback, useRef, useState } from 'react';

type DraftNavigation<Draft> = { setParams: (params: { draft: Draft }) => void };

type DraftRoute<Draft> = { params?: { draft?: Draft } };

/**
 * The unsaved field values of a form, kept in its route's `draft` param. A fold or unfold remounts
 * every screen but keeps route params, so the form starts from `initialDraft` again. Params must
 * stay JSON, so a draft holds the raw field values (strings, ids, numbers), never a class or a
 * function.
 *
 * `initialDraft` is read once, at mount: this hook writes the same param later, and a form that
 * followed it would reseed itself from its own save.
 */
export const useDraftParam = <Draft>(
  navigation: DraftNavigation<Draft>,
  route: DraftRoute<Draft>,
): { initialDraft: Draft | undefined; saveDraft: (draft: Draft) => void } => {
  const [initialDraft] = useState(() => route.params?.draft);
  // The text of the draft the route holds, so a save of the same values writes nothing.
  const held = useRef(JSON.stringify(initialDraft));
  const { setParams } = navigation;

  const saveDraft = useCallback(
    (draft: Draft): void => {
      const text = JSON.stringify(draft);

      if (text === held.current) {
        return;
      }

      held.current = text;
      setParams({ draft });
    },
    [setParams],
  );

  return { initialDraft, saveDraft };
};
