import type { ShapedMutant } from './mutation-score-report';

// The four graded files of the binance set 3b deep gate (head 7bbc79e8), reduced from its saved
// report to each mutant's id, status, and lines, with the scope entries that hold a mutant. The
// gate failed TIMEOUT-HEAVY on two files and nothing else: binance.amounts.ts (19 of 21 detected
// timed out) and walk.ts (14 of 14); a plain-jest proof then killed all 33.
export const SET3B_SCOPE = [
  'src/crypto-sync/binance/binance.amounts.ts:1-21',
  'src/crypto-sync/binance/binance.walk-config.ts:1-18',
  'src/crypto-sync/exchange/paging/paging.ts:102-102',
  'src/crypto-sync/exchange/paging/paging.ts:769-769',
  'src/crypto-sync/exchange/walk/walk.ts:1424-1425',
  'src/crypto-sync/exchange/walk/walk.ts:1447-1447',
];

export const AMOUNTS = 'src/crypto-sync/binance/binance.amounts.ts';
export const WALK = 'src/crypto-sync/exchange/walk/walk.ts';

export const SET3B_FILES: Record<string, ShapedMutant[]> = {
  [AMOUNTS]: [
    ['2', 'Timeout', 6, 6],
    ['1', 'Timeout', 6, 6],
    ['4', 'Timeout', 6, 6],
    ['3', 'Timeout', 6, 6],
    ['6', 'Timeout', 6, 6],
    ['5', 'Timeout', 6, 6],
    ['8', 'Timeout', 6, 6],
    ['7', 'Timeout', 6, 6],
    ['9', 'Timeout', 6, 6],
    ['10', 'Timeout', 6, 6],
    ['11', 'Timeout', 6, 6],
    ['12', 'Timeout', 6, 6],
    ['14', 'Timeout', 6, 6],
    ['13', 'Timeout', 6, 6],
    ['16', 'Timeout', 13, 21],
    ['15', 'Timeout', 6, 6],
    ['18', 'Timeout', 14, 14],
    ['17', 'Timeout', 14, 14],
    ['20', 'Killed', 14, 16],
    ['19', 'Timeout', 14, 14],
    ['0', 'Killed', 5, 6],
  ],
  'src/crypto-sync/exchange/paging/paging.ts': [
    ['26', 'Killed', 102, 102],
    ['27', 'Killed', 102, 102],
    ['28', 'Killed', 102, 102],
    ['29', 'Killed', 102, 102],
    ['30', 'Killed', 769, 769],
    ['31', 'Killed', 769, 769],
  ],
  [WALK]: [
    ['32', 'Timeout', 1424, 1425],
    ['33', 'Timeout', 1425, 1425],
    ['34', 'Timeout', 1425, 1425],
    ['35', 'Timeout', 1425, 1425],
    ['36', 'Timeout', 1425, 1425],
    ['37', 'Timeout', 1425, 1425],
    ['38', 'Timeout', 1425, 1425],
    ['39', 'Timeout', 1425, 1425],
    ['40', 'Timeout', 1425, 1425],
    ['41', 'Timeout', 1425, 1425],
    ['42', 'Timeout', 1447, 1447],
    ['43', 'Timeout', 1447, 1447],
    ['44', 'Timeout', 1447, 1447],
    ['45', 'Timeout', 1447, 1447],
  ],
  'src/crypto-sync/binance/binance.walk-config.ts': [
    ['21', 'Killed', 8, 18],
    ['22', 'Killed', 10, 10],
    ['23', 'Killed', 12, 12],
    ['24', 'Killed', 13, 14],
    ['25', 'Survived', 16, 16],
  ],
};
