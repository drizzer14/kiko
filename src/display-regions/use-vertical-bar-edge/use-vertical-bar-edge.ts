import { useDisplayRegions } from '../use-display-regions';
import type { VerticalBarEdge } from '../display-regions-native';

export const useVerticalBarEdge = (): VerticalBarEdge => useDisplayRegions().verticalBarEdge;
