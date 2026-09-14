import type { ReactElement } from 'react';

import { normalizeTransactionName } from '../../../transactions/normalize-name';
import Box from '../../../design-system/components/box';
import ChipRow from '../chip-row';

import type { DescriptionSuggestionsProps } from './description-suggestions.props';

const MAX_SUGGESTIONS = 5;

// The distinct past descriptions whose normalized form CONTAINS the normalized
// typed value, keeping the caller's newest-first order, deduped by normalized
// name, capped at the top five. A blank typed value yields nothing (the whole
// pool would otherwise match). Matching is JS-normalized (never SQL), mirroring
// the sync insert and A1 rule paths.
const matchSuggestions = (descriptions: readonly string[], value: string): string[] => {
  const normalizedValue = normalizeTransactionName(value);

  if (normalizedValue === '') {
    return [];
  }

  const seen = new Set<string>();
  const matches: string[] = [];

  for (const description of descriptions) {
    const normalized = normalizeTransactionName(description);

    if (normalized === '' || seen.has(normalized) || !normalized.includes(normalizedValue)) {
      continue;
    }

    seen.add(normalized);
    matches.push(description);

    if (matches.length === MAX_SUGGESTIONS) {
      break;
    }
  }

  return matches;
};

// An inline, tap-to-fill suggestion row under the description field (D1): up to
// five distinct past MANUAL descriptions matching what the user is typing,
// rendered as tappable chips through the shared `ChipRow`. It reports the picked
// value verbatim through `onPick`; `selected` is deliberately a value that never
// appears in the options, so no chip renders highlighted (this is a pick list,
// not a single-select toggle). The row hides itself when there is nothing to
// offer OR the field already holds a suggestion verbatim (e.g. right after a
// tap-to-fill), so it never lingers over a completed field.
const DescriptionSuggestions = ({
  descriptions,
  value,
  onPick,
}: DescriptionSuggestionsProps): ReactElement | null => {
  const matches = matchSuggestions(descriptions, value);

  if (matches.length === 0 || matches.some((match) => match === value)) {
    return null;
  }

  return (
    <Box testID="description-suggestions">
      <ChipRow options={matches} selected="" onSelect={onPick} />
    </Box>
  );
};

export default DescriptionSuggestions;
