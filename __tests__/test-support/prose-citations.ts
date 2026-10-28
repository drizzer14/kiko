export type ProseCitation = {
  file: string;
  line: number;
  skill: string;
  text: string;
  resolved: boolean;
};

// Red-row stub: it finds nothing until the scan lands in the next step, so the rows of
// skill-citations.test.ts fail on their assertions instead of on a missing module.
export const proseCitations = (_root: string): ProseCitation[] => [];

export const unresolvedProseCitations = (root: string): ProseCitation[] =>
  proseCitations(root).filter(({ resolved }) => !resolved);
