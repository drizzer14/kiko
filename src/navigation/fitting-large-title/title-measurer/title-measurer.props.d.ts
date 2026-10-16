export type TitleMeasurerProps = {
  title: string;
  // The width the native large title has: the window minus its two side margins.
  availableWidth: number;
  onFitChange: (fits: boolean) => void;
};
