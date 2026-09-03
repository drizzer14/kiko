import { chooseCompactUnit, formatCompactMoney } from './compact';

describe('chooseCompactUnit', () => {
  it('keeps the larger unit when the tick values are far apart (0.2M–1.5M -> M)', () => {
    // Four evenly-spaced ticks across a wide 0.2M–1.5M spread: at millions with
    // one decimal every label is still distinct (1.5M, 1.1M, 0.6M, 0.2M), so the
    // larger, shorter unit is kept.
    const unit = chooseCompactUnit([1_500_000, 1_066_666, 633_333, 200_000]);

    expect(unit.suffix).toBe('M');
    expect(unit.divisor).toBe(1_000_000);
    expect(unit.decimals).toBe(1);
  });

  it('drops to the smaller unit when the values are close together (1.2M–1.3M -> K)', () => {
    // A narrow 1.2M–1.3M spread collapses at millions (1.3M, 1.3M, 1.2M, 1.2M —
    // adjacent labels collide), so the helper steps down to grouped thousands
    // where every label stays distinct.
    const unit = chooseCompactUnit([1_300_000, 1_266_666, 1_233_333, 1_200_000]);

    expect(unit.suffix).toBe('K');
    expect(unit.divisor).toBe(1_000);
    expect(unit.decimals).toBe(0);
  });

  it('uses the base (suffix-less) unit for sub-thousand values', () => {
    expect(chooseCompactUnit([300, 200, 100]).suffix).toBe('');
  });

  it('does not loop forever on a flat range (all values equal)', () => {
    // One distinct value can never collide, so the natural unit is kept.
    expect(chooseCompactUnit([1_250_000, 1_250_000]).suffix).toBe('M');
  });

  it('falls back to the base unit for an empty value set', () => {
    expect(chooseCompactUnit([]).suffix).toBe('');
  });
});

describe('formatCompactMoney', () => {
  const millions = chooseCompactUnit([1_500_000, 200_000]);
  const thousands = chooseCompactUnit([1_300_000, 1_266_666, 1_233_333, 1_200_000]);

  it('formats a millions unit with one decimal and a leading symbol', () => {
    expect(formatCompactMoney(1_500_000, 'USD', millions)).toBe('$1.5M');
    expect(formatCompactMoney(200_000, 'USD', millions)).toBe('$0.2M');
  });

  it('formats a thousands unit with grouping and no decimals', () => {
    expect(formatCompactMoney(1_290_000, 'USD', thousands)).toBe('$1,290K');
    expect(formatCompactMoney(1_234_000, 'USD', thousands)).toBe('$1,234K');
  });

  it('suffixes the symbol for UAH, matching formatMoney placement', () => {
    expect(formatCompactMoney(1_300_000, 'UAH', thousands)).toBe('1,300K ₴');
  });

  it('places the sign before the symbol for a negative value', () => {
    expect(formatCompactMoney(-1_500_000, 'USD', millions)).toBe('-$1.5M');
  });
});
