// Semgrep fixture (NEGATIVE): reads the stored balance through
// `holdingsRepo.balanceOf`, never a `.balanceMinorUnits` member read.
// `kiko-balance-through-repo` MUST report nothing here.
import { holdingsRepo } from '../../src/holdings/repo/holdings.repo';

export const fixtureBalanceMajorUnits = (holding: {
  currency: 'UAH' | 'USD' | 'EUR' | 'BTC';
  balanceMinorUnits: number;
}): number => holdingsRepo.balanceOf(holding).minorUnits / 100;
