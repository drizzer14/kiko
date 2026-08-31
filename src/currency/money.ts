import { type Currency, currencyScale } from './currency';

export class Money {
  // `private constructor` has no `#` equivalent — JavaScript has no native
  // private constructor, so a class-only factory is enforced via the TS
  // `private` keyword (used through `of`/`fromMajor`).
  private constructor(
    public readonly currency: Currency,
    public readonly minorUnits: number,
  ) {}

  static of(currency: Currency, minorUnits: number): Money {
    return new Money(currency, Math.trunc(minorUnits));
  }

  static fromMajor(currency: Currency, major: number): Money {
    const factor = 10 ** currencyScale[currency];

    return new Money(currency, Math.round(major * factor));
  }

  #assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.#assertSameCurrency(other);

    return new Money(this.currency, this.minorUnits + other.minorUnits);
  }

  subtract(other: Money): Money {
    this.#assertSameCurrency(other);

    return new Money(this.currency, this.minorUnits - other.minorUnits);
  }

  negate(): Money {
    return new Money(this.currency, -this.minorUnits);
  }

  isZero(): boolean {
    return this.minorUnits === 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }
}
