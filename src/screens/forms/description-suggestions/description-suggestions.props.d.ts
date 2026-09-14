export type DescriptionSuggestionsProps = {
  // The distinct past MANUAL descriptions, already ordered newest-first by the
  // `distinctDescriptionsQuery` builder. The component matches and caps them; it
  // does not re-order them.
  descriptions: readonly string[];
  // The description the user is currently typing. An empty value, no match, or a
  // value that already equals a suggestion collapses the row to nothing.
  value: string;
  // Fill the field with the tapped past description verbatim. The form pairs this
  // with A1's rule lookup so picking a known merchant name also re-seats its
  // category.
  onPick: (description: string) => void;
};
