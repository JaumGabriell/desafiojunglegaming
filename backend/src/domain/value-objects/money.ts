import Decimal from "decimal.js";

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

export class CurrencyMismatchError extends Error {
  constructor(currency1: string, currency2: string) {
    super(`Currency mismatch: ${currency1} vs ${currency2}`);
    this.name = "CurrencyMismatchError";
  }
}

/**
 * Money value object - immutable representation of monetary values.
 * Uses Decimal.js for precise arithmetic operations.
 * All amounts are stored with exactly 2 decimal places.
 */
export class Money {
  private readonly value: Decimal;
  public readonly currency: string;

  private constructor(value: Decimal, currency: string) {
    this.value = value;
    this.currency = currency;
  }

  /**
   * Creates a Money instance from MoneyProps.
   * Validates the input: no NaN, Infinity, scientific notation, empty strings,
   * more than 2 decimal places, or negative values.
   */
  static from(props: MoneyProps): Money {
    Money.validateCurrency(props.currency);
    const value = Money.parseAmount(props.amount);
    return new Money(value, props.currency.toUpperCase());
  }

  /**
   * Creates a Money instance allowing negative values (for internal use like reversals).
   */
  static fromSigned(props: MoneyProps): Money {
    Money.validateCurrency(props.currency);
    const value = Money.parseAmountSigned(props.amount);
    return new Money(value, props.currency.toUpperCase());
  }

  /**
   * Creates a zero Money instance for the given currency.
   */
  static zero(currency: string): Money {
    Money.validateCurrency(currency);
    return new Money(new Decimal(0), currency.toUpperCase());
  }

  /**
   * Rehydrates Money from persistence (skips validation for already-validated data).
   */
  static rehydrate(amount: string, currency: string): Money {
    return new Money(new Decimal(amount), currency.toUpperCase());
  }

  private static validateCurrency(currency: string): void {
    if (!currency || typeof currency !== "string") {
      throw new InvalidMoneyError("Currency is required");
    }
    if (!/^[A-Z]{3}$/i.test(currency)) {
      throw new InvalidMoneyError(
        `Invalid currency format: ${currency}. Must be ISO-4217 (3 letters)`,
      );
    }
  }

  private static parseAmount(amount: string): Decimal {
    const value = Money.parseAmountSigned(amount);
    if (value.isNegative()) {
      throw new InvalidMoneyError("Amount cannot be negative");
    }
    return value;
  }

  private static parseAmountSigned(amount: string): Decimal {
    if (amount === null || amount === undefined || amount === "") {
      throw new InvalidMoneyError("Amount is required");
    }

    if (typeof amount !== "string") {
      throw new InvalidMoneyError("Amount must be a string");
    }

    // Check for scientific notation
    if (/[eE]/.test(amount)) {
      throw new InvalidMoneyError("Scientific notation is not allowed");
    }

    // Check for valid decimal format
    if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) {
      throw new InvalidMoneyError(
        `Invalid amount format: ${amount}. Must be a decimal string with at most 2 decimal places`,
      );
    }

    let value: Decimal;
    try {
      value = new Decimal(amount);
    } catch {
      throw new InvalidMoneyError(`Invalid amount: ${amount}`);
    }

    if (!value.isFinite()) {
      throw new InvalidMoneyError("Amount must be finite");
    }

    // Ensure exactly 2 decimal places
    if (value.decimalPlaces() > 2) {
      throw new InvalidMoneyError(
        "Amount cannot have more than 2 decimal places",
      );
    }

    return value;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  isLessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThanOrEqualTo(other.value);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  getAmount(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
