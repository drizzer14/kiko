import { chunkForTable } from './chunk-for-table';
import { currencyRates, holdings } from './schema';

describe('chunkForTable', () => {
  it('keeps a single chunk when the whole batch fits under the parameter ceiling', () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ id: index }));

    expect(chunkForTable(currencyRates, rows)).toEqual([rows]);
  });

  it('splits a large batch into chunks sized from the table column count', () => {
    // currencyRates has 5 columns: floor(32000 / 5) = 6400 rows/chunk.
    const rows = Array.from({ length: 11_990 }, (_, index) => ({ id: index }));

    const chunks = chunkForTable(currencyRates, rows);

    expect(chunks.map((chunk) => chunk.length)).toEqual([6400, 5590]);
    // No row lost or duplicated across the chunk boundary.
    expect(chunks.flat()).toEqual(rows);
  });

  it('derives a smaller chunk size for a wider table', () => {
    // holdings has 14 columns: floor(32000 / 14) = 2285 rows/chunk.
    const rows = Array.from({ length: 5000 }, (_, index) => ({ id: index }));

    const chunks = chunkForTable(holdings, rows);

    expect(chunks.map((chunk) => chunk.length)).toEqual([2285, 2285, 430]);
  });

  it('returns no chunks for an empty batch', () => {
    expect(chunkForTable(currencyRates, [])).toEqual([]);
  });
});
