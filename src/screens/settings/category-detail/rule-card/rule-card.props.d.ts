export type RuleCardProps = {
  // The rule as one line: its conditions joined, or the note that it can not be read.
  title: string;
  // Opens the rule in its editor. Absent for a rule that can not be read, which has nothing to
  // edit and only its delete.
  onPress?: () => void;
  onDelete: () => void;
};
