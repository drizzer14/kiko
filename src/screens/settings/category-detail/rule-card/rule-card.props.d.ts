import type { RuleRow } from '../rule-summary';

export type RuleCardProps = {
  // The conditions of the rule, one table row each. Absent for a rule that can not be read, which
  // shows the note in `summary` instead.
  rows?: RuleRow[];
  // The rule as one line: its rows joined, or the note that it can not be read. It names the card
  // to VoiceOver and to the delete menu.
  summary: string;
  // Opens the rule in its editor. Absent for a rule that can not be read, which has nothing to
  // edit and only its delete.
  onPress?: () => void;
  onDelete: () => void;
};
