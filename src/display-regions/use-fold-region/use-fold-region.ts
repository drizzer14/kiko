import { useDisplayRegions } from '../use-display-regions';
import type { FoldRegion } from '../display-regions-native';

export const useFoldRegion = (): FoldRegion => useDisplayRegions().foldRegion;
